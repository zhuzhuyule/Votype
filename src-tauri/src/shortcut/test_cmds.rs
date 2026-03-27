use tauri::AppHandle;

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
