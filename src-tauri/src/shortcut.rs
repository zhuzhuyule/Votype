use log::{error, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::actions::ACTION_MAP;
use crate::settings::ShortcutBinding;
use crate::settings::{
    self, get_settings, CachedModel, ClipboardHandling, LLMPrompt, ModelType, OverlayPosition,
    PasteMethod, PostProcessProvider, SoundTheme,
};
use crate::ManagedToggleState;
use chrono::Utc;

pub fn init_shortcuts(app: &AppHandle) {
    let settings = settings::load_or_create_app_settings(app);

    // Register shortcuts with the bindings from settings
    for (_id, binding) in settings.bindings {
        if let Err(e) = _register_shortcut(app, binding) {
            error!("Failed to register shortcut {} during init: {}", _id, e);
        }
    }
}

#[derive(Serialize)]
pub struct BindingResponse {
    success: bool,
    binding: Option<ShortcutBinding>,
    error: Option<String>,
}

#[tauri::command]
pub fn change_binding(
    app: AppHandle,
    id: String,
    binding: String,
) -> Result<BindingResponse, String> {
    let mut settings = settings::get_settings(&app);

    // Get the binding to modify
    let binding_to_modify = match settings.bindings.get(&id) {
        Some(binding) => binding.clone(),
        None => {
            let error_msg = format!("Binding with id '{}' not found", id);
            warn!("change_binding error: {}", error_msg);
            return Ok(BindingResponse {
                success: false,
                binding: None,
                error: Some(error_msg),
            });
        }
    };

    // Unregister the existing binding
    if let Err(e) = _unregister_shortcut(&app, binding_to_modify.clone()) {
        let error_msg = format!("Failed to unregister shortcut: {}", e);
        error!("change_binding error: {}", error_msg);
    }

    // Validate the new shortcut before we touch the current registration
    if let Err(e) = validate_shortcut_string(&binding) {
        warn!("change_binding validation error: {}", e);
        return Err(e);
    }

    // Create an updated binding
    let mut updated_binding = binding_to_modify;
    updated_binding.current_binding = binding;

    // Register the new binding
    if let Err(e) = _register_shortcut(&app, updated_binding.clone()) {
        let error_msg = format!("Failed to register shortcut: {}", e);
        error!("change_binding error: {}", error_msg);
        return Ok(BindingResponse {
            success: false,
            binding: None,
            error: Some(error_msg),
        });
    }

    // Update the binding in the settings
    settings.bindings.insert(id, updated_binding.clone());

    // Save the settings
    settings::write_settings(&app, settings);

    // Return the updated binding
    Ok(BindingResponse {
        success: true,
        binding: Some(updated_binding),
        error: None,
    })
}

#[tauri::command]
pub fn reset_binding(app: AppHandle, id: String) -> Result<BindingResponse, String> {
    let binding = settings::get_stored_binding(&app, &id);

    return change_binding(app, id, binding.default_binding);
}

#[tauri::command]
pub fn change_ptt_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    // TODO if the setting is currently false, we probably want to
    // cancel any ongoing recordings or actions
    settings.push_to_talk = enabled;

    settings::write_settings(&app, settings);

    Ok(())
}

#[tauri::command]
pub fn change_audio_feedback_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_audio_feedback_volume_setting(app: AppHandle, volume: f32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback_volume = volume;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_sound_theme_setting(app: AppHandle, theme: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match theme.as_str() {
        "marimba" => SoundTheme::Marimba,
        "pop" => SoundTheme::Pop,
        "custom" => SoundTheme::Custom,
        other => {
            warn!("Invalid sound theme '{}', defaulting to marimba", other);
            SoundTheme::Marimba
        }
    };
    settings.sound_theme = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_translate_to_english_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translate_to_english = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_selected_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selected_language = language;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_overlay_position_setting(app: AppHandle, position: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match position.as_str() {
        "none" => OverlayPosition::None,
        "top" => OverlayPosition::Top,
        "bottom" => OverlayPosition::Bottom,
        "follow" => OverlayPosition::FollowCursor,
        other => {
            warn!("Invalid overlay position '{}', defaulting to bottom", other);
            OverlayPosition::Bottom
        }
    };
    settings.overlay_position = parsed;
    settings::write_settings(&app, settings);

    // Update overlay position without recreating window
    crate::utils::update_overlay_position(&app);

    Ok(())
}

#[tauri::command]
pub fn change_debug_mode_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.debug_mode = enabled;
    settings::write_settings(&app, settings);

    // Update the console log level dynamically
    let console_level = if enabled {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    
    // We need to access the atomic from lib.rs. 
    // Since it's in the crate root, we can access it via crate::CONSOLE_LOG_LEVEL
    use std::sync::atomic::Ordering;
    crate::CONSOLE_LOG_LEVEL.store(console_level as u8, Ordering::Relaxed);
    
    log::info!("Debug mode changed to: {}. Console log level set to: {:?}", enabled, console_level);

    // Emit event to notify frontend of debug mode change
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "debug_mode",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_start_hidden_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.start_hidden = enabled;
    settings::write_settings(&app, settings);

    // Notify frontend
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "start_hidden",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_autostart_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.autostart_enabled = enabled;
    settings::write_settings(&app, settings);

    // Apply the autostart setting immediately
    let autostart_manager = app.autolaunch();
    if enabled {
        let _ = autostart_manager.enable();
    } else {
        let _ = autostart_manager.disable();
    }

    // Notify frontend
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "autostart_enabled",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn update_custom_words(app: AppHandle, words: Vec<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.custom_words = words;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_word_correction_threshold_setting(
    app: AppHandle,
    threshold: f64,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.word_correction_threshold = threshold;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_paste_method_setting(app: AppHandle, method: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match method.as_str() {
        "ctrl_v" => PasteMethod::CtrlV,
        "direct" => PasteMethod::Direct,
        #[cfg(not(target_os = "macos"))]
        "shift_insert" => PasteMethod::ShiftInsert,
        other => {
            warn!("Invalid paste method '{}', defaulting to ctrl_v", other);
            PasteMethod::CtrlV
        }
    };
    settings.paste_method = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_clipboard_handling_setting(app: AppHandle, handling: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match handling.as_str() {
        "dont_modify" => ClipboardHandling::DontModify,
        "copy_to_clipboard" => ClipboardHandling::CopyToClipboard,
        other => {
            warn!(
                "Invalid clipboard handling '{}', defaulting to dont_modify",
                other
            );
            ClipboardHandling::DontModify
        }
    };
    settings.clipboard_handling = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_post_process_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_post_process_base_url_setting(
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let label = settings
        .post_process_provider(&provider_id)
        .map(|provider| provider.label.clone())
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    let provider = settings
        .post_process_provider_mut(&provider_id)
        .expect("Provider looked up above must exist");

    if !provider.allow_base_url_edit {
        return Err(format!(
            "Provider '{}' does not allow editing the base URL",
            label
        ));
    }

    provider.base_url = base_url;
    settings::write_settings(&app, settings);
    Ok(())
}

/// Generic helper to validate provider exists
fn validate_provider_exists(
    settings: &settings::AppSettings,
    provider_id: &str,
) -> Result<(), String> {
    if !settings
        .post_process_providers
        .iter()
        .any(|provider| provider.id == provider_id)
    {
        return Err(format!("Provider '{}' not found", provider_id));
    }
    Ok(())
}

#[tauri::command]
pub fn change_post_process_api_key_setting(
    app: AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_api_keys.insert(provider_id, api_key);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_post_process_model_setting(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    println!(
        "DEBUG: change_post_process_model_setting called with provider_id='{}', model='{}'",
        provider_id, model
    );
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;

    println!(
        "DEBUG: Before update - post_process_models: {:?}",
        settings.post_process_models
    );
    settings
        .post_process_models
        .insert(provider_id.clone(), model.clone());
    println!(
        "DEBUG: After update - post_process_models: {:?}",
        settings.post_process_models
    );

    settings::write_settings(&app, settings);
    println!("DEBUG: Settings saved successfully");
    Ok(())
}

#[tauri::command]
pub fn set_post_process_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_provider_id = provider_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn add_post_process_prompt(
    app: AppHandle,
    name: String,
    prompt: String,
    model_id: Option<String>,
) -> Result<LLMPrompt, String> {
    let mut settings = settings::get_settings(&app);

    // Generate unique ID using timestamp and random component
    let id = format!("prompt_{}", chrono::Utc::now().timestamp_millis());

    let new_prompt = LLMPrompt {
        id: id.clone(),
        name,
        prompt,
        model_id,
    };

    settings.post_process_prompts.push(new_prompt.clone());
    settings::write_settings(&app, settings);

    Ok(new_prompt)
}

#[tauri::command]
pub fn update_post_process_prompt(
    app: AppHandle,
    id: String,
    name: String,
    prompt: String,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    if let Some(existing_prompt) = settings
        .post_process_prompts
        .iter_mut()
        .find(|p| p.id == id)
    {
        existing_prompt.name = name;
        existing_prompt.prompt = prompt;
        existing_prompt.model_id = model_id;
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err(format!("Prompt with id '{}' not found", id))
    }
}

#[tauri::command]
pub fn delete_post_process_prompt(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    // Don't allow deleting the last prompt
    if settings.post_process_prompts.len() <= 1 {
        return Err("Cannot delete the last prompt".to_string());
    }

    // Find and remove the prompt
    let original_len = settings.post_process_prompts.len();
    settings.post_process_prompts.retain(|p| p.id != id);

    if settings.post_process_prompts.len() == original_len {
        return Err(format!("Prompt with id '{}' not found", id));
    }

    // If the deleted prompt was selected, select the first one or None
    if settings.post_process_selected_prompt_id.as_ref() == Some(&id) {
        settings.post_process_selected_prompt_id =
            settings.post_process_prompts.first().map(|p| p.id.clone());
    }

    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub async fn fetch_post_process_models(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let settings = settings::get_settings(&app);

    // Find the provider
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    // Get API key
    let api_key = settings
        .post_process_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();

    // Skip fetching if no API key for providers that typically need one
    if api_key.trim().is_empty() && provider.id != "custom" {
        return Err(format!(
            "API key is required for {}. Please add an API key to list available models.",
            provider.label
        ));
    }

    // TODO: In the future, we can use async-openai's models API:
    // let client = crate::llm_client::create_client(provider, api_key)?;
    // let response = client.models().list().await?;
    // return Ok(response.data.iter().map(|m| m.id.clone()).collect());

    // For now, use manual HTTP request to have more control over the endpoint
    fetch_models_manual(provider, api_key).await
}

#[tauri::command]
pub fn add_custom_provider(
    app: AppHandle,
    label: String,
    base_url: String,
    models_endpoint: Option<String>,
) -> Result<PostProcessProvider, String> {
    let mut settings = settings::get_settings(&app);

    let id = format!("custom-{}", Utc::now().timestamp_millis());
    let provider = PostProcessProvider {
        id: id.clone(),
        label: label.trim().to_string(),
        base_url: base_url.trim().trim_end_matches('/').to_string(),
        allow_base_url_edit: true,
        models_endpoint: models_endpoint
            .map(|endpoint| {
                let trimmed = endpoint.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .flatten(),
    };

    settings
        .post_process_api_keys
        .insert(id.clone(), String::new());
    settings
        .post_process_models
        .insert(id.clone(), String::new());
    settings.post_process_providers.push(provider.clone());
    settings::write_settings(&app, settings);

    Ok(provider)
}

#[tauri::command]
pub fn update_custom_provider(
    app: AppHandle,
    provider_id: String,
    label: Option<String>,
    base_url: Option<String>,
    models_endpoint: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    let provider = settings
        .post_process_providers
        .iter_mut()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    if !provider.allow_base_url_edit {
        return Err("Only custom providers can be modified".to_string());
    }

    if let Some(new_label) = label {
        if !new_label.trim().is_empty() {
            provider.label = new_label.trim().to_string();
        }
    }

    if let Some(new_base_url) = base_url {
        if !new_base_url.trim().is_empty() {
            provider.base_url = new_base_url.trim().trim_end_matches('/').to_string();
        }
    }

    if let Some(new_endpoint) = models_endpoint {
        let cleaned = new_endpoint.trim();
        provider.models_endpoint = if cleaned.is_empty() {
            None
        } else {
            Some(cleaned.to_string())
        };
    }

    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn remove_custom_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    let idx = settings
        .post_process_providers
        .iter()
        .position(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    if !settings.post_process_providers[idx].allow_base_url_edit {
        return Err("Only custom providers can be removed".to_string());
    }

    let _removed_provider = settings.post_process_providers.remove(idx);

    let removed_cached_ids: Vec<String> = settings
        .cached_models
        .iter()
        .filter(|cached| cached.provider_id == provider_id)
        .map(|cached| cached.id.clone())
        .collect();

    settings
        .cached_models
        .retain(|cached| cached.provider_id != provider_id);

    if let Some(asr_id) = settings.selected_asr_model_id.clone() {
        if removed_cached_ids.contains(&asr_id) {
            settings.selected_asr_model_id = None;
        }
    }
    if let Some(prompt_id) = settings.selected_prompt_model_id.clone() {
        if removed_cached_ids.contains(&prompt_id) {
            settings.selected_prompt_model_id = None;
        }
    }

    settings.post_process_api_keys.remove(&provider_id);
    settings.post_process_models.remove(&provider_id);

    if settings.post_process_provider_id == provider_id {
        settings.post_process_provider_id = settings
            .post_process_providers
            .get(0)
            .map(|provider| provider.id.clone())
            .unwrap_or_else(|| "openai".to_string());
    }

    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn add_cached_model(app: AppHandle, model: CachedModel) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    if settings
        .cached_models
        .iter()
        .any(|cached| cached.id == model.id)
    {
        return Err("Model already cached".to_string());
    }

    settings.cached_models.push(model);
    settings::write_settings(&app, settings);

    Ok(())
}

#[tauri::command]
pub fn update_cached_model_capability(
    app: AppHandle,
    model_id: String,
    model_type: ModelType,
    custom_label: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    if let Some(model) = settings
        .cached_models
        .iter_mut()
        .find(|cached| cached.id == model_id)
    {
        model.model_type = model_type;
        model.custom_label = custom_label;

        if model.model_type != ModelType::Asr
            && settings.selected_asr_model_id.as_deref() == Some(&model.id)
        {
            settings.selected_asr_model_id = None;
        }

        if model.model_type != ModelType::Text
            && settings.selected_prompt_model_id.as_deref() == Some(&model.id)
        {
            settings.selected_prompt_model_id = None;
        }

        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err(format!("Cached model '{}' not found", model_id))
    }
}

#[tauri::command]
pub fn remove_cached_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let original_len = settings.cached_models.len();
    settings
        .cached_models
        .retain(|cached| cached.id != model_id);

    if settings.cached_models.len() == original_len {
        return Err(format!("Cached model '{}' not found", model_id));
    }

    if settings.selected_asr_model_id.as_deref() == Some(&model_id) {
        settings.selected_asr_model_id = None;
    }
    if settings.selected_prompt_model_id.as_deref() == Some(&model_id) {
        settings.selected_prompt_model_id = None;
    }

    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn toggle_online_asr(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.online_asr_enabled = enabled;
    settings::write_settings(&app, settings);

    // 当开启在线 ASR 时，主动卸载已加载的本地模型，确保互斥
    if enabled {
        if let Some(tm) =
            app.try_state::<std::sync::Arc<crate::managers::transcription::TranscriptionManager>>()
        {
            // 忽略卸载失败，保持不阻塞切换
            let _ = tm.unload_model();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn select_asr_model(app: AppHandle, model_id: Option<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    if let Some(ref id) = model_id {
        let model_is_asr = settings
            .cached_models
            .iter()
            .find(|cached| cached.id == *id)
            .map(|cached| cached.model_type == ModelType::Asr)
            .unwrap_or(false);

        if !model_is_asr {
            return Err("Selected model is not an ASR model".to_string());
        }
    }

    settings.selected_asr_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn select_post_process_model(app: AppHandle, model_id: Option<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    if let Some(ref id) = model_id {
        let cached_model = settings
            .cached_models
            .iter()
            .find(|cached| cached.id == *id);

        if let Some(model) = cached_model {
            if model.model_type != ModelType::Text {
                return Err("Selected model is not a Text model".to_string());
            }
            // Update the per-provider model selection
            settings.post_process_models.insert(model.provider_id.clone(), model.model_id.clone());
        }
    }

    settings.selected_prompt_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

/// Fetch models using manual HTTP request
/// This gives us more control and avoids issues with non-standard endpoints
async fn fetch_models_manual(
    provider: &crate::settings::PostProcessProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    // Build the endpoint URL
    let base_url = provider.base_url.trim_end_matches('/');
    let models_endpoint = provider
        .models_endpoint
        .as_ref()
        .map(|s| s.trim_start_matches('/'))
        .unwrap_or("models");
    let endpoint = format!("{}/{}", base_url, models_endpoint);

    // Create HTTP client with headers
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "HTTP-Referer",
        reqwest::header::HeaderValue::from_static("https://github.com/cjpais/Handy"),
    );
    headers.insert(
        "X-Title",
        reqwest::header::HeaderValue::from_static("Handy"),
    );

    // Add provider-specific headers
    if provider.id == "anthropic" {
        if !api_key.is_empty() {
            headers.insert(
                "x-api-key",
                reqwest::header::HeaderValue::from_str(&api_key)
                    .map_err(|e| format!("Invalid API key: {}", e))?,
            );
        }
        headers.insert(
            "anthropic-version",
            reqwest::header::HeaderValue::from_static("2023-06-01"),
        );
    } else if !api_key.is_empty() {
        headers.insert(
            "Authorization",
            reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| format!("Invalid API key: {}", e))?,
        );
    }

    let http_client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Make the request
    let response = http_client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Model list request failed ({}): {}",
            status, error_text
        ));
    }

    // Parse the response
    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut models = Vec::new();

    // Handle OpenAI format: { data: [ { id: "..." }, ... ] }
    if let Some(data) = parsed.get("data").and_then(|d| d.as_array()) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                models.push(id.to_string());
            } else if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                models.push(name.to_string());
            }
        }
    }
    // Handle array format: [ "model1", "model2", ... ]
    else if let Some(array) = parsed.as_array() {
        for entry in array {
            if let Some(model) = entry.as_str() {
                models.push(model.to_string());
            }
        }
    }

    Ok(models)
}

#[tauri::command]
pub fn set_post_process_selected_prompt(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);

    // Verify the prompt exists
    if !settings.post_process_prompts.iter().any(|p| p.id == id) {
        return Err(format!("Prompt with id '{}' not found", id));
    }

    settings.post_process_selected_prompt_id = Some(id);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_mute_while_recording_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.mute_while_recording = enabled;
    settings::write_settings(&app, settings);

    Ok(())
}

/// Determine whether a shortcut string contains at least one non-modifier key.
/// We allow single non-modifier keys (e.g. "f5" or "space") but disallow
/// modifier-only combos (e.g. "ctrl" or "ctrl+shift").
fn validate_shortcut_string(raw: &str) -> Result<(), String> {
    let modifiers = [
        "ctrl", "control", "shift", "alt", "option", "meta", "command", "cmd", "super", "win",
        "windows",
    ];
    let has_non_modifier = raw
        .split('+')
        .any(|part| !modifiers.contains(&part.trim().to_lowercase().as_str()));
    if has_non_modifier {
        Ok(())
    } else {
        Err("Shortcut must contain at least one non-modifier key".into())
    }
}

/// Temporarily unregister a binding while the user is editing it in the UI.
/// This avoids firing the action while keys are being recorded.
#[tauri::command]
pub fn suspend_binding(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(b) = settings::get_bindings(&app).get(&id).cloned() {
        if let Err(e) = _unregister_shortcut(&app, b) {
            error!("suspend_binding error for id '{}': {}", id, e);
            return Err(e);
        }
    }
    Ok(())
}

/// Re-register the binding after the user has finished editing.
#[tauri::command]
pub fn resume_binding(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(b) = settings::get_bindings(&app).get(&id).cloned() {
        if let Err(e) = _register_shortcut(&app, b) {
            error!("resume_binding error for id '{}': {}", id, e);
            return Err(e);
        }
    }
    Ok(())
}

fn _register_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    // Validate human-level rules first
    if let Err(e) = validate_shortcut_string(&binding.current_binding) {
        warn!(
            "_register_shortcut validation error for binding '{}': {}",
            binding.current_binding, e
        );
        return Err(e);
    }

    // Parse shortcut and return error if it fails
    let shortcut = match binding.current_binding.parse::<Shortcut>() {
        Ok(s) => s,
        Err(e) => {
            let error_msg = format!(
                "Failed to parse shortcut '{}': {}",
                binding.current_binding, e
            );
            error!("_register_shortcut parse error: {}", error_msg);
            return Err(error_msg);
        }
    };

    // Prevent duplicate registrations that would silently shadow one another
    if app.global_shortcut().is_registered(shortcut) {
        let error_msg = format!("Shortcut '{}' is already in use", binding.current_binding);
        warn!("_register_shortcut duplicate error: {}", error_msg);
        return Err(error_msg);
    }

    // Clone binding.id for use in the closure
    let binding_id_for_closure = binding.id.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |ah, scut, event| {
            if scut == &shortcut {
                let shortcut_string = scut.into_string();
                let settings = get_settings(ah);

                if let Some(action) = ACTION_MAP.get(&binding_id_for_closure) {
                    if settings.push_to_talk {
                        if event.state == ShortcutState::Pressed {
                            action.start(ah, &binding_id_for_closure, &shortcut_string);
                        } else if event.state == ShortcutState::Released {
                            action.stop(ah, &binding_id_for_closure, &shortcut_string);
                        }
                    } else {
                        if event.state == ShortcutState::Pressed {
                            let toggle_state_manager = ah.state::<ManagedToggleState>();

                            let mut states = toggle_state_manager.lock().expect("Failed to lock toggle state manager");

                            let is_currently_active = states.active_toggles
                                .entry(binding_id_for_closure.clone())
                                .or_insert(false);

                            if *is_currently_active {
                                action.stop(
                                    ah,
                                    &binding_id_for_closure,
                                    &shortcut_string,
                                );
                                *is_currently_active = false; // Update state to inactive
                            } else {
                                action.start(ah, &binding_id_for_closure, &shortcut_string);
                                *is_currently_active = true; // Update state to active
                            }
                        }
                    }
                } else {
                    warn!(
                        "No action defined in ACTION_MAP for shortcut ID '{}'. Shortcut: '{}', State: {:?}",
                        binding_id_for_closure, shortcut_string, event.state
                    );
                }
            }
        })
        .map_err(|e| {
            let error_msg = format!("Couldn't register shortcut '{}': {}", binding.current_binding, e);
            error!("_register_shortcut registration error: {}", error_msg);
            error_msg
        })?;

    Ok(())
}

fn _unregister_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let shortcut = match binding.current_binding.parse::<Shortcut>() {
        Ok(s) => s,
        Err(e) => {
            let error_msg = format!(
                "Failed to parse shortcut '{}' for unregistration: {}",
                binding.current_binding, e
            );
            error!("_unregister_shortcut parse error: {}", error_msg);
            return Err(error_msg);
        }
    };

    app.global_shortcut().unregister(shortcut).map_err(|e| {
        let error_msg = format!(
            "Failed to unregister shortcut '{}': {}",
            binding.current_binding, e
        );
        error!("_unregister_shortcut error: {}", error_msg);
        error_msg
    })?;

    Ok(())
}
