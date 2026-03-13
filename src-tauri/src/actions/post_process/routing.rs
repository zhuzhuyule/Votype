use crate::managers::prompt::{self, PromptManager};
use crate::settings;
use crate::settings::{AppSettings, LLMPrompt, PostProcessProvider};
use async_openai::types::CreateChatCompletionRequestArgs;
use log::info;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Build the system prompt for skill routing
pub(super) fn build_skill_routing_prompt(
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
pub(super) fn parse_skill_route_response(content: &str) -> Option<super::SkillRouteResponse> {
    let cleaned = super::core::clean_response_content(content);
    if let Some(json) = super::core::extract_json_block(&cleaned) {
        if let Ok(parsed) = serde_json::from_str::<super::SkillRouteResponse>(&json) {
            return Some(parsed);
        }
    }
    // Try parsing directly
    if let Ok(parsed) = serde_json::from_str::<super::SkillRouteResponse>(&cleaned) {
        return Some(parsed);
    }
    None
}

/// Perform asynchronous skill routing using LLM
/// Returns the full routing response including skill_id, confidence, input_source and extracted_content
pub(super) async fn perform_skill_routing(
    _app_handle: &AppHandle,
    api_key: String,
    prompts: &[LLMPrompt],
    provider: &PostProcessProvider,
    model: &str,
    transcription: &str,
    selected_text: Option<&str>,
) -> Option<super::SkillRouteResponse> {
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

    let prompt_role = super::core::resolve_prompt_message_role(
        &settings::get_settings(_app_handle),
        &provider.id,
        None,
        model,
    );
    if let Some(msg) = super::core::build_instruction_message(prompt_role, routing_prompt) {
        messages.push(msg);
    }

    if let Some(msg) = super::core::build_user_message(transcription.to_string()) {
        messages.push(msg);
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
pub(super) async fn execute_default_polish<'a>(
    app_handle: &AppHandle,
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    default_prompt: &LLMPrompt,
    transcription: &str,
    app_name: Option<String>,
    window_title: Option<String>,
    history_id: Option<i64>,
) -> Option<String> {
    let (actual_provider, model) =
        resolve_effective_model(settings, fallback_provider, default_prompt)?;

    let api_key = settings
        .post_process_api_keys
        .get(&actual_provider.id)
        .cloned()
        .unwrap_or_default();

    let client = crate::llm_client::create_client(actual_provider, api_key).ok()?;

    let hotword_injection = if settings.post_process_hotword_injection_enabled {
        if let Some(hm) =
            app_handle.try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
        {
            let hotword_manager = crate::managers::hotword::HotwordManager::new(hm.db_path.clone());
            let scenario = super::pipeline::detect_scenario(&app_name);
            let effective_scenario = scenario.unwrap_or(crate::settings::HotwordScenario::Work);
            match hotword_manager.build_llm_injection(effective_scenario, 40, Some(transcription)) {
                Ok(injection) if !injection.is_empty() => Some(injection),
                _ => None,
            }
        } else {
            None
        }
    } else {
        None
    };

    let history_entries = if settings.post_process_context_enabled {
        if let Some(app) = &app_name {
            if let Some(hm) =
                app_handle.try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
            {
                hm.get_recent_history_texts_for_app(
                    app,
                    window_title.as_deref(),
                    None,
                    None,
                    settings.post_process_context_limit as usize,
                    history_id,
                )
                .unwrap_or_default()
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // Use PromptBuilder for consistent variable processing
    let built = super::prompt_builder::PromptBuilder::new(default_prompt, transcription)
        .app_name(app_name.as_deref())
        .window_title(window_title.as_deref())
        .history_entries(history_entries)
        .hotword_injection(hotword_injection)
        .injection_policy(super::prompt_builder::InjectionPolicy::for_post_process(
            settings,
        ))
        .build();

    let mut messages = Vec::new();

    // 1. Single system message
    let prompt_role = super::core::resolve_prompt_message_role(
        settings,
        &actual_provider.id,
        default_prompt.model_id.as_deref(),
        &model,
    );
    for system_prompt in built.system_messages {
        if let Some(msg) = super::core::build_instruction_message(prompt_role, system_prompt) {
            messages.push(msg);
        }
    }

    // 2. Single user message
    if let Some(user_content) = built.user_message {
        if let Some(msg) = super::core::build_user_message(user_content) {
            messages.push(msg);
        }
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

    let text = super::core::extract_llm_text(&content);

    info!(
        "[ParallelPolish] Default polish completed, result length: {}",
        text.len()
    );
    Some(text)
}

pub(super) fn resolve_effective_model<'a>(
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    prompt: &LLMPrompt,
) -> Option<(&'a PostProcessProvider, String)> {
    let check_cached_model =
        |model_id_opt: Option<&String>| -> Option<(&'a PostProcessProvider, String)> {
            let id_str = model_id_opt.filter(|id| !id.trim().is_empty())?;
            let cached = settings.cached_models.iter().find(|m| m.id == *id_str)?;
            let provider = settings.post_process_provider(&cached.provider_id)?;
            Some((provider, cached.model_id.clone()))
        };

    if let Some(res) = check_cached_model(prompt.model_id.as_ref()) {
        if !res.1.trim().is_empty() {
            return Some(res);
        }
    }

    if let Some(res) = check_cached_model(settings.selected_prompt_model_id.as_ref()) {
        if !res.1.trim().is_empty() {
            return Some(res);
        }
    }

    if let Some(m) = settings.post_process_models.get(&fallback_provider.id) {
        if !m.trim().is_empty() {
            return Some((fallback_provider, m.clone()));
        }
    }

    None
}

pub(crate) fn resolve_intent_routing_model<'a>(
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
            if cached_model.model_type == crate::settings::ModelType::Text {
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

    let (actual_provider, model) =
        resolve_effective_model(settings, fallback_provider, fallback_prompt)?;
    let api_key = settings
        .post_process_api_keys
        .get(&actual_provider.id)
        .cloned()
        .unwrap_or_default();
    Some((actual_provider, model, api_key))
}

pub(super) fn resolve_prompt_from_text(
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

pub(super) fn get_default_prompt<'a>(
    prompts: &'a [LLMPrompt],
    selected_id: Option<&str>,
    override_prompt_id: Option<&str>,
) -> Option<&'a LLMPrompt> {
    if let Some(pid) = override_prompt_id {
        if let Some(p) = prompts.iter().find(|p| p.id == pid) {
            return Some(p);
        }
    }

    if let Some(id) = selected_id {
        if let Some(p) = prompts.iter().find(|p| p.id == id) {
            return Some(p);
        }
    }

    prompts.first()
}
