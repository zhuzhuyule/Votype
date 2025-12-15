use crate::active_window;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info};
use tauri::AppHandle;

fn clean_response_content(content: &str) -> String {
    content
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
        .trim()
        .to_string()
}

pub(crate) async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    show_overlay: bool,
) -> Option<String> {
    debug!("=== POST-PROCESSING DEBUG START ===");
    debug!("Post-processing enabled: {}", settings.post_process_enabled);
    debug!("Input transcription length: {} chars", transcription.len());
    if let Some(s) = streaming_transcription {
        debug!("Input streaming transcription length: {} chars", s.len());
    }

    let transcription_preview_end = transcription
        .char_indices()
        .nth(50)
        .map(|(i, _)| i)
        .unwrap_or(transcription.len());
    debug!(
        "Input transcription preview: '{}...'",
        &transcription[..transcription_preview_end]
    );

    if !settings.post_process_enabled {
        debug!("Post-processing DISABLED - returning early");
        return None;
    }

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => {
            debug!("Selected provider: {} ({})", provider.label, provider.id);
            provider
        }
        None => {
            info!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            info!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt,
        None => {
            info!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.prompt.trim().is_empty() {
        info!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    let target_model_cache_id = prompt
        .model_id
        .as_ref()
        .or(settings.selected_prompt_model_id.as_ref());

    let model = if let Some(selected_model_id) = target_model_cache_id {
        settings
            .cached_models
            .iter()
            .find(|m| m.id == *selected_model_id && m.provider_id == provider.id)
            .map(|m| m.model_id.clone())
    } else {
        None
    }
    .or_else(|| settings.post_process_models.get(&provider.id).cloned())
    .unwrap_or_default();

    if model.trim().is_empty() {
        info!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    info!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    if show_overlay {
        show_llm_processing_overlay(app_handle);
    }

    let processed_prompt = prompt
        .prompt
        .replace("${output}", transcription)
        .replace("${streaming_output}", streaming_transcription.unwrap_or(""));

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not currently available on this device");
                return None;
            }

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&processed_prompt, token_limit) {
                Ok(result) => {
                    if result.trim().is_empty() {
                        None
                    } else {
                        Some(result)
                    }
                }
                Err(err) => {
                    error!("Apple Intelligence post-processing failed: {}", err);
                    None
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return None;
        }
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = match crate::llm_client::create_client(&provider, api_key) {
        Ok(client) => client,
        Err(err) => {
            error!(
                "Failed to create LLM client for provider '{}': {}",
                provider.id, err
            );
            return None;
        }
    };

    let active_window_snapshot = active_window::fetch_active_window().ok();
    if let Some(info) = &active_window_snapshot {
        debug!(
            "Active window during post-processing: app='{}' title='{}' pid={} window_id={}",
            info.app_name, info.title, info.process_id, info.window_id
        );
    }

    let msg = ChatCompletionRequestUserMessageArgs::default()
        .content(processed_prompt)
        .build()
        .ok()
        .map(ChatCompletionRequestMessage::User)?;

    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(vec![msg])
        .build()
        .ok()?;

    let resp = match client.chat().create(req).await {
        Ok(resp) => resp,
        Err(err) => {
            // Keep existing fallback behavior: try to extract some content from errors.
            let error_str = format!("{:?}", err);
            error!("Post-processing request failed: {}", error_str);

            if let Some(content_start) = error_str.find("\\\"content\\\":\\\"") {
                if let Some(content_end) = error_str[content_start + 12..].find("\\\"") {
                    let content = &error_str[content_start + 12..content_start + 12 + content_end];
                    return Some(clean_response_content(content));
                }
            }
            return None;
        }
    };

    let content = resp
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_default();

    let out = clean_response_content(&content);
    if out.trim().is_empty() {
        None
    } else {
        debug!("=== POST-PROCESSING DEBUG END ===");
        Some(out)
    }
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
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
            error!(
                "Failed to initialize OpenCC converter: {}. Falling back to original transcription.",
                e
            );
            None
        }
    }
}
