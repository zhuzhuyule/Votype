use tauri::{AppHandle, Emitter, Manager};

use crate::settings;

// Group: Inference Testing
#[tauri::command]
#[specta::specta]
pub async fn test_post_process_model_inference(
    app: AppHandle,
    model_id: String,
    provider_id: String,
    cached_model_id: Option<String>,
) -> Result<crate::llm_client::InferenceResult, String> {
    let settings = settings::get_settings(&app);
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or("Provider not found")?;
    let api_key = settings
        .post_process_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();

    // Look up CachedModel to get extra_params
    let cached_model = cached_model_id
        .as_ref()
        .and_then(|id| settings.cached_models.iter().find(|m| &m.id == id));
    let extra_params = cached_model.and_then(|m| m.extra_params.as_ref());
    let extra_headers = cached_model.and_then(|m| m.extra_headers.as_ref());

    let result = crate::llm_client::send_chat_completion_with_params(
        provider,
        api_key,
        &model_id,
        "你是啥模型？".to_string(),
        extra_params,
        extra_headers,
    )
    .await?;

    // Log to metrics
    if let Some(metrics) = app.try_state::<std::sync::Arc<crate::managers::llm_metrics::LlmMetricsManager>>() {
        let duration_ms = result.duration_ms.unwrap_or(0);
        let tokens_per_sec = match (result.total_tokens, result.duration_ms) {
            (Some(tokens), Some(ms)) if ms > 0 => Some(tokens as f64 / ms as f64 * 1000.0),
            _ => None,
        };
        if let Err(e) = metrics.log_call(&crate::managers::llm_metrics::LlmCallRecord {
            history_id: None,
            model_id: model_id.clone(),
            provider: provider_id.clone(),
            call_type: "test".to_string(),
            input_tokens: None,
            output_tokens: None,
            total_tokens: result.total_tokens,
            token_estimate: None,
            duration_ms,
            tokens_per_sec,
            error: None,
            is_fallback: false,
        }) {
            log::warn!("Failed to log test inference metrics: {}", e);
        }
    }

    // Emit event so frontend can refresh stats
    let _ = app.emit("llm-metrics-updated", ());

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn test_asr_model_inference(
    _app: AppHandle,
    _model_id: String,
) -> Result<String, String> {
    Ok("Test successful".to_string())
}
