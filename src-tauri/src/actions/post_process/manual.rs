use crate::overlay::show_llm_processing_overlay;
use crate::settings::{AppSettings, LLMPrompt};
use log::info;
use tauri::AppHandle;

pub async fn post_process_text_with_prompt(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    prompt: &LLMPrompt,
    show_overlay: bool,
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
    let processed_prompt = prompt.instructions.replace("${prompt}", &prompt.name);

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

    // Build final input data message
    let input_data_message = if input_data_parts.is_empty() {
        None
    } else {
        Some(format!("## 输入数据\n\n{}", input_data_parts.join("\n\n")))
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

    (result, Some(model), Some(prompt.id.clone()), err)
}
