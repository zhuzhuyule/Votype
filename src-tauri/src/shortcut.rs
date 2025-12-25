use log::{error, warn};
use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::actions::{ActionMode, ACTION_MAP};
use crate::settings::ShortcutBinding;
use crate::settings::{
    self, get_settings, CachedModel, ClipboardHandling, LLMPrompt, ModelType, OverlayPosition,
    PasteMethod, PostProcessProvider, SoundTheme, APPLE_INTELLIGENCE_DEFAULT_MODEL_ID,
    APPLE_INTELLIGENCE_PROVIDER_ID,
};
use crate::tray::{ManagedTrayIconState, TrayIconState};
use crate::ManagedToggleState;
use chrono::Utc;

pub fn init_shortcuts(app: &AppHandle) {
    let default_bindings = settings::get_default_settings().bindings;
    let user_settings = settings::load_or_create_app_settings(app);

    // Register all default shortcuts, applying user customizations
    for (id, default_binding) in default_bindings {
        if id == "cancel" {
            continue; // Skip cancel shortcut, it will be registered dynamically
        }
        let binding = user_settings
            .bindings
            .get(&id)
            .cloned()
            .unwrap_or(default_binding);

        if let Err(e) = register_shortcut(app, binding) {
            error!("Failed to register shortcut {} during init: {}", id, e);
        }
    }
}

#[derive(Serialize)]
pub struct BindingResponse {
    success: bool,
    binding: Option<ShortcutBinding>,
    error: Option<String>,
}

fn canonicalize_shortcut_string(raw: &str) -> String {
    raw.split('+')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .map(|p| match p.as_str() {
            "control" => "ctrl".to_string(),
            "esc" => "escape".to_string(),
            "cmd" => "command".to_string(),
            "win" | "windows" => "super".to_string(),
            "meta" => {
                #[cfg(target_os = "macos")]
                {
                    "command".to_string()
                }
                #[cfg(not(target_os = "macos"))]
                {
                    "super".to_string()
                }
            }
            "alt" => {
                #[cfg(target_os = "macos")]
                {
                    "option".to_string()
                }
                #[cfg(not(target_os = "macos"))]
                {
                    "alt".to_string()
                }
            }
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
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
    // If this is the cancel binding, just update the settings and return
    // It's managed dynamically, so we don't register/unregister here
    if id == "cancel" {
        if let Some(mut b) = settings.bindings.get(&id).cloned() {
            b.current_binding = canonicalize_shortcut_string(&binding);
            settings.bindings.insert(id.clone(), b.clone());
            settings::write_settings(&app, settings);
            return Ok(BindingResponse {
                success: true,
                binding: Some(b.clone()),
                error: None,
            });
        }
    }

    // Unregister the existing binding
    if let Err(e) = unregister_shortcut(&app, binding_to_modify.clone()) {
        let error_msg = format!("Failed to unregister shortcut: {}", e);
        error!("change_binding error: {}", error_msg);
    }

    let binding = canonicalize_shortcut_string(&binding);

    // Validate the new shortcut before we touch the current registration
    if let Err(e) = validate_shortcut_string(&binding) {
        warn!("change_binding validation error: {}", e);
        return Err(e);
    }

    // Create an updated binding
    let mut updated_binding = binding_to_modify;
    updated_binding.current_binding = binding;

    // Register the new binding
    if let Err(e) = register_shortcut(&app, updated_binding.clone()) {
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
    let default_binding = settings::get_default_settings()
        .bindings
        .get(&id)
        .map(|b| b.default_binding.clone())
        .unwrap_or_else(|| settings::get_stored_binding(&app, &id).default_binding);

    change_binding(app, id, default_binding)
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
pub fn change_app_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_language = language;
    settings::write_settings(&app, settings);

    let current_state = app
        .state::<ManagedTrayIconState>()
        .0
        .lock()
        .map(|state| state.clone())
        .unwrap_or(TrayIconState::Idle);
    crate::tray::update_tray_menu(&app, &current_state);

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

    log::info!(
        "Debug mode changed to: {}. Console log level set to: {:?}",
        enabled,
        console_level
    );

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
pub fn change_update_checks_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.update_checks_enabled = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "update_checks_enabled",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_onboarding_completed_setting(app: AppHandle, completed: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.onboarding_completed = completed;
    settings::write_settings(&app, settings);
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
        "ctrl_shift_v" => PasteMethod::CtrlShiftV,
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
pub fn change_post_process_context_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_context_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_post_process_context_limit_setting(app: AppHandle, value: u8) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_context_limit = value;
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
    let _label = settings
        .post_process_provider(&provider_id)
        .map(|provider| provider.label.clone())
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    let provider = settings
        .post_process_provider_mut(&provider_id)
        .expect("Provider looked up above must exist");

    // if !provider.allow_base_url_edit {
    //     return Err(format!(
    //         "Provider '{}' does not allow editing the base URL",
    //         label
    //     ));
    // }

    println!(
        "DEBUG: Updating Base URL for provider '{}' to '{}'",
        provider_id, base_url
    );

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
    println!(
        "DEBUG: Updating API Key for provider '{}' (length: {})",
        provider_id,
        api_key.len()
    );
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
pub fn set_command_prefixes(app: AppHandle, prefixes: Option<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.command_prefixes = prefixes;
    settings::write_settings(&app, settings);
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
    alias: Option<String>,
    icon: Option<String>,
    compliance_check_enabled: bool,
    compliance_threshold: Option<u8>,
) -> Result<LLMPrompt, String> {
    let mut settings = settings::get_settings(&app);

    // Generate unique ID using timestamp and random component
    let id = format!("prompt_{}", chrono::Utc::now().timestamp_millis());

    let new_prompt = LLMPrompt {
        id: id.clone(),
        name,
        prompt,
        model_id,
        alias,
        icon,
        compliance_check_enabled,
        compliance_threshold: Some(compliance_threshold.unwrap_or(20)),
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
    alias: Option<String>,
    icon: Option<String>,
    compliance_check_enabled: bool,
    compliance_threshold: Option<u8>,
) -> Result<(), String> {
    println!(
        "DEBUG: update_post_process_prompt called. ID: {}, Enabled: {}, Threshold: {:?}",
        id, compliance_check_enabled, compliance_threshold
    );

    let mut settings = settings::get_settings(&app);

    if let Some(existing_prompt) = settings
        .post_process_prompts
        .iter_mut()
        .find(|p| p.id == id)
    {
        existing_prompt.name = name;
        existing_prompt.prompt = prompt;
        existing_prompt.model_id = model_id;
        existing_prompt.alias = alias;
        existing_prompt.icon = icon;
        existing_prompt.compliance_check_enabled = compliance_check_enabled;
        existing_prompt.compliance_threshold = Some(compliance_threshold.unwrap_or(20));
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

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return Ok(vec![APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string()]);
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return Err("Apple Intelligence is only available on Apple silicon Macs running macOS 15 or later.".to_string());
        }
    }

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
            settings
                .post_process_models
                .insert(model.provider_id.clone(), model.model_id.clone());

            // Also switch the active provider to the one owning this model
            settings.post_process_provider_id = model.provider_id.clone();
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

    println!("DEBUG: Real Request URL: {}", endpoint);

    // Create HTTP client with headers
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "HTTP-Referer",
        reqwest::header::HeaderValue::from_static("https://github.com/zhuzhuyule/Votype"),
    );
    headers.insert(
        "X-Title",
        reqwest::header::HeaderValue::from_static("Votype"),
    );

    // Add provider-specific headers
    if provider.id == "anthropic" {
        if !api_key.is_empty() {
            println!("DEBUG: Adding x-api-key header");
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
        println!("DEBUG: Adding Authorization Bearer header");
        headers.insert(
            "Authorization",
            reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| format!("Invalid API key: {}", e))?,
        );
    }

    println!("DEBUG: Request Headers: {:?}", headers);

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

    let status = response.status();
    println!("DEBUG: Response Status: {}", status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        println!("DEBUG: Response Error Body: {}", error_text);
        return Err(format!(
            "Model list request failed ({}): {}",
            status, error_text
        ));
    }

    // Parse the response
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    // println!("DEBUG: Response Body: {}", body_text); // Uncomment if needed, but might be large

    let parsed: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

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
    } else {
        return Err(format!(
            "Invalid response format: expected JSON array or object with 'data' array. Got: {:?}",
            parsed
        ));
    }

    println!(
        "DEBUG: Successfully parsed {} models: {:?}",
        models.len(),
        models
    );

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

#[tauri::command]
pub fn change_append_trailing_space_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.append_trailing_space = enabled;
    settings::write_settings(&app, settings);

    Ok(())
}

#[tauri::command]
pub fn change_post_process_use_secondary_output_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_use_secondary_output = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "post_process_use_secondary_output",
            "value": enabled
        }),
    );

    // If the user disables secondary output while using online ASR, proactively unload any
    // previously-loaded local model to reduce memory usage.
    if !enabled {
        let settings = settings::get_settings(&app);
        if settings.online_asr_enabled {
            if let Some(tm) = app
                .try_state::<std::sync::Arc<crate::managers::transcription::TranscriptionManager>>()
            {
                let _ = tm.abort_sherpa_online_session();
                let _ = tm.abort_sherpa_offline_session();
                let _ = tm.unload_model();
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn change_post_process_use_local_candidate_when_online_asr_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_use_local_candidate_when_online_asr = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "post_process_use_local_candidate_when_online_asr",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_post_process_secondary_model_id_setting(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_secondary_model_id = model_id;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "post_process_secondary_model_id",
            "value": settings::get_settings(&app).post_process_secondary_model_id
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_offline_vad_force_interval_ms_setting(
    app: AppHandle,
    value: u64,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.offline_vad_force_interval_ms = value;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "offline_vad_force_interval_ms",
            "value": value
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_offline_vad_force_window_seconds_setting(
    app: AppHandle,
    value: u64,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.offline_vad_force_window_seconds = value;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "offline_vad_force_window_seconds",
            "value": value
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_punctuation_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.punctuation_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_punctuation_model_setting(app: AppHandle, model_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.punctuation_model = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_favorite_transcription_models_setting(
    app: AppHandle,
    model_ids: Vec<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.favorite_transcription_models = model_ids;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn change_confidence_check_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.confidence_check_enabled = enabled;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "confidence_check_enabled",
            "value": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn change_confidence_threshold_setting(app: AppHandle, threshold: u8) -> Result<(), String> {
    if threshold > 100 {
        return Err("Threshold must be between 0 and 100".to_string());
    }
    let mut settings = settings::get_settings(&app);
    settings.confidence_threshold = threshold;
    settings::write_settings(&app, settings);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "confidence_threshold",
            "value": threshold
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn upsert_app_profile(app: AppHandle, profile: settings::AppProfile) -> Result<(), String> {
    log::info!("Upserting app profile: {:?}", profile);
    let mut settings = settings::get_settings(&app);

    if let Some(existing) = settings
        .app_profiles
        .iter_mut()
        .find(|p| p.id == profile.id)
    {
        *existing = profile;
    } else {
        settings.app_profiles.push(profile);
    }

    settings::write_settings(&app, settings);
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({ "setting": "app_profiles" }),
    );
    Ok(())
}

#[tauri::command]
pub fn remove_app_profile(app: AppHandle, profile_id: String) -> Result<(), String> {
    log::info!("Removing app profile: {}", profile_id);
    let mut settings = settings::get_settings(&app);
    settings.app_profiles.retain(|p| p.id != profile_id);

    // Also remove any assignments to this profile
    settings.app_to_profile.retain(|_, pid| pid != &profile_id);

    settings::write_settings(&app, settings);
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({ "setting": "app_profiles" }),
    );
    Ok(())
}

#[tauri::command]
pub fn assign_app_to_profile(
    app: AppHandle,
    app_id: String,
    profile_id: String,
) -> Result<(), String> {
    log::info!("Assigning app {} to profile {}", app_id, profile_id);
    let mut settings = settings::get_settings(&app);
    settings.app_to_profile.insert(app_id, profile_id);

    settings::write_settings(&app, settings);
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({ "setting": "app_to_profile" }),
    );
    Ok(())
}

#[tauri::command]
pub fn set_app_profiles(app: AppHandle, profiles: Vec<settings::AppProfile>) -> Result<(), String> {
    log::info!("Setting app profiles: {} profiles", profiles.len());
    let mut settings = settings::get_settings(&app);
    settings.app_profiles = profiles;
    settings::write_settings(&app, settings);
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({ "setting": "app_profiles" }),
    );
    Ok(())
}

#[tauri::command]
pub fn set_app_to_profile(app: AppHandle, mapping: HashMap<String, String>) -> Result<(), String> {
    log::info!("Setting app to profile mapping: {} entries", mapping.len());
    let mut settings = settings::get_settings(&app);
    settings.app_to_profile = mapping;
    settings::write_settings(&app, settings);
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({ "setting": "app_to_profile" }),
    );
    Ok(())
}

#[tauri::command]
pub fn confirm_reviewed_transcription(
    app: AppHandle,
    text: String,
    history_id: Option<i64>,
) -> Result<(), String> {
    use crate::tray::{change_tray_icon, TrayIconState};
    use std::time::Duration;

    log::info!(
        "confirm_reviewed_transcription called with history_id: {:?}, text length: {}",
        history_id,
        text.len()
    );

    let resolved_history_id = history_id.or_else(crate::review_window::get_last_review_history_id);
    // Hide review window and reset tray icon
    crate::review_window::hide_review_window(&app, resolved_history_id);
    change_tray_icon(&app, TrayIconState::Idle);
    // Update history if we have an ID
    if let Some(id) = resolved_history_id {
        let hm = app
            .try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
            .ok_or("History manager not available")?;
        // Run the update in a background task
        let hm_clone = (*hm).clone();
        let text_clone = text.clone();
        tauri::async_runtime::spawn(async move {
            log::info!("Updating history entry {} with reviewed text", id);
            // Use the precision update method to preserve metadata
            if let Err(e) = hm_clone.update_reviewed_text(id, text_clone).await {
                log::error!("Failed to update history with reviewed text: {}", e);
            }
        });
    } else {
        log::warn!("confirm_reviewed_transcription called without history_id");
    }
    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app: {}", e);
        } else {
            std::thread::sleep(Duration::from_millis(120));
        }
    }

    // Paste the text
    if let Err(e) = crate::utils::paste(text, app) {
        return Err(format!("Failed to paste text: {}", e));
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_transcription_review(
    app: AppHandle,
    text: Option<String>,
    history_id: Option<i64>,
) -> Result<(), String> {
    use crate::tray::{change_tray_icon, TrayIconState};
    use std::time::Duration;

    log::info!(
        "cancel_transcription_review called with history_id: {:?}",
        history_id
    );
    let resolved_history_id = history_id.or_else(crate::review_window::get_last_review_history_id);
    // Hide review window and reset tray icon
    crate::review_window::hide_review_window(&app, resolved_history_id);
    change_tray_icon(&app, TrayIconState::Idle);

    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app on cancel: {}", e);
        } else {
            std::thread::sleep(Duration::from_millis(120));
        }
    }

    if history_id.is_some() || text.is_some() {
        log::info!("Review cancelled; history already contains LLM output");
    }
    log::info!("Transcription review cancelled by user completed");
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
        if let Err(e) = unregister_shortcut(&app, b) {
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
        if let Err(e) = register_shortcut(&app, b) {
            error!("resume_binding error for id '{}': {}", id, e);
            return Err(e);
        }
    }
    Ok(())
}

pub fn register_cancel_shortcut(app: &AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(cancel_binding) = get_settings(&app_clone).bindings.get("cancel").cloned() {
            if let Err(e) = register_shortcut(&app_clone, cancel_binding) {
                eprintln!("Failed to register cancel shortcut: {}", e);
            }
        }
    });
}

pub fn unregister_cancel_shortcut(app: &AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(cancel_binding) = get_settings(&app_clone).bindings.get("cancel").cloned() {
            // We ignore errors here as it might already be unregistered
            let _ = unregister_shortcut(&app_clone, cancel_binding);
        }
    });
}

pub fn register_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let binding_str = canonicalize_shortcut_string(&binding.current_binding);

    // Validate human-level rules first
    if let Err(e) = validate_shortcut_string(&binding_str) {
        warn!(
            "_register_shortcut validation error for binding '{}': {}",
            binding_str, e
        );
        return Err(e);
    }

    // Parse shortcut and return error if it fails
    let shortcut = match binding_str.parse::<Shortcut>() {
        Ok(s) => s,
        Err(e) => {
            let error_msg = format!("Failed to parse shortcut '{}': {}", binding_str, e);
            error!("_register_shortcut parse error: {}", error_msg);
            return Err(error_msg);
        }
    };

    // Prevent duplicate registrations that would silently shadow one another
    if app.global_shortcut().is_registered(shortcut) {
        let error_msg = format!("Shortcut '{}' is already in use", binding_str);
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
                    let mode = action.mode();
                    match mode {
                        ActionMode::Stateless => {
                            // Stateless actions (Paste, Settings, Cancel, etc.)
                            // Fire on Released to avoid double-trigger and modifier interference
                            if event.state == ShortcutState::Released {
                                action.start(ah, &binding_id_for_closure, &shortcut_string);
                            }
                        }
                        ActionMode::Stateful => {
                            // Stateful actions (Transcribe)
                            // Handle PTT vs Toggle based on user settings
                            if settings.push_to_talk {
                                if event.state == ShortcutState::Pressed {
                                    action.start(ah, &binding_id_for_closure, &shortcut_string);
                                } else if event.state == ShortcutState::Released {
                                    action.stop(ah, &binding_id_for_closure, &shortcut_string);
                                }
                            } else {
                                // Toggle logic
                                if event.state == ShortcutState::Pressed {
                                    let toggle_state_manager = ah.state::<ManagedToggleState>();
                                    let mut states = toggle_state_manager
                                        .lock()
                                        .expect("Failed to lock toggle state manager");

                                    let is_currently_active = states
                                        .active_toggles
                                        .entry(binding_id_for_closure.clone())
                                        .or_insert(false);

                                    if *is_currently_active {
                                        action.stop(
                                            ah,
                                            &binding_id_for_closure,
                                            &shortcut_string,
                                        );
                                        *is_currently_active = false;
                                    } else {
                                        action.start(
                                            ah,
                                            &binding_id_for_closure,
                                            &shortcut_string,
                                        );
                                        *is_currently_active = true;
                                    }
                                }
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
            let error_msg = format!("Couldn't register shortcut '{}': {}", binding_str, e);
            error!("_register_shortcut registration error: {}", error_msg);
            error_msg
        })?;

    Ok(())
}

pub fn unregister_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let binding_str = canonicalize_shortcut_string(&binding.current_binding);
    let shortcut = match binding_str.parse::<Shortcut>() {
        Ok(s) => s,
        Err(e) => {
            let error_msg = format!(
                "Failed to parse shortcut '{}' for unregistration: {}",
                binding_str, e
            );
            error!("_unregister_shortcut parse error: {}", error_msg);
            return Err(error_msg);
        }
    };

    app.global_shortcut().unregister(shortcut).map_err(|e| {
        let error_msg = format!("Failed to unregister shortcut '{}': {}", binding_str, e);
        error!("_unregister_shortcut error: {}", error_msg);
        error_msg
    })?;

    Ok(())
}

#[tauri::command]
pub async fn test_post_process_model_inference(
    app: AppHandle,
    provider_id: String,
    model: String,
    input: Option<String>,
) -> Result<String, String> {
    let settings = settings::get_settings(&app);

    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    let api_key = settings
        .post_process_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();

    println!(
        "DEBUG: Testing inference for provider='{}', model='{}'",
        provider_id, model
    );

    let client = crate::llm_client::create_client(provider, api_key)?;

    let messages = vec![
        async_openai::types::ChatCompletionRequestSystemMessageArgs::default()
            .content(input.unwrap_or_else(|| "Please return OK".to_string()))
            .build()
            .map_err(|e| format!("Failed to build message: {}", e))?
            .into(),
    ];

    let request = async_openai::types::CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(messages)
        .max_tokens(50_u16)
        .build()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("Inference failed: {}", e))?;

    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_else(|| "No content returned".to_string());

    Ok(content)
}

/// Test ASR model inference by sending a generated test audio
#[tauri::command]
pub async fn test_asr_model_inference(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<String, String> {
    use std::time::Duration;

    let settings = settings::get_settings(&app);

    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?
        .clone();

    let api_key = settings.post_process_api_keys.get(&provider_id).cloned();

    println!(
        "DEBUG: Testing ASR inference for provider='{}', model='{}'",
        provider_id, model
    );

    // Generate a 1-second test audio (440Hz sine wave - sounds like a "ding")
    let sample_rate = 16000u32;
    let duration_secs = 1.0f32;
    let frequency = 440.0f32; // A4 note
    let num_samples = (sample_rate as f32 * duration_secs) as usize;

    let test_audio: Vec<f32> = (0..num_samples)
        .map(|i| {
            let t = i as f32 / sample_rate as f32;
            // Sine wave with fade in/out to avoid clicks
            let fade_samples = (sample_rate as f32 * 0.05) as usize; // 50ms fade
            let envelope = if i < fade_samples {
                i as f32 / fade_samples as f32
            } else if i > num_samples - fade_samples {
                (num_samples - i) as f32 / fade_samples as f32
            } else {
                1.0
            };
            (2.0 * std::f32::consts::PI * frequency * t).sin() * 0.5 * envelope
        })
        .collect();

    // Use OnlineAsrClient with 30 second timeout
    let asr_client = crate::online_asr::OnlineAsrClient {
        sample_rate,
        timeout: Duration::from_secs(30),
    };

    // Run the transcribe in a blocking task since it uses sync HTTP client
    let result = tokio::task::spawn_blocking(move || {
        asr_client.transcribe(&provider, api_key, &model, &test_audio)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("ASR test failed: {}", e))?;

    Ok(result)
}
