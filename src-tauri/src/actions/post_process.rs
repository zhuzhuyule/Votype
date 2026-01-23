#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::managers::prompt::{self, PromptManager};
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{
    AppSettings, LLMPrompt, ModelType, PostProcessProvider, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};

use std::sync::Arc;

use crate::managers::history::HistoryManager;
use tauri::{AppHandle, Emitter, Manager};

fn clean_response_content(content: &str) -> String {
    let mut text = content
        .replace("\n", "\n")
        .replace("\t", "\t")
        .replace("\"", "\"")
        .replace("\\", "\\");

    while let Some(start) = text.find("<think>") {
        if let Some(end) = text[start..].find("</think>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }

    text.trim().to_string()
}

#[derive(Debug, Deserialize)]
struct LlmReviewResponse {
    pub text: Option<String>,
    pub confidence: Option<u8>,
    pub reason: Option<serde_json::Value>,
}

/// Response from LLM for skill routing intent recognition
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SkillRouteResponse {
    /// The skill_id to use, or "default" for default processing
    pub skill_id: String,
    /// Confidence score (0-100) of the routing decision
    #[serde(default)]
    pub confidence: Option<i32>,
    /// Input source: "select" (use selected text), "output" (use full transcription),
    /// "extract" (use extracted content)
    #[serde(default)]
    pub input_source: Option<String>,
    /// Extracted/refined content from user's speech (only when input_source is "extract")
    #[serde(default)]
    pub extracted_content: Option<String>,
}

/// Build the system prompt for skill routing
fn build_skill_routing_prompt(
    template: &str,
    prompts: &[LLMPrompt],
    has_selected_text: bool,
) -> String {
    let mut skill_list = String::new();
    let mut enabled_skill_names: Vec<String> = Vec::new();

    for prompt in prompts {
        // Skip disabled skills
        if !prompt.enabled {
            info!(
                "[SkillRouter] Skipping disabled skill: {} (id={})",
                prompt.name, prompt.id
            );
            continue;
        }

        let description = if prompt.description.is_empty() {
            format!("{}.", prompt.name)
        } else {
            prompt.description.clone()
        };

        skill_list.push_str(&format!(
            "- id: \"{}\", name: \"{}\", description: \"{}\"\n",
            prompt.id, prompt.name, description
        ));

        enabled_skill_names.push(format!("{} ({})", prompt.name, prompt.id));
    }

    info!(
        "[SkillRouter] Building prompt with {} enabled skills: [{}]",
        enabled_skill_names.len(),
        enabled_skill_names.join(", ")
    );

    let selected_text_note = if has_selected_text {
        r#"

## 注意
用户当前**有选中的文本内容**。如果用户的指令是针对选中内容的操作（如"翻译这个"、"总结一下"、"帮我检查"等），应该返回 input_source: "select"。"#
    } else {
        ""
    };

    let mut vars = std::collections::HashMap::new();
    vars.insert("SKILL_LIST", skill_list);
    vars.insert("SELECTED_TEXT_NOTE", selected_text_note.to_string());

    prompt::substitute_variables(template, &vars)
}

/// Parse the skill routing response from LLM
fn parse_skill_route_response(content: &str) -> Option<SkillRouteResponse> {
    let cleaned = clean_response_content(content);
    if let Some(json) = extract_json_block(&cleaned) {
        if let Ok(parsed) = serde_json::from_str::<SkillRouteResponse>(&json) {
            return Some(parsed);
        }
    }
    // Try parsing directly
    if let Ok(parsed) = serde_json::from_str::<SkillRouteResponse>(&cleaned) {
        return Some(parsed);
    }
    None
}

/// Perform asynchronous skill routing using LLM
/// Returns the full routing response including skill_id, confidence, input_source and extracted_content
async fn perform_skill_routing(
    _app_handle: &AppHandle,
    api_key: String,
    prompts: &[LLMPrompt],
    provider: &PostProcessProvider,
    model: &str,
    transcription: &str,
    selected_text: Option<&str>,
) -> Option<SkillRouteResponse> {
    let client = match crate::llm_client::create_client(provider, api_key) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[SkillRouter] Failed to create LLM client: {:?}", e);
            return None;
        }
    };

    let has_selected_text = selected_text.map(|s| !s.trim().is_empty()).unwrap_or(false);

    info!(
        "[SkillRouter] perform_skill_routing called with: model={}, transcription_len={}, has_selected_text={}, prompts_count={}",
        model, transcription.len(), has_selected_text, prompts.len()
    );

    let prompt_manager = _app_handle.state::<Arc<PromptManager>>();
    let template = match prompt_manager.get_prompt(_app_handle, "system_skill_routing") {
        Ok(t) => t,
        Err(e) => {
            log::warn!("[SkillRouter] Failed to load prompt: {}", e);
            return None;
        }
    };
    let routing_prompt = build_skill_routing_prompt(&template, prompts, has_selected_text);

    let mut messages = Vec::new();

    if let Ok(sys_msg) = ChatCompletionRequestSystemMessageArgs::default()
        .content(routing_prompt)
        .build()
    {
        messages.push(ChatCompletionRequestMessage::System(sys_msg));
    }

    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(transcription.to_string())
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    let req = match CreateChatCompletionRequestArgs::default()
        .model(model.to_string())
        .messages(messages)
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[SkillRouter] Failed to build request: {:?}", e);
            return None;
        }
    };

    let response = match client.chat().create(req).await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[SkillRouter] LLM request failed: {:?}", e);
            return None;
        }
    };

    let content = match response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
    {
        Some(c) => c,
        None => {
            log::warn!("[SkillRouter] LLM response has no content");
            return None;
        }
    };

    info!("[SkillRouter] Raw LLM response: {}", content);

    let route = match parse_skill_route_response(&content) {
        Some(r) => r,
        None => {
            log::warn!("[SkillRouter] Failed to parse skill route response");
            return None;
        }
    };

    // Apply confidence coefficient adjustment based on context
    // With selected text: boost confidence by 15% (user intent is clearer with context)
    let raw_confidence = route.confidence.unwrap_or(0);
    let adjusted_confidence = if has_selected_text {
        ((raw_confidence as f32) * 1.15).min(100.0) as i32
    } else {
        raw_confidence
    };

    info!(
        "[SkillRouter] Confidence: raw={}, adjusted={} (selected_text={})",
        raw_confidence, adjusted_confidence, has_selected_text
    );

    // Confidence threshold: Route if adjusted confidence is fairly high (≥ 70%)
    // User can reject via confirmation dialog if incorrect
    if route.skill_id == "default" || adjusted_confidence < 70 {
        if route.skill_id != "default" {
            info!(
                "[SkillRouter] Low confidence routing ignored: {} (raw: {}, adjusted: {})",
                route.skill_id, raw_confidence, adjusted_confidence
            );
        } else {
            info!("[SkillRouter] LLM returned 'default' - no skill match");
        }
        None
    } else {
        info!(
            "[SkillRouter] Routed to skill: {} (Confidence: {} -> {}, InputSource: {:?})",
            route.skill_id, raw_confidence, adjusted_confidence, route.input_source
        );
        Some(route)
    }
}

/// Execute default polish request for parallel processing.
/// This is a simplified version that only runs the default prompt.
/// Returns the polished text or None if failed.
async fn execute_default_polish(
    _app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    default_prompt: &LLMPrompt,
    transcription: &str,
) -> Option<String> {
    let model = resolve_effective_model(settings, provider, default_prompt)?;

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = crate::llm_client::create_client(provider, api_key).ok()?;

    // Build a simple prompt for polish
    let mut messages = Vec::new();

    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(default_prompt.instructions.clone())
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    // Add the transcription as input
    let input_message = format!("```output\n{}\n```", transcription);
    if let Ok(input_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(input_message)
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(input_msg));
    }

    if messages.is_empty() {
        return None;
    }

    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(messages)
        .build()
        .ok()?;

    let response = client.chat().create(req).await.ok()?;
    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())?;

    let (text, _confidence, _reason) = parse_response_with_confidence(&content);

    info!(
        "[ParallelPolish] Default polish completed, result length: {}",
        text.len()
    );
    Some(text)
}

fn extract_json_block(content: &str) -> Option<String> {
    if let Some(start) = content.find("```json") {
        let rest = &content[start + 7..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }
    if let Some(start) = content.find("```") {
        let rest = &content[start + 3..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    if end > start {
        return Some(content[start..=end].trim().to_string());
    }
    None
}

fn normalize_reason(reason_value: serde_json::Value) -> Option<String> {
    let mut items: Vec<String> = Vec::new();
    match reason_value {
        serde_json::Value::String(value) => {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                items.push(trimmed.to_string());
            }
        }
        serde_json::Value::Array(values) => {
            for item in values {
                if let serde_json::Value::String(value) = item {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        items.push(trimmed.to_string());
                    }
                }
            }
        }
        _ => {}
    }

    if items.is_empty() {
        None
    } else {
        Some(items.join("；"))
    }
}

/// Parse LLM response to extract text, confidence score, and reason
fn parse_response_with_confidence(content: &str) -> (String, Option<u8>, Option<String>) {
    let cleaned = clean_response_content(content);

    if let Some(json) = extract_json_block(&cleaned) {
        if let Ok(parsed) = serde_json::from_str::<LlmReviewResponse>(&json) {
            if let Some(text) = parsed.text {
                let mut confidence = parsed.confidence.map(|v| v.min(100));
                let reason = parsed.reason.and_then(normalize_reason);
                if reason.is_none() {
                    confidence = Some(100);
                }
                return (text, confidence, reason);
            }
        }
    }

    // Back-compat: Look for confidence marker at the end
    if let Some(pos) = cleaned.rfind("---CONFIDENCE:") {
        let text_part = cleaned[..pos].trim();
        let marker_part = &cleaned[pos + 14..]; // Skip "---CONFIDENCE:"

        if let Some(end_pos) = marker_part.find("---") {
            if let Ok(score) = marker_part[..end_pos].trim().parse::<u8>() {
                return (text_part.to_string(), Some(score.min(100)), None);
            }
        }
    }

    // No confidence marker found, return cleaned text with no score
    (cleaned, None, None)
}

fn resolve_effective_model(
    settings: &AppSettings,
    provider: &PostProcessProvider,
    prompt: &LLMPrompt,
) -> Option<String> {
    let resolve_from_id = |model_id_opt: Option<&String>| -> Option<String> {
        model_id_opt
            .filter(|id| !id.trim().is_empty())
            .and_then(|id| {
                settings
                    .cached_models
                    .iter()
                    .find(|m| m.id == *id && m.provider_id == provider.id)
            })
            .map(|m| m.model_id.clone())
    };

    resolve_from_id(prompt.model_id.as_ref())
        .or_else(|| resolve_from_id(settings.selected_prompt_model_id.as_ref()))
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .filter(|m| !m.trim().is_empty())
}

fn resolve_intent_routing_model<'a>(
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    fallback_prompt: &LLMPrompt,
) -> Option<(&'a PostProcessProvider, String, String)> {
    if let Some(intent_model_id) = settings.post_process_intent_model_id.as_ref() {
        if let Some(cached_model) = settings
            .cached_models
            .iter()
            .find(|cached| cached.id == *intent_model_id)
        {
            if cached_model.model_type == ModelType::Text {
                if let Some(provider) = settings.post_process_provider(&cached_model.provider_id) {
                    let model_id = cached_model.model_id.trim().to_string();
                    if !model_id.is_empty() {
                        let api_key = settings
                            .post_process_api_keys
                            .get(&provider.id)
                            .cloned()
                            .unwrap_or_default();
                        return Some((provider, model_id, api_key));
                    }
                } else {
                    log::warn!(
                        "[SkillRouter] Intent model provider not found: {}",
                        cached_model.provider_id
                    );
                }
            } else {
                log::warn!(
                    "[SkillRouter] Intent model is not text-capable: {}",
                    cached_model.id
                );
            }
        } else {
            log::warn!(
                "[SkillRouter] Intent model not found in cache: {}",
                intent_model_id
            );
        }
    }

    let model = resolve_effective_model(settings, fallback_provider, fallback_prompt)?;
    let api_key = settings
        .post_process_api_keys
        .get(&fallback_provider.id)
        .cloned()
        .unwrap_or_default();
    Some((fallback_provider, model, api_key))
}

pub async fn execute_llm_request(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    prompt_content: &str,
    input_data_message: Option<&str>,
    fallback_message: Option<&str>,
    history: Vec<String>,
    app_name: Option<String>,
    window_title: Option<String>,
    match_pattern: Option<String>,
    match_type: Option<crate::settings::TitleMatchType>,
) -> (Option<String>, bool, Option<u8>, Option<String>) {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "apple_intelligence_unavailable" }),
                );
                return (None, true, None, None);
            }

            let mut final_prompt = prompt_content.to_string();
            // Append input data if provided
            if let Some(input_data) = input_data_message {
                final_prompt = format!("{}\n\n{}", final_prompt, input_data);
            }
            if !history.is_empty() {
                let context_label =
                    if let (Some(pattern), Some(mtype)) = (&match_pattern, &match_type) {
                        format!(
                            "Rule: \"{}\" ({})",
                            pattern,
                            match mtype {
                                crate::settings::TitleMatchType::Text => "Text match",
                                crate::settings::TitleMatchType::Regex => "Regex match",
                            }
                        )
                    } else {
                        format!("Window: \"{}\"", window_title.clone().unwrap_or_default())
                    };

                let context_block = format!(
                    "\n\nRecent context for application \"{}\" ({}):\n{}\n\n",
                    app_name.clone().unwrap_or_default(),
                    context_label,
                    history
                        .iter()
                        .map(|s| format!("- {}", s))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                final_prompt = format!("{}{}", context_block, final_prompt);
            }

            info!(
                "Apple Intelligence Request | Model: {} | Prompt: {}",
                model, final_prompt
            );

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&final_prompt, token_limit) {
                Ok(result) => (Some(result), false, None, None), // Apple Intelligence doesn't support confidence check
                Err(err) => {
                    error!("Apple Intelligence failed: {}", err);
                    let _ = app_handle.emit(
                        "overlay-error",
                        serde_json::json!({ "code": "apple_intelligence_failed" }),
                    );
                    (None, true, None, None)
                }
            };
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        return (None, false, None, None);
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = match crate::llm_client::create_client(provider, api_key) {
        Ok(client) => client,
        Err(e) => {
            error!("Failed to create LLM client: {}", e);
            let _ = app_handle.emit(
                "overlay-error",
                serde_json::json!({ "code": "llm_init_failed" }),
            );
            return (None, true, None, None);
        }
    };

    // Build messages list
    let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();

    // 2. Add history as a single User message context block
    if !history.is_empty() {
        let context_label = if let (Some(pattern), Some(mtype)) = (&match_pattern, &match_type) {
            format!(
                "规则: \"{}\" ({})",
                pattern,
                match mtype {
                    crate::settings::TitleMatchType::Text => "文本包含",
                    crate::settings::TitleMatchType::Regex => "正则匹配",
                }
            )
        } else {
            format!("窗口: \"{}\"", window_title.clone().unwrap_or_default())
        };

        let history_block = format!(
            "以下是对话的历史识别结果（来自应用 \"{}\"，{}），仅用于提供上下文，请勿修改：\n\n{}",
            app_name.clone().unwrap_or_default(),
            context_label,
            history.join("\n")
        );

        if let Ok(ctx_msg) = async_openai::types::ChatCompletionRequestUserMessageArgs::default()
            .content(history_block)
            .build()
        {
            messages.push(ChatCompletionRequestMessage::User(ctx_msg));
        }
    }

    // 3. Add current prompt as the final User message
    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt_content.to_string())
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    // 4. Add input data as a separate User message if provided
    if let Some(input_data) = input_data_message {
        if let Ok(input_msg) = ChatCompletionRequestUserMessageArgs::default()
            .content(input_data.to_string())
            .build()
        {
            messages.push(ChatCompletionRequestMessage::User(input_msg));
        }
    }

    // 5. Add fallback message if provided (when prompt doesn't reference output/select)
    if let Some(fallback) = fallback_message {
        if let Ok(fallback_msg) = ChatCompletionRequestUserMessageArgs::default()
            .content(fallback.to_string())
            .build()
        {
            messages.push(ChatCompletionRequestMessage::User(fallback_msg));
        }
    }

    if messages.is_empty() {
        return (None, false, None, None);
    }

    let req = CreateChatCompletionRequestArgs::default()
        .model(model.to_string())
        .messages(messages)
        .build()
        .ok();

    if let Some(req) = req {
        match client.chat().create(req).await {
            Ok(resp) => {
                let content = resp
                    .choices
                    .first()
                    .and_then(|c| c.message.content.clone())
                    .unwrap_or_default();

                let (text, confidence, reason) = parse_response_with_confidence(&content);
                return (Some(text), false, confidence, reason);
            }
            Err(err) => {
                error!("LLM request failed: {:?}", err);
                let _ = app_handle.emit(
                    "overlay-error",
                    serde_json::json!({ "code": "llm_request_failed" }),
                );
                return (None, true, None, None);
            }
        }
    }

    (None, false, None, None)
}

fn resolve_prompt_from_text(
    text: &str,
    prompts: &[LLMPrompt],
    default_prompt: Option<&LLMPrompt>,
    override_prompt_id: Option<&str>,
) -> (Option<LLMPrompt>, String, bool) {
    // 1. If override_prompt_id specified, use that prompt
    if let Some(override_id) = override_prompt_id {
        if let Some(p) = prompts.iter().find(|p| p.id == override_id) {
            return (Some(p.clone()), text.to_string(), true);
        }
    }

    // 2. Return default prompt with full original text
    (default_prompt.cloned(), text.to_string(), false)
}

fn get_default_prompt<'a>(
    prompts: &'a [LLMPrompt],
    selected_id: Option<&str>,
    override_prompt_id: Option<&str>,
) -> Option<&'a LLMPrompt> {
    if let Some(pid) = override_prompt_id {
        if let Some(p) = prompts.iter().find(|p| &p.id == pid) {
            return Some(p);
        }
    }

    if let Some(id) = selected_id {
        if let Some(p) = prompts.iter().find(|p| &p.id == id) {
            return Some(p);
        }
    }

    prompts.first()
}

pub(crate) async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    show_overlay: bool,
    override_prompt_id: Option<String>,
    app_name: Option<String>,
    window_title: Option<String>,
    match_pattern: Option<String>,
    match_type: Option<crate::settings::TitleMatchType>,
    history_id: Option<i64>,
    skill_mode: bool,
    selected_text: Option<String>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<u8>,
    Option<String>,
) {
    if !settings.post_process_enabled {
        return (None, None, None, false, None, None);
    }

    let provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false, None, None),
    };

    // Load external skills (Phase 9)
    let skill_manager = crate::managers::skill::SkillManager::new(app_handle);
    let external_skills = skill_manager.load_all_external_skills();

    // Merge skills with same logic as merge_external_skills:
    // - Builtin skills take priority over external skills with same ID
    // - Customized skills (customized=true) are not overwritten by file versions
    let mut all_prompts = settings.post_process_prompts.clone();

    for mut file_skill in external_skills {
        // Skip if ID conflicts with builtin skill
        if all_prompts
            .iter()
            .any(|p| p.id == file_skill.id && p.source == crate::settings::SkillSource::Builtin)
        {
            continue;
        }

        if let Some(existing) = all_prompts.iter().find(|p| p.id == file_skill.id) {
            // Keep user's customized version
            if existing.customized {
                continue;
            }

            // Update with file version while preserving customized state
            let pos = all_prompts
                .iter()
                .position(|p| p.id == file_skill.id)
                .unwrap();
            let was_customized = all_prompts[pos].customized;
            let old_file_path = all_prompts[pos].file_path.clone();

            all_prompts[pos] = file_skill;
            all_prompts[pos].customized = was_customized;
            all_prompts[pos].file_path = old_file_path;
        } else {
            // New skill, add it
            file_skill.customized = false;
            all_prompts.push(file_skill);
        }
    }

    // Resolve default prompt from the combined list
    let default_prompt = get_default_prompt(
        &all_prompts,
        settings.post_process_selected_prompt_id.as_deref(),
        override_prompt_id.as_deref(),
    );

    let (mut initial_prompt_opt, mut initial_content, mut is_explicit) = resolve_prompt_from_text(
        transcription,
        &all_prompts,
        default_prompt,
        override_prompt_id.as_deref(),
    );

    // Notify UI immediately about the specific prompt being used if it's an override (app/rule specific)
    if let (Some(p), true) = (&initial_prompt_opt, override_prompt_id.is_some()) {
        app_handle.emit("post-process-status", p.name.clone()).ok();
    }

    // --- Smart Routing Phase ---
    // Only perform LLM-based routing if skill_mode is enabled (dedicated shortcut pressed - Mode B)
    // For selected text (Mode C), we need user confirmation before executing skills
    let has_selected_text = selected_text
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    // Mode B: Skill shortcut pressed - do LLM routing and execute
    if skill_mode
        && !is_explicit
        && override_prompt_id.is_none()
        && !transcription.trim().is_empty()
    {
        if let Some(p) = &initial_prompt_opt {
            if let Some((route_provider, route_model, route_api_key)) =
                resolve_intent_routing_model(settings, provider, p)
            {
                if let Some(route_response) = perform_skill_routing(
                    app_handle,
                    route_api_key,
                    &all_prompts,
                    route_provider,
                    &route_model,
                    transcription,
                    selected_text.as_deref(),
                )
                .await
                {
                    let skill_id = &route_response.skill_id;
                    if let Some(routed_prompt) = all_prompts.iter().find(|p| &p.id == skill_id) {
                        // If routed to "default", we likely already have the default prompt selected in initial_prompt_opt
                        if skill_id != "default" {
                            initial_prompt_opt = Some(routed_prompt.clone());
                            is_explicit = true; // Mark as explicit so we don't treat it as default polish
                        }
                        info!(
                            "[PostProcess] Routed to skill \"{}\" via LLM (input_source: {:?})",
                            routed_prompt.name, route_response.input_source
                        );

                        // Use input_source to determine which content to use
                        initial_content = match route_response.input_source.as_deref() {
                            Some("select") => selected_text.clone().unwrap_or_default(),
                            Some("extract") => route_response
                                .extracted_content
                                .clone()
                                .unwrap_or_else(|| transcription.to_string()),
                            _ => transcription.to_string(), // "output" or unspecified
                        };

                        // Notify UI about the routed skill
                        app_handle
                            .emit("post-process-status", routed_prompt.name.clone())
                            .ok();
                    }
                }
            }
        }
    }

    // Intent Detection Mode: Only triggered when user has selected text
    // This prevents frequent popup triggers during normal transcription
    // When text is selected, the operation ALWAYS targets the selected content
    // User's speech is only used as intent/instruction hint
    // Note: Some LLM providers may not support concurrent requests, so we handle failures gracefully

    // DEBUG: Log condition checks
    info!(
        "[PostProcess] Intent detection conditions: skill_mode={}, is_explicit={}, override_prompt_id={:?}, transcription_empty={}, has_selected_text={}",
        skill_mode, is_explicit, override_prompt_id, transcription.trim().is_empty(), has_selected_text
    );

    if !skill_mode
        && !is_explicit
        && override_prompt_id.is_none()
        && !transcription.trim().is_empty()
        && has_selected_text
    // Only trigger intent detection when text is selected
    {
        info!("[PostProcess] Entering intent detection mode (has selected text)");

        // Switch overlay to LLM processing state and notify UI
        crate::overlay::show_llm_processing_overlay(app_handle);
        app_handle.emit("post-process-status", "正在润色中...").ok();

        if let Some(default_prompt) = &initial_prompt_opt {
            if let Some((route_provider, route_model, route_api_key)) =
                resolve_intent_routing_model(settings, provider, default_prompt)
            {
                info!(
                    "[PostProcess] Starting parallel intent detection and polish - provider={}, model={}, selected_text={}",
                    route_provider.label, route_model, has_selected_text
                );

                // Execute both requests in parallel
                let (intent_result, polish_result) = tokio::join!(
                    // Intent detection
                    perform_skill_routing(
                        app_handle,
                        route_api_key,
                        &all_prompts,
                        route_provider,
                        &route_model,
                        transcription,
                        selected_text.as_deref(),
                    ),
                    // Default polish
                    execute_default_polish(
                        app_handle,
                        settings,
                        provider,
                        default_prompt,
                        transcription,
                    )
                );

                // Log results for debugging concurrency issues
                let intent_ok = intent_result.is_some();
                let polish_ok = polish_result.is_some();
                info!(
                    "[PostProcess] Parallel requests completed - Intent: {} (skill: {:?}), Polish: {} (len: {})",
                    if intent_ok { "OK" } else { "FAILED" },
                    intent_result.as_ref().map(|r| &r.skill_id),
                    if polish_ok { "OK" } else { "FAILED" },
                    polish_result.as_ref().map(|s| s.len()).unwrap_or(0)
                );

                // Handle different result combinations:
                // 1. Intent matched + Polish OK/Failed -> Show confirmation (polish_result may be None)
                // 2. Intent failed + Polish OK -> Use polish result directly
                // 3. Both failed -> Fall through to standard processing

                if let Some(route_response) = intent_result {
                    let skill_id = &route_response.skill_id;

                    info!(
                        "[PostProcess] Intent matched! skill_id={}, input_source={:?}, extracted_content={:?}",
                        skill_id, route_response.input_source, route_response.extracted_content
                    );

                    if let Some(routed_prompt) = all_prompts.iter().find(|p| &p.id == skill_id) {
                        info!(
                            "[PostProcess] Found matching prompt: name={}, output_mode={:?}, enabled={}",
                            routed_prompt.name, routed_prompt.output_mode, routed_prompt.enabled
                        );

                        // Check if this is the default skill - if so, skip confirmation and use polish result
                        // Compare with: 1) user-selected default prompt, 2) current default_prompt used for polish
                        let is_default_skill = settings
                            .post_process_selected_prompt_id
                            .as_ref()
                            .map(|default_id| default_id == skill_id)
                            .unwrap_or(false)
                            || default_prompt.id == *skill_id;

                        info!(
                            "[PostProcess] Default skill check: is_default={}, selected_prompt_id={:?}, skill_id={}, default_prompt_id={}",
                            is_default_skill, settings.post_process_selected_prompt_id, skill_id, default_prompt.id
                        );

                        if is_default_skill {
                            info!(
                                "[PostProcess] Matched skill is the default skill, skipping confirmation and using polish result"
                            );
                            // Use polish result directly without confirmation
                            if let Some(polished) = polish_result {
                                return (
                                    Some(polished),
                                    None,
                                    Some(routed_prompt.id.clone()),
                                    false,
                                    None,
                                    None,
                                );
                            }
                            // If polish failed, fall through to standard processing
                        }

                        // [DEBUG] Log selected text content before showing confirmation
                        match &selected_text {
                            Some(text) if !text.trim().is_empty() => {
                                let preview: String = text.chars().take(100).collect();
                                let suffix = if text.chars().count() > 100 {
                                    "..."
                                } else {
                                    ""
                                };
                                info!("[PostProcess] Before confirmation - selected text ({} chars): \"{}{}\"",
                                    text.len(), preview, suffix
                                );
                            }
                            Some(_) => {
                                info!("[PostProcess] Before confirmation - selected text is empty/whitespace");
                            }
                            None => {
                                info!(
                                    "[PostProcess] Before confirmation - no selected text (None)"
                                );
                            }
                        }

                        info!(
                            "[PostProcess] Skill matched: \"{}\" (id={}), polish_available={}, will emit skill-confirmation event",
                            routed_prompt.name, skill_id, polish_ok
                        );

                        // Save pending confirmation state with cached polish result (may be None if failed)
                        // Also capture current active window PID for focus restoration
                        use tauri::Manager;
                        let active_pid = crate::active_window::fetch_active_window()
                            .ok()
                            .map(|info| info.process_id);

                        if let Some(pending_state) =
                            app_handle.try_state::<crate::ManagedPendingSkillConfirmation>()
                        {
                            if let Ok(mut guard) = pending_state.lock() {
                                *guard = crate::PendingSkillConfirmation {
                                    skill_id: Some(skill_id.clone()),
                                    skill_name: Some(routed_prompt.name.clone()),
                                    transcription: Some(transcription.to_string()),
                                    selected_text: selected_text.clone(),
                                    override_prompt_id: override_prompt_id.clone(),
                                    app_name: app_name.clone(),
                                    window_title: window_title.clone(),
                                    history_id,
                                    process_id: active_pid,
                                    polish_result: polish_result.clone(), // May be None if parallel polish failed!
                                    is_ui_visible: false,
                                };
                            }
                        }

                        // Emit confirmation event to frontend
                        #[derive(serde::Serialize, Clone)]
                        struct SkillConfirmationPayload {
                            skill_id: String,
                            skill_name: String,
                            transcription: String,
                            polish_result: Option<String>,
                        }

                        app_handle
                            .emit(
                                "skill-confirmation",
                                SkillConfirmationPayload {
                                    skill_id: skill_id.clone(),
                                    skill_name: routed_prompt.name.clone(),
                                    transcription: transcription.to_string(),
                                    polish_result, // Frontend should handle None case (show loading or N/A)
                                },
                            )
                            .ok();

                        // Return early with special model marker to signal pending confirmation
                        // Caller should check for this and skip paste/hide operations
                        return (
                            None,
                            Some("__PENDING_SKILL_CONFIRMATION__".to_string()),
                            None,
                            false,
                            None,
                            None,
                        );
                    }
                }

                // No skill matched - use the polish result directly if available
                // IMPORTANT: Return the default_prompt.id so caller can get correct output_mode
                if let Some(polished) = polish_result {
                    info!(
                        "[PostProcess] No skill matched, using parallel polish result with default prompt: {} (id={})",
                        default_prompt.name, default_prompt.id
                    );
                    return (
                        Some(polished),
                        None,
                        Some(default_prompt.id.clone()),
                        false,
                        None,
                        None,
                    );
                }

                // Both failed or no match + polish failed - fall through to standard processing
                if !intent_ok && !polish_ok {
                    log::warn!("[PostProcess] Both parallel requests failed, falling back to standard processing");
                }
            }
        }

        // Fallback: continue with default polish
        info!("[PostProcess] Selected text mode - continuing with default polish");
    }

    let initial_prompt = match initial_prompt_opt {
        Some(p) => p,
        None => return (None, None, None, false, None, None),
    };

    let mut current_prompt = initial_prompt;
    let mut current_input_content: String = initial_content;
    let mut current_transcription = transcription.to_string();
    let mut chain_depth = 0;
    const MAX_CHAIN_DEPTH: usize = 2;

    // Track if first iteration used default prompt (non-explicit match)
    // Chain calls should ONLY happen after default prompt processing
    let was_default_prompt = !is_explicit;

    let mut final_result = None;
    let mut last_model = None;
    let mut last_prompt_id = None;
    let mut last_err = false;
    let mut last_confidence = None;
    let mut last_reason = None;

    while chain_depth < MAX_CHAIN_DEPTH {
        let prompt = current_prompt.clone();
        let transcription_content = &current_input_content;
        let transcription_original = &current_transcription;

        let model = match resolve_effective_model(settings, provider, &prompt) {
            Some(m) => m,
            None => {
                return (
                    final_result,
                    last_model,
                    Some(prompt.id.clone()),
                    false,
                    last_confidence,
                    last_reason,
                )
            }
        };

        if show_overlay {
            show_llm_processing_overlay(app_handle);
        }

        // Keep prompt template as-is, only replace metadata variables
        let mut processed_prompt = prompt.instructions.replace("${prompt}", &prompt.name);

        // Check which variables are referenced in the prompt template
        let prompt_template = &prompt.instructions;
        let has_output_ref = prompt_template.contains("output");
        let has_select_ref = prompt_template.contains("select");
        let has_raw_input_ref = prompt_template.contains("raw_input");
        let has_streaming_ref = prompt_template.contains("streaming_output");
        let has_hot_words_ref = prompt_template.contains("hot_words");
        let has_context_ref = prompt_template.contains("context");
        let has_app_name_ref = prompt_template.contains("app_name");
        let has_window_title_ref = prompt_template.contains("window_title");
        let has_time_ref = prompt_template.contains("time");

        // Build structured input data message - only include variables referenced in prompt
        let mut input_data_parts: Vec<String> = Vec::new();

        // Add output (transcription content) - only if referenced
        if has_output_ref && !transcription_content.is_empty() {
            input_data_parts.push(format!("```output\n{}\n```", transcription_content));
        }

        // Add raw_input (full original transcription) - only if referenced
        if has_raw_input_ref
            && !transcription_original.is_empty()
            && transcription_original != transcription_content
        {
            input_data_parts.push(format!("```raw_input\n{}\n```", transcription_original));
        }

        // Add streaming_output if available and referenced
        if has_streaming_ref {
            if let Some(streaming) = streaming_transcription {
                if !streaming.is_empty() {
                    input_data_parts.push(format!("```streaming_output\n{}\n```", streaming));
                }
            }
        }

        // Add selected text if referenced
        if has_select_ref {
            if let Some(text) = &selected_text {
                if !text.is_empty() {
                    input_data_parts.push(format!("```select\n{}\n```", text));
                }
            }
        }

        // Add app_name if referenced
        if has_app_name_ref {
            if let Some(name) = &app_name {
                if !name.is_empty() {
                    processed_prompt = processed_prompt.replace("${app_name}", name);
                }
            }
        }

        // Add window_title if referenced
        if has_window_title_ref {
            if let Some(title) = &window_title {
                if !title.is_empty() {
                    processed_prompt = processed_prompt.replace("${window_title}", title);
                }
            }
        }

        // Add current time if referenced
        if has_time_ref {
            let now = chrono::Local::now();
            let time_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
            processed_prompt = processed_prompt.replace("${time}", &time_str);
        }

        // Inject hot words and skills - logic depends on whether we had an explicit match
        if is_explicit {
            // Case A: Explicit match (override_prompt_id specified). Keep context clean, only inject user custom words.
            if has_hot_words_ref && !settings.custom_words.is_empty() {
                let hot_words_list = settings
                    .custom_words
                    .iter()
                    .map(|w| format!("- {}", w))
                    .collect::<Vec<_>>()
                    .join("\n");

                if processed_prompt.contains("${hot_words}") {
                    processed_prompt = processed_prompt.replace("${hot_words}", &hot_words_list);
                } else {
                    input_data_parts.push(format!("```hot_words\n{}\n```", hot_words_list));
                }
            }
        } else {
            // Case B: Fallback (unrecognized intent). Inject EVERYTHING to guide the LLM.
            let mut hot_words = settings.custom_words.clone();
            let mut skills_info = Vec::new();

            for p in &settings.post_process_prompts {
                // For hot_words variable: add names for fuzzy matching
                hot_words.push(p.name.clone());
                skills_info.push(format!("- **{}**", p.name));
            }

            hot_words.sort();
            hot_words.dedup();

            // 1. Inject into ${hot_words} if referenced
            if !hot_words.is_empty() {
                let hot_words_text = hot_words
                    .iter()
                    .map(|w| format!("- {}", w))
                    .collect::<Vec<_>>()
                    .join("\n");

                if processed_prompt.contains("${hot_words}") {
                    processed_prompt = processed_prompt.replace("${hot_words}", &hot_words_text);
                } else {
                    input_data_parts.push(format!("```hot_words\n{}\n```", hot_words_text));
                }
            }

            // 2. Inject vocabulary corrections as separate context block (lower priority than hot_words)
            if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                use crate::managers::vocabulary::VocabularyManager;

                // Determine active scopes (App Name + Matching Rules)
                let mut active_scopes = Vec::new();
                if let Some(app) = &app_name {
                    active_scopes.push(app.clone());

                    // Check against App Profiles for rule matches
                    if let Some(window) = &window_title {
                        if let Some(profile) = settings.app_profiles.iter().find(|p| p.name == *app)
                        {
                            for rule in &profile.rules {
                                let is_match = match rule.match_type {
                                    crate::settings::TitleMatchType::Text => {
                                        window.contains(&rule.pattern)
                                    }
                                    crate::settings::TitleMatchType::Regex => {
                                        if let Ok(re) = regex::Regex::new(&rule.pattern) {
                                            re.is_match(window)
                                        } else {
                                            false
                                        }
                                    }
                                };

                                if is_match {
                                    // Use convention: "AppName##RuleID"
                                    active_scopes.push(format!("{}##{}", app, rule.id));
                                    debug!("[PostProcess] Active Rule Match: {}##{}", app, rule.id);
                                }
                            }
                        }
                    }
                }

                // If app is not in App Profiles (not a "known app"), it counts as "Other"
                if let Some(app) = &app_name {
                    if !settings.app_profiles.iter().any(|p| p.name == *app) {
                        active_scopes.push("__OTHER__".to_string());
                    }
                }

                let vocab_manager = VocabularyManager::new(hm.db_path.clone());
                if let Ok(corrections) = vocab_manager.get_active_corrections(Some(&active_scopes))
                {
                    if !corrections.is_empty() {
                        let corrections_text = corrections
                            .iter()
                            .take(20)
                            .map(|c| {
                                format!("- \"{}\" → \"{}\"", c.original_text, c.corrected_text)
                            })
                            .collect::<Vec<_>>()
                            .join("\n");

                        input_data_parts.push(format!(
                            "以下是用户的高频词汇修正，请在适当时参考：\n{}",
                            corrections_text
                        ));

                        debug!(
                            "[PostProcess] Injected {} vocabulary corrections",
                            corrections.len().min(20)
                        );
                    }
                }
            }

            // 3. Inject Semantic Skills block
            if !skills_info.is_empty() {
                let skills_block = format!(
                    "## 可用技能\n\n用户可能正在尝试执行以下某种操作（技能）。请分析用户输入（raw_input）的意图，并根据最匹配的技能进行处理：\n\n{}",
                    skills_info.join("\n")
                );
                input_data_parts.push(skills_block);
            }
        }

        let mut history_entries = Vec::new();
        if settings.post_process_context_enabled {
            if let Some(app) = &app_name {
                if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                    match hm.get_recent_history_texts_for_app(
                        &app,
                        window_title.as_deref(),
                        match_pattern.as_deref(),
                        match_type,
                        settings.post_process_context_limit as usize,
                        history_id,
                    ) {
                        Ok(history) => {
                            history_entries = history;
                        }
                        Err(e) => {
                            error!("Failed to fetch history for context: {}", e);
                        }
                    }
                }
            }
        }

        // Handle context
        if !history_entries.is_empty() && has_context_ref {
            let context_content = history_entries
                .iter()
                .map(|s| format!("- {}", s))
                .collect::<Vec<_>>()
                .join("\n");

            if processed_prompt.contains("${context}") {
                let context_block = format!(
                    "\n\nRecent context for application \"{}\" (Window: \"{}\"):\n{}\n\n",
                    app_name.clone().unwrap_or_default(),
                    window_title.clone().unwrap_or_default(),
                    context_content
                );
                processed_prompt = processed_prompt.replace("${context}", &context_block);
            } else {
                input_data_parts.push(format!("```context\n{}\n```", context_content));
            }
            history_entries.clear();
        }

        // Build final input data message
        let input_data_message = if input_data_parts.is_empty() {
            None
        } else {
            Some(format!("## 输入数据\n\n{}", input_data_parts.join("\n\n")))
        };

        // Build fallback message
        let fallback_message = if !has_output_ref
            && !has_select_ref
            && !has_raw_input_ref
            && !transcription_content.is_empty()
        {
            Some(transcription_content.clone())
        } else {
            None
        };

        let (result, err, confidence, reason) = execute_llm_request(
            app_handle,
            settings,
            provider,
            &model,
            &processed_prompt,
            input_data_message.as_deref(),
            fallback_message.as_deref(),
            history_entries,
            app_name.clone(),
            window_title.clone(),
            match_pattern.clone(),
            match_type,
        )
        .await;

        final_result = result;
        last_model = Some(model);
        last_prompt_id = Some(prompt.id.clone());
        last_err = err;
        last_confidence = confidence;
        last_reason = reason;

        if err || final_result.is_none() {
            break;
        }

        // result_text is the result of LLM processing (fully parsed/extracted if JSON was used)
        let result_text = final_result.as_ref().unwrap();
        chain_depth += 1;

        if chain_depth < MAX_CHAIN_DEPTH {
            // Try to match the result against prompts again for the NEXT step in the chain
            let (next_prompt_opt, next_content, is_explicit_match) =
                resolve_prompt_from_text(result_text, &all_prompts, default_prompt, None);

            if let Some(next_prompt) = next_prompt_opt {
                // Only chain if:
                // 1. We matched a DIFFERENT prompt through an EXPLICIT override
                // 2. The first prompt was the DEFAULT prompt (non-explicit match)
                if is_explicit_match
                    && was_default_prompt
                    && chain_depth == 1
                    && next_prompt.id != current_prompt.id
                    && !next_prompt.id.is_empty()
                {
                    info!(
                        "[PostProcess] Chaining detected via explicit match: \"{}\" -> \"{}\". Using extracted text for next call.",
                        current_prompt.name, next_prompt.name
                    );

                    // Notify UI about the second step
                    app_handle
                        .emit("post-process-status", next_prompt.name.clone())
                        .ok();

                    // Persist intermediate result to history if we have an ID
                    if let Some(hid) = history_id {
                        if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                            let _ = hm
                                .update_transcription_post_processing(
                                    hid,
                                    result_text.clone(),
                                    current_prompt.instructions.clone(),
                                    current_prompt.name.clone(),
                                    Some(current_prompt.id.clone()),
                                    last_model.clone(),
                                )
                                .await;
                        }
                    }

                    // For the next iteration, the intermediate result text becomes
                    // the new transcription content.
                    current_prompt = next_prompt;
                    current_input_content = next_content;
                    // The full intermediate text becomes the new raw input for referencing.
                    current_transcription = result_text.clone();
                    continue;
                }
            }
        }

        break;
    }

    (
        final_result,
        last_model,
        last_prompt_id,
        last_err,
        last_confidence,
        last_reason,
    )
}

pub(crate) async fn post_process_text_with_prompt(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    prompt: &LLMPrompt,
    show_overlay: bool,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<u8>,
    Option<String>,
) {
    let provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false, None, None),
    };

    let model = match resolve_effective_model(settings, provider, prompt) {
        Some(m) => m,
        None => return (None, None, Some(prompt.id.clone()), false, None, None),
    };

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    // Keep prompt template as-is, only replace metadata variables
    let mut processed_prompt = prompt.instructions.replace("${prompt}", &prompt.name);

    // Build structured input data message
    let mut input_data_parts: Vec<String> = Vec::new();

    // Add output (transcription content)
    if !transcription.is_empty() {
        input_data_parts.push(format!("```output\n{}\n```", transcription));
    }

    // Add streaming_output if available
    if let Some(streaming) = streaming_transcription {
        if !streaming.is_empty() {
            input_data_parts.push(format!("```streaming_output\n{}\n```", streaming));
        }
    }

    // For manual prompt processing, this is ALWAYS explicit. Use only custom words.
    if !settings.custom_words.is_empty() {
        let hot_words_list = settings
            .custom_words
            .iter()
            .map(|w| format!("- {}", w))
            .collect::<Vec<_>>()
            .join("\n");

        if processed_prompt.contains("${hot_words}") {
            processed_prompt = processed_prompt.replace("${hot_words}", &hot_words_list);
        } else {
            // Add hot words to input data block
            input_data_parts.push(format!("```hot_words\n{}\n```", hot_words_list));
        }
    }

    // Build final input data message
    let input_data_message = if input_data_parts.is_empty() {
        None
    } else {
        Some(format!("## 输入数据\n\n{}", input_data_parts.join("\n\n")))
    };

    // For manual prompt processing, don't enable confidence checking
    let (result, err, confidence, reason) = execute_llm_request(
        app_handle,
        settings,
        provider,
        &model,
        &processed_prompt,
        input_data_message.as_deref(),
        None,       // No fallback for manual prompts
        Vec::new(), // No history for manual prompts
        None,
        None,
        None,
        None,
    )
    .await;

    if let Some(res) = &result {
        info!(
            "Manual LLM Task Completed | Model: {} | Result: {}...",
            model,
            res.chars().take(50).collect::<String>()
        );
    }

    (
        result,
        Some(model),
        Some(prompt.id.clone()),
        err,
        confidence,
        reason,
    )
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        return None;
    }

    let config = if is_simplified {
        BuiltinConfig::Tw2sp
    } else {
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => Some(converter.convert(transcription)),
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}", e);
            None
        }
    }
}
