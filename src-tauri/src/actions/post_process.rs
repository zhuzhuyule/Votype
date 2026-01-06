#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{
    AppSettings, LLMPrompt, PostProcessProvider, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info};
use serde::Deserialize;

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
#[derive(Deserialize, Debug)]
struct SkillRouteResponse {
    /// The skill_id to use, or "default" for default processing
    pub skill_id: String,
    /// Confidence score (0-100) of the routing decision
    #[serde(default)]
    pub confidence: Option<u8>,
}

/// Build the system prompt for skill routing
fn build_skill_routing_prompt(prompts: &[LLMPrompt]) -> String {
    let mut skill_list = String::new();
    for prompt in prompts {
        let description = if prompt.description.is_empty() {
            format!("{}.", prompt.name)
        } else {
            prompt.description.clone()
        };
        skill_list.push_str(&format!(
            "- id: \"{}\", name: \"{}\", description: \"{}\"\n",
            prompt.id, prompt.name, description
        ));
    }

    format!(
        r#"你是一个智能意图识别助手。根据用户的语音转录文本，判断应该使用哪个 Skill 来处理。

## 可用 Skills
{skill_list}

## 任务
分析用户输入，选择最合适的 Skill。

**重要原则：**
1. **优先返回 "default"**：如果用户只是在正常说话、陈述事实、记录笔记、写代码、写文档，请务必返回 "default"。
2. **仅在有明确指令时路由**：只有当用户表达了明确的请求（如提问、要求翻译、要求总结、要求执行特定动作）且该请求与某个 Skill 的描述高度匹配时，才返回该 Skill 的 ID。
3. 如果意图不明确或属于多种可能，请返回 "default"。

## 输出格式
严格返回 JSON，不要有任何其他内容：
{{"skill_id": "选择的skill_id或default", "confidence": 0-100的整数}}"#,
        skill_list = skill_list
    )
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
async fn perform_skill_routing(
    _app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    transcription: &str,
) -> Option<String> {
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = crate::llm_client::create_client(provider, api_key).ok()?;

    let routing_prompt = build_skill_routing_prompt(&settings.post_process_prompts);

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

    let req = CreateChatCompletionRequestArgs::default()
        .model(model.to_string())
        .messages(messages)
        .build()
        .ok()?;

    let response = client.chat().create(req).await.ok()?;
    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())?;

    let route = parse_skill_route_response(&content)?;

    // Confidence threshold: Only route if LLM is fairly certain (> 70%)
    if route.skill_id == "default" || route.confidence.unwrap_or(0) < 70 {
        if route.skill_id != "default" {
            debug!(
                "[SkillRouter] Low confidence routing ignored: {} ({:?})",
                route.skill_id, route.confidence
            );
        }
        None
    } else {
        info!(
            "[SkillRouter] Routed to skill: {} (Confidence: {:?})",
            route.skill_id, route.confidence
        );
        Some(route.skill_id)
    }
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

// Helper to find the longest matching candidate with boundary checks, ignoring spaces
fn find_best_match(text: &str, candidates: &[String]) -> Option<(String, usize)> {
    let mut best_match: Option<(String, usize)> = None;

    for candidate in candidates {
        let candidate_lower = candidate.trim().to_lowercase();
        if candidate_lower.is_empty() {
            continue;
        }

        let mut text_chars = text.char_indices();
        let mut cand_chars = candidate_lower.chars();

        let mut matched = true;
        let mut text_match_end_idx = 0;
        let mut last_cand_char = None;

        let mut c_char_opt = cand_chars.next();

        while let Some(c_char) = c_char_opt {
            if c_char.is_whitespace() {
                c_char_opt = cand_chars.next();
                continue;
            }
            last_cand_char = Some(c_char);

            let mut found_char = false;
            while let Some((idx, t_char)) = text_chars.next() {
                if t_char.is_whitespace() {
                    continue;
                }
                if t_char == c_char {
                    found_char = true;
                    text_match_end_idx = idx + t_char.len_utf8();
                    break;
                } else {
                    matched = false;
                    break;
                }
            }

            if !found_char || !matched {
                matched = false;
                break;
            }
            c_char_opt = cand_chars.next();
        }

        if matched {
            let ends_with_latin = last_cand_char.map_or(false, |c| c.is_ascii_alphanumeric());

            let is_boundary_ok = if !ends_with_latin {
                true
            } else if text_match_end_idx == text.len() {
                true
            } else {
                let next_char = text[text_match_end_idx..].chars().next();
                match next_char {
                    Some(c) => !c.is_ascii_alphanumeric(),
                    None => true,
                }
            };

            if is_boundary_ok {
                if best_match
                    .as_ref()
                    .map_or(true, |(_, len)| text_match_end_idx > *len)
                {
                    best_match = Some((candidate.clone(), text_match_end_idx));
                }
            }
        }
    }
    best_match
}

fn resolve_prompt_from_text<'a>(
    text: &str,
    settings: &'a AppSettings,
    override_prompt_id: Option<&str>,
) -> (Option<&'a LLMPrompt>, String, bool) {
    let content_original_trimmed = text.trim();
    if content_original_trimmed.is_empty() {
        let p = get_default_prompt(settings, override_prompt_id);
        return (p, text.to_string(), false);
    }

    let content_lower = content_original_trimmed.to_lowercase();

    // 1. Try matching prompt directly from the ORIGINAL text
    for p in &settings.post_process_prompts {
        let mut triggers = Vec::new();
        if let Some(alias_str) = &p.aliases {
            triggers.extend(
                alias_str
                    .split(&[',', '，'][..])
                    .map(|s| s.trim().to_string()),
            );
        }
        triggers.push(p.name.clone());

        if let Some((_, len)) = find_best_match(&content_lower, &triggers) {
            let char_count = content_lower[..len].chars().count();

            let byte_offset_in_trimmed = content_original_trimmed
                .char_indices()
                .nth(char_count)
                .map(|(i, _)| i)
                .unwrap_or(content_original_trimmed.len());

            let final_content = content_original_trimmed[byte_offset_in_trimmed..]
                .trim_start_matches(|c: char| {
                    c.is_whitespace() || c.is_ascii_punctuation() || "，。！？、".contains(c)
                })
                .to_string();

            return (Some(p), final_content, true);
        }
    }

    // 2. Fallback: Use full text and default prompt
    let p = get_default_prompt(settings, override_prompt_id);
    (p, text.to_string(), false)
}

fn get_default_prompt<'a>(
    settings: &'a AppSettings,
    override_prompt_id: Option<&str>,
) -> Option<&'a LLMPrompt> {
    if let Some(pid) = override_prompt_id {
        if let Some(p) = settings.post_process_prompts.iter().find(|p| &p.id == pid) {
            return Some(p);
        }
    }

    settings
        .post_process_selected_prompt_id
        .as_ref()
        .and_then(|id| settings.post_process_prompts.iter().find(|p| &p.id == id))
        .or_else(|| settings.post_process_prompts.first())
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

    let (mut initial_prompt_opt, mut initial_content, mut is_explicit) =
        resolve_prompt_from_text(transcription, settings, override_prompt_id.as_deref());

    // --- Smart Routing Phase ---
    // If no explicit match and not overridden, try routing via LLM
    if !is_explicit && override_prompt_id.is_none() && !transcription.trim().is_empty() {
        if let Some(p) = initial_prompt_opt {
            if let Some(m) = resolve_effective_model(settings, provider, p) {
                if let Some(skill_id) =
                    perform_skill_routing(app_handle, settings, provider, &m, transcription).await
                {
                    if let Some(routed_prompt) = settings
                        .post_process_prompts
                        .iter()
                        .find(|p| p.id == skill_id)
                    {
                        info!(
                            "[PostProcess] Routed to skill \"{}\" via LLM",
                            routed_prompt.name
                        );
                        initial_prompt_opt = Some(routed_prompt);
                        initial_content = transcription.to_string(); // Use full text for routed skill
                        is_explicit = true; // Use clean context for specific skills

                        // Notify UI about the routed skill
                        app_handle
                            .emit("post-process-status", routed_prompt.name.clone())
                            .ok();
                    }
                }
            }
        }
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

    let mut final_result = None;
    let mut last_model = None;
    let mut last_prompt_id = None;
    let mut last_err = false;
    let mut last_confidence = None;
    let mut last_reason = None;

    while chain_depth < MAX_CHAIN_DEPTH {
        let prompt = current_prompt;
        let transcription_content = &current_input_content;
        let transcription_original = &current_transcription;

        let model = match resolve_effective_model(settings, provider, prompt) {
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

        // Build structured input data message - only include variables referenced in prompt
        let mut input_data_parts: Vec<String> = Vec::new();

        // Add output (transcription content without prefix/alias) - only if referenced
        if has_output_ref && !transcription_content.is_empty() {
            input_data_parts.push(format!("```output\n{}\n```", transcription_content));
        }

        // Add raw_input (full original transcription including prefix/alias) - only if referenced
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
            let text = crate::clipboard::get_selected_text(app_handle).unwrap_or_default();
            if !text.is_empty() {
                input_data_parts.push(format!("```select\n{}\n```", text));
            }
        }

        // Inject hot words and skills - logic depends on whether we had an explicit match
        if is_explicit {
            // Case A: Explicitly matched an alias. Keep context clean, only inject user custom words.
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
                // For hot_words variable: add names and aliases for fuzzy matching
                hot_words.push(p.name.clone());
                if let Some(alias_str) = &p.aliases {
                    let aliases: Vec<String> = alias_str
                        .split(&[',', '，'][..])
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    hot_words.extend(aliases.clone());
                    skills_info.push(format!("- **{}**: (别名: {})", p.name, aliases.join(", ")));
                } else {
                    skills_info.push(format!("- **{}**", p.name));
                }
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

            // 2. Inject Semantic Skills block (NEW)
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
                resolve_prompt_from_text(result_text, settings, None);

            if let Some(next_prompt) = next_prompt_opt {
                // Only chain if we matched a DIFFERENT prompt through an EXPLICIT alias/prefix
                // This ensures we only trigger the second call if the first output actually requested another action.
                if is_explicit_match
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

                    // For the next iteration, the intermediate result text (without the prefix)
                    // becomes the new transcription content.
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
