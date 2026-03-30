use crate::managers::prompt::{self, PromptManager};
use crate::settings;
use crate::settings::{AppSettings, LLMPrompt, PostProcessProvider};
use async_openai::types::CreateChatCompletionRequestArgs;
use log::info;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Action determined by the smart routing pre-processor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SmartAction {
    /// Text needs no correction — output as-is.
    PassThrough,
    /// Minor corrections needed — delegate to lightweight model + prompt.
    LitePolish,
    /// Complex content — needs full polish pipeline.
    FullPolish,
}

/// Execute smart action routing using the intent model.
/// Returns an IntentDecision, or None on failure (caller should fallback to full polish).
pub(super) async fn execute_smart_action_routing(
    app_handle: &AppHandle,
    settings: &AppSettings,
    fallback_provider: &PostProcessProvider,
    transcription: &str,
) -> Option<super::IntentDecision> {
    // Resolve intent model
    let default_prompt = settings.post_process_prompts.first()?;
    let (provider, model, _api_key) =
        resolve_intent_routing_model(settings, fallback_provider, default_prompt)?;

    // Load the smart routing prompt
    let prompt_manager = app_handle.state::<Arc<PromptManager>>();
    let system_prompt = prompt_manager
        .get_prompt(app_handle, "system_smart_routing")
        .unwrap_or_else(|_| {
            "You are a text router. Output JSON: {\"action\": \"pass_through|lite_polish|full_polish\", \"needs_hotword\": true|false}".to_string()
        });

    let (result, _err, _error_msg, token_count) = super::core::execute_llm_request(
        app_handle,
        settings,
        provider,
        &model,
        None,
        &system_prompt,
        Some(transcription),
        None,
        None,
        None,
        None,
    )
    .await;

    let response_text = result?;

    // Parse JSON response — try direct parse, then extract JSON from possible markdown wrapper
    let parsed: serde_json::Value = serde_json::from_str(&response_text)
        .or_else(|_| {
            let trimmed = response_text.trim();
            let json_str = trimmed
                .find('{')
                .and_then(|start| trimmed.rfind('}').map(|end| &trimmed[start..=end]))
                .unwrap_or(trimmed);
            serde_json::from_str(json_str)
        })
        .ok()?;

    let action_str = parsed
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("full_polish");

    let needs_hotword = parsed
        .get("needs_hotword")
        .and_then(|v| v.as_bool())
        .unwrap_or(true); // Default to true (safe fallback)

    let action = match action_str {
        "pass_through" => SmartAction::PassThrough,
        "lite_polish" => SmartAction::LitePolish,
        _ => SmartAction::FullPolish,
    };

    info!(
        "[SmartRouting] Action={} needs_hotword={} tokens={:?} input_len={}",
        action_str,
        needs_hotword,
        token_count,
        transcription.chars().count()
    );

    Some(super::IntentDecision {
        action,
        needs_hotword,
        token_count,
    })
}

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
/// Result from skill routing that includes token usage
pub(super) struct SkillRoutingResult {
    pub response: super::SkillRouteResponse,
    pub token_count: Option<i64>,
}

pub(super) async fn perform_skill_routing(
    _app_handle: &AppHandle,
    api_key: String,
    prompts: &[LLMPrompt],
    provider: &PostProcessProvider,
    model: &str,
    transcription: &str,
    selected_text: Option<&str>,
) -> Option<SkillRoutingResult> {
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
    if let Some(msg) = super::core::build_instruction_message(prompt_role, routing_prompt.clone()) {
        messages.push(msg);
    }

    if let Some(msg) = super::core::build_user_message(transcription.to_string()) {
        messages.push(msg);
    }

    if crate::DEBUG_LOG_SKILL_ROUTING.load(std::sync::atomic::Ordering::Relaxed) {
        super::core::preview_multiline("SkillRouter.SystemPrompt", &routing_prompt);
        super::core::preview_multiline("SkillRouter.UserMessage", transcription);
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

    // Extract token count from usage
    let token_count = response.usage.as_ref().map(|u| u.total_tokens as i64);

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

    if crate::DEBUG_LOG_SKILL_ROUTING.load(std::sync::atomic::Ordering::Relaxed) {
        info!("[SkillRouter] Raw LLM response: {}", content);
    }

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
        Some(SkillRoutingResult {
            response: route,
            token_count,
        })
    }
}

/// Result from default polish that includes token usage
pub(super) struct DefaultPolishResult {
    pub text: String,
    pub token_count: Option<i64>,
}

/// Execute default polish request for parallel processing.
/// This is a simplified version that only runs the default prompt.
/// Returns the polished text with token count, or None if failed.
pub(super) async fn execute_default_polish<'a>(
    app_handle: &AppHandle,
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    default_prompt: &LLMPrompt,
    transcription: &str,
    app_name: Option<String>,
    window_title: Option<String>,
    history_id: Option<i64>,
) -> Option<DefaultPolishResult> {
    let (actual_provider, model) =
        resolve_effective_model(settings, fallback_provider, default_prompt)?;

    let hotword_injection = if settings.post_process_hotword_injection_enabled {
        if let Some(hm) =
            app_handle.try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
        {
            let hotword_manager = crate::managers::hotword::HotwordManager::new(hm.db_path.clone());
            let scenario = super::pipeline::detect_scenario(&app_name);
            let effective_scenario = scenario.unwrap_or(crate::settings::HotwordScenario::Work);
            match hotword_manager.build_contextual_injection(
                effective_scenario,
                transcription,
                transcription,
                app_name.as_deref(),
            ) {
                Ok(injection)
                    if !(injection.person_names.is_empty()
                        && injection.product_names.is_empty()
                        && injection.domain_terms.is_empty()
                        && injection.hotwords.is_empty()) =>
                {
                    let total_terms = injection.person_names.len()
                        + injection.product_names.len()
                        + injection.domain_terms.len()
                        + injection.hotwords.len();
                    info!(
                        "[ParallelPolish] Hotwords injected: scenario={:?}, terms={}",
                        effective_scenario, total_terms
                    );
                    log::debug!(
                        "[ParallelPolish] Hotword summary:\n{}",
                        crate::managers::hotword::HotwordManager::summarize_injection(&injection)
                    );
                    Some(injection)
                }
                Ok(_) => {
                    info!(
                        "[ParallelPolish] Hotword injection skipped: scenario={:?}, no active matches or entries",
                        effective_scenario
                    );
                    None
                }
                Err(e) => {
                    log::error!("[ParallelPolish] Failed to build hotword injection: {}", e);
                    None
                }
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

    // Resolve convention-based references
    let app_category = app_name
        .as_deref()
        .map(crate::app_category::from_app_name)
        .unwrap_or("Other");
    let resolved_refs = super::reference_resolver::resolve_references(
        default_prompt.file_path.as_deref(),
        app_name.as_deref(),
        app_category,
    );
    let refs_content = if resolved_refs.count > 0 {
        log::info!(
            "[ParallelPolish] Injecting {} reference(s): {:?}",
            resolved_refs.count,
            resolved_refs.matched_files,
        );
        Some(resolved_refs.content)
    } else {
        None
    };

    // Use PromptBuilder for consistent variable processing
    let built = super::prompt_builder::PromptBuilder::new(default_prompt, transcription)
        .app_name(app_name.as_deref())
        .window_title(window_title.as_deref())
        .history_entries(history_entries)
        .hotword_injection(hotword_injection)
        .resolved_references(refs_content)
        .app_language(&settings.app_language)
        .injection_policy(super::prompt_builder::InjectionPolicy::for_post_process(
            settings,
        ))
        .build();

    let cached_model_id = default_prompt
        .model_id
        .as_deref()
        .or(settings.selected_prompt_model_id.as_deref());

    // Resolve preset parameters
    let presets_config =
        app_handle.try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>();
    let merged_extra_params = if let Some(config) = presets_config {
        let cached_model = cached_model_id
            .and_then(|id| settings.cached_models.iter().find(|m| m.id == id))
            .or_else(|| {
                settings
                    .cached_models
                    .iter()
                    .find(|m| m.model_id == model && m.provider_id == actual_provider.id)
            });

        let preset_params = crate::managers::model_preset::resolve_preset_params(
            default_prompt.param_preset.as_deref(),
            cached_model.and_then(|m| m.model_family.as_deref()),
            &model,
            &config,
        );

        if preset_params.is_empty() {
            None
        } else {
            let merged = crate::managers::model_preset::merge_params(
                preset_params,
                cached_model.and_then(|m| m.extra_params.as_ref()),
            );
            Some(merged)
        }
    } else {
        None
    };

    let (result, _err, _error_message, api_token_count) =
        super::core::execute_llm_request_with_messages(
            app_handle,
            settings,
            actual_provider,
            &model,
            cached_model_id,
            &built.system_messages,
            built.user_message.as_deref(),
            app_name,
            window_title,
            None,
            None,
            merged_extra_params.as_ref(),
        )
        .await;

    if let Some(ref text) = result {
        info!(
            "[ParallelPolish] Default polish completed, result length: {}",
            text.len()
        );
    }
    result.map(|text| DefaultPolishResult {
        text,
        token_count: api_token_count,
    })
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
