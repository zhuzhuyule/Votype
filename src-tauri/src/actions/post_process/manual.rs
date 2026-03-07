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

    // Keep prompt template as-is, only replace metadata variables
    let mut processed_prompt = prompt.instructions.replace("${prompt}", &prompt.name);

    // Check which variables are referenced in the prompt template
    let prompt_template = &prompt.instructions;
    let has_output_ref = prompt_template.contains("${output}");
    let has_streaming_ref = prompt_template.contains("${streaming_output}");
    let has_context_ref = prompt_template.contains("${context}");
    let has_app_name_ref = prompt_template.contains("${app_name}");
    let has_window_title_ref = prompt_template.contains("${window_title}");
    let has_time_ref = prompt_template.contains("${time}");

    // Strip data-block variable markers from prompt text after detection.
    // These variables inject data via separate message blocks, not inline replacement.
    processed_prompt = processed_prompt
        .replace("${output}", "output")
        .replace("${raw_input}", "raw_input")
        .replace("${select}", "select")
        .replace("${streaming_output}", "streaming_output");

    // Build structured input data message - only include variables referenced in prompt
    let mut input_data_parts: Vec<String> = Vec::new();

    // Add output (transcription content) - only if referenced
    if has_output_ref && !transcription.is_empty() {
        input_data_parts.push(format!("```output\n{}\n```", transcription));
    }

    // Add streaming_output if available and referenced
    if has_streaming_ref {
        if let Some(streaming) = streaming_transcription {
            if !streaming.is_empty() {
                input_data_parts.push(format!("```streaming_output\n{}\n```", streaming));
            }
        }
    }

    // Inline-replace app_name if referenced
    if has_app_name_ref {
        if let Some(name) = &app_name {
            if !name.is_empty() {
                processed_prompt = processed_prompt.replace("${app_name}", name);
            }
        }
    }

    // Inline-replace window_title if referenced
    if has_window_title_ref {
        if let Some(title) = &window_title {
            if !title.is_empty() {
                processed_prompt = processed_prompt.replace("${window_title}", title);
            }
        }
    }

    // Inline-replace current time if referenced
    if has_time_ref {
        let now = chrono::Local::now();
        let time_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
        processed_prompt = processed_prompt.replace("${time}", &time_str);
    }

    // Inject hotwords into system prompt
    if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
        let hotword_manager = HotwordManager::new(hm.db_path.clone());

        let scenario = super::pipeline::detect_scenario(&app_name);
        let effective_scenario = scenario.unwrap_or(HotwordScenario::Work);

        if let Ok(injection) = hotword_manager.build_llm_injection(effective_scenario, 40) {
            if !injection.is_empty() {
                processed_prompt.push_str("\n\n");
                processed_prompt.push_str(&injection);
                debug!(
                    "[ManualPostProcess] Injected hotwords for scenario {:?}",
                    effective_scenario
                );
            }
        }
    }

    // Fetch history context
    let mut history_entries = Vec::new();
    if settings.post_process_context_enabled {
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
                    Ok(history) => {
                        history_entries = history;
                    }
                    Err(e) => {
                        error!("Failed to fetch history for manual context: {}", e);
                    }
                }
            }
        }
    }

    // Handle context variable
    if !history_entries.is_empty() && has_context_ref {
        let context_content = history_entries
            .iter()
            .map(|s| format!("- {}", s))
            .collect::<Vec<_>>()
            .join("\n");

        if processed_prompt.contains("${context}") {
            let context_block = format!(
                "\n\n[ASR上下文] 当前应用近期识别的上下文,用于推断讨论的领域和话题,仅供语境参考。\n{}\n\n",
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

    // Build fallback message: if template doesn't reference ${output}, send raw text
    let fallback_message = if !has_output_ref && !transcription.is_empty() {
        Some(transcription.to_string())
    } else {
        None
    };

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
        &processed_prompt,
        input_data_message.as_deref(),
        fallback_message.as_deref(),
        history_entries,
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
