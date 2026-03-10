use crate::managers::history::HistoryManager;
use crate::managers::HotwordManager;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{AppSettings, HotwordScenario, LLMPrompt};
use log::{debug, error, info};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub async fn post_process_text_with_prompt(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    prompt: &LLMPrompt,
    show_overlay: bool,
    app_name: Option<String>,
    window_title: Option<String>,
    history_id: Option<i64>,
) -> (Option<String>, Option<String>, Option<String>, bool) {
    let fallback_provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false),
    };

    let (actual_provider, model) =
        match super::routing::resolve_effective_model(settings, fallback_provider, prompt) {
            Some((p, m)) => (p, m),
            None => return (None, None, Some(prompt.id.clone()), false),
        };

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    // Build hotword injection
    let hotword_injection = if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
        let hotword_manager = HotwordManager::new(hm.db_path.clone());
        let scenario = super::pipeline::detect_scenario(&app_name);
        let effective_scenario = scenario.unwrap_or(HotwordScenario::Work);
        match hotword_manager.build_llm_injection(effective_scenario, 40) {
            Ok(injection) if !injection.is_empty() => {
                debug!(
                    "[ManualPostProcess] Injected hotwords for scenario {:?}",
                    effective_scenario
                );
                Some(injection)
            }
            _ => None,
        }
    } else {
        None
    };

    // Fetch history context
    let history_entries = if settings.post_process_context_enabled {
        if let Some(app) = &app_name {
            if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                match hm.get_recent_history_texts_for_app(
                    app,
                    window_title.as_deref(),
                    None,
                    None,
                    settings.post_process_context_limit as usize,
                    history_id,
                ) {
                    Ok(history) => history,
                    Err(e) => {
                        error!("Failed to fetch history for manual context: {}", e);
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // Use PromptBuilder for unified variable processing
    let built = super::prompt_builder::PromptBuilder::new(prompt, transcription)
        .streaming_transcription(streaming_transcription)
        .app_name(app_name.as_deref())
        .window_title(window_title.as_deref())
        .history_entries(history_entries)
        .hotword_injection(hotword_injection)
        .build();

    let cached_model_id = prompt
        .model_id
        .as_deref()
        .or(settings.selected_prompt_model_id.as_deref());
    let (result, err) = super::core::execute_llm_request(
        app_handle,
        settings,
        actual_provider,
        &model,
        cached_model_id,
        &built.system_prompt,
        built.user_message.as_deref(),
        app_name,
        window_title,
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

    (result, Some(model), Some(prompt.id.clone()), err)
}
