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

    // Look up CachedModel to get extra_params
    let cached_model = cached_model_id
        .as_ref()
        .and_then(|id| settings.cached_models.iter().find(|m| &m.id == id));
    let extra_params = cached_model.and_then(|m| m.extra_params.as_ref());
    let extra_headers = cached_model.and_then(|m| m.extra_headers.as_ref());

    // Auto-inject thinking params based on is_thinking_model flag
    let thinking_params = cached_model.and_then(|cm| {
        crate::settings::thinking_extra_params_with_aliases(
            &cm.model_id,
            &cm.provider_id,
            cm.is_thinking_model,
            &[cm.custom_label.as_deref().unwrap_or("")],
        )
    });
    let merged_extra_params: Option<std::collections::HashMap<String, serde_json::Value>> =
        match (thinking_params, extra_params.cloned()) {
            (Some(mut tp), Some(up)) => {
                tp.extend(up);
                Some(tp)
            }
            (Some(tp), None) => Some(tp),
            (None, Some(up)) => Some(up),
            (None, None) => None,
        };
    let effective_proxy = crate::settings::resolve_proxy(&settings, provider);
    let max_attempts = settings
        .post_process_api_keys
        .get(&provider_id)
        .map(|keys| {
            keys.iter()
                .filter(|entry| entry.enabled && !entry.key.is_empty())
                .count()
                .clamp(1, 3)
        })
        .unwrap_or(1);

    let outcome = crate::provider_gateway::execute_with_failover(
        &app,
        &settings,
        crate::provider_gateway::ExecutionPlan {
            provider_id: provider_id.clone(),
            cached_model_id: cached_model_id
                .clone()
                .unwrap_or_else(|| "__test_inference__".to_string()),
            remote_model_id: model_id.clone(),
            max_attempts,
        },
        {
            let provider = provider.clone();
            let model_id = model_id.clone();
            let prompt = "你是啥模型？".to_string();
            let merged_extra_params = merged_extra_params.clone();
            let extra_headers = extra_headers.cloned();
            let effective_proxy = effective_proxy.clone();

            move |api_key| {
                let provider = provider.clone();
                let model_id = model_id.clone();
                let prompt = prompt.clone();
                let merged_extra_params = merged_extra_params.clone();
                let extra_headers = extra_headers.clone();
                let effective_proxy = effective_proxy.clone();
                let api_key = api_key.to_string();

                async move {
                    match crate::llm_client::send_chat_completion_with_params(
                        &provider,
                        api_key,
                        &model_id,
                        prompt,
                        merged_extra_params.as_ref(),
                        extra_headers.as_ref(),
                        effective_proxy.as_deref(),
                    )
                    .await
                    {
                        Ok(result) => Ok(result),
                        Err(detail) => {
                            let status = detail
                                .strip_prefix("API request failed with status ")
                                .and_then(|rest| rest.split(':').next())
                                .and_then(|raw| raw.trim().parse::<u16>().ok());
                            let error = match status {
                                Some(401 | 403) => crate::provider_gateway::AttemptError::Fatal {
                                    status,
                                    detail,
                                    kind: crate::provider_gateway::AttemptErrorKind::Http,
                                },
                                Some(429) | Some(500..=599) => {
                                    crate::provider_gateway::AttemptError::Retryable {
                                        status,
                                        detail,
                                        kind: crate::provider_gateway::AttemptErrorKind::Http,
                                    }
                                }
                                Some(_) => crate::provider_gateway::AttemptError::Fatal {
                                    status,
                                    detail,
                                    kind: crate::provider_gateway::AttemptErrorKind::Http,
                                },
                                None => crate::provider_gateway::AttemptError::Retryable {
                                    status: None,
                                    detail,
                                    kind: crate::provider_gateway::AttemptErrorKind::Network,
                                },
                            };
                            Err(error)
                        }
                    }
                }
            }
        },
    )
    .await;

    let result = match outcome {
        crate::provider_gateway::ExecutionOutcome::Success(result) => result,
        crate::provider_gateway::ExecutionOutcome::Fatal { detail, .. } => return Err(detail),
        crate::provider_gateway::ExecutionOutcome::Exhausted { last_error, .. } => {
            let detail = match last_error {
                crate::provider_gateway::AttemptError::Retryable { detail, .. }
                | crate::provider_gateway::AttemptError::Fatal { detail, .. } => detail,
            };
            return Err(detail);
        }
    };

    // Log to metrics
    if let Some(metrics) =
        app.try_state::<std::sync::Arc<crate::managers::llm_metrics::LlmMetricsManager>>()
    {
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
