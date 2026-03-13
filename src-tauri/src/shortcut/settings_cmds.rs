use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::settings;
use crate::tray::{self, ManagedTrayIconState, TrayIconState};

// Group: Post-processing Settings
#[tauri::command]
#[specta::specta]
pub fn change_post_process_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub fn change_post_process_context_limit_setting(app: AppHandle, limit: u8) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_context_limit = limit;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_streaming_output_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_streaming_output_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_hotword_injection_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_hotword_injection_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_base_url_setting(
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    super::validate_provider_exists(&settings, &provider_id)?;
    if let Some(provider) = settings.post_process_provider_mut(&provider_id) {
        provider.base_url = crate::utils::normalize_base_url(&base_url);
        settings::write_settings(&app, settings);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_api_key_setting(
    app: AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    super::validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_api_keys.insert(provider_id, api_key);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_model_setting(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    super::validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_models.insert(provider_id, model);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    super::validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_provider_id = provider_id;
    settings::write_settings(&app, settings);
    Ok(())
}

// Group: ASR Settings
#[tauri::command]
#[specta::specta]
pub fn toggle_online_asr(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.online_asr_enabled = enabled;
    settings::write_settings(&app, settings);
    if enabled {
        if let Some(tm) =
            app.try_state::<std::sync::Arc<crate::managers::transcription::TranscriptionManager>>()
        {
            let _ = tm.unload_model();
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn select_asr_model(app: AppHandle, model_id: Option<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selected_asr_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn select_post_process_model(app: AppHandle, model_id: Option<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selected_prompt_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_selected_prompt(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_selected_prompt_id = Some(id);
    settings::write_settings(&app, settings);
    Ok(())
}

// Group: App Profiles
#[tauri::command]
#[specta::specta]
pub fn upsert_app_profile(app: AppHandle, profile: settings::AppProfile) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn remove_app_profile(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_profiles.retain(|p| p.id != id);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn assign_app_to_profile(
    app: AppHandle,
    app_id: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if let Some(pid) = profile_id {
        settings.app_to_profile.insert(app_id, pid);
    } else {
        settings.app_to_profile.remove(&app_id);
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_app_profiles(app: AppHandle, profiles: Vec<settings::AppProfile>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_profiles = profiles;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_app_to_profile(
    app: AppHandle,
    app_to_profile: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_to_profile = app_to_profile;
    settings::write_settings(&app, settings);
    Ok(())
}

// Group: Other Settings
#[tauri::command]
#[specta::specta]
pub fn change_mute_while_recording_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.mute_while_recording = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_append_trailing_space_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.append_trailing_space = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_app_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_language = language;
    settings::write_settings(&app, settings);
    let current_state = app
        .state::<ManagedTrayIconState>()
        .inner()
        .0
        .lock()
        .map(|s| s.clone())
        .unwrap_or(TrayIconState::Idle);
    tray::update_tray_menu(&app, &current_state);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_show_tray_icon_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.show_tray_icon = enabled;
    settings::write_settings(&app, settings);
    tray::set_tray_visibility(&app, enabled);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_experimental_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.experimental_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_autostart_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.autostart_enabled = enabled;
    settings::write_settings(&app, settings);
    let autostart_manager = app.autolaunch();
    if enabled {
        let _ = autostart_manager.enable();
    } else {
        let _ = autostart_manager.disable();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_update_checks_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.update_checks_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_expert_mode_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.expert_mode = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_onboarding_completed_setting(app: AppHandle, completed: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.onboarding_completed = completed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub fn change_paste_method_setting(app: AppHandle, method: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match method.as_str() {
        "ctrl_v" => settings::PasteMethod::CtrlV,
        "direct" => settings::PasteMethod::Direct,
        "none" => settings::PasteMethod::None,
        "shift_insert" => settings::PasteMethod::ShiftInsert,
        "ctrl_shift_v" => settings::PasteMethod::CtrlShiftV,
        "external_script" => settings::PasteMethod::ExternalScript,
        _ => settings::PasteMethod::CtrlV,
    };
    settings.paste_method = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_clipboard_handling_setting(app: AppHandle, handling: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match handling.as_str() {
        "dont_modify" => settings::ClipboardHandling::DontModify,
        "copy_to_clipboard" => settings::ClipboardHandling::CopyToClipboard,
        _ => settings::ClipboardHandling::DontModify,
    };
    settings.clipboard_handling = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_submit_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.auto_submit = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_submit_key_setting(app: AppHandle, key: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match key.as_str() {
        "enter" => settings::AutoSubmitKey::Enter,
        "ctrl_enter" => settings::AutoSubmitKey::CtrlEnter,
        "cmd_enter" => settings::AutoSubmitKey::CmdEnter,
        _ => settings::AutoSubmitKey::Enter,
    };
    settings.auto_submit_key = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn add_cached_model(app: AppHandle, model: settings::CachedModel) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if !settings.cached_models.iter().any(|m| m.id == model.id) {
        settings.cached_models.push(model);
        settings::write_settings(&app, settings);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_cached_model_capability(
    app: AppHandle,
    id: String,
    model_type: settings::ModelType,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if let Some(m) = settings.cached_models.iter_mut().find(|m| m.id == id) {
        m.model_type = model_type;
        settings::write_settings(&app, settings);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_cached_model_prompt_message_role(
    app: AppHandle,
    id: String,
    role: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match role.as_str() {
        "developer" => settings::PromptMessageRole::Developer,
        _ => settings::PromptMessageRole::System,
    };
    if let Some(m) = settings.cached_models.iter_mut().find(|m| m.id == id) {
        m.prompt_message_role = parsed;
        settings::write_settings(&app, settings);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn remove_cached_model(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.cached_models.retain(|m| m.id != id);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_show_overlay_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if !enabled {
        settings.overlay_position = settings::OverlayPosition::None;
    } else if matches!(settings.overlay_position, settings::OverlayPosition::None) {
        settings.overlay_position = settings::OverlayPosition::Bottom;
    }
    settings::write_settings(&app, settings);
    crate::utils::update_overlay_position(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_favorite_transcription_models_setting(
    app: AppHandle,
    models: Vec<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.favorite_transcription_models = models;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_punctuation_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.punctuation_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_punctuation_model_setting(app: AppHandle, model: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.punctuation_model = model;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_realtime_transcription_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.realtime_transcription_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_offline_vad_force_interval_ms_setting(
    app: AppHandle,
    interval: u64,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.offline_vad_force_interval_ms = interval;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_offline_vad_force_window_seconds_setting(
    app: AppHandle,
    window: u64,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.offline_vad_force_window_seconds = window;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_use_local_candidate_when_online_asr_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_use_local_candidate_when_online_asr = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_secondary_model_id_setting(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_secondary_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_intent_model_id_setting(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_intent_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

// Group: Length Routing Settings
#[tauri::command]
#[specta::specta]
pub fn change_length_routing_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.length_routing_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_length_routing_threshold_setting(
    app: AppHandle,
    threshold: u32,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.length_routing_threshold = threshold;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_length_routing_short_model_setting(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.length_routing_short_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_length_routing_long_model_setting(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.length_routing_long_model_id = model_id;
    settings::write_settings(&app, settings);
    Ok(())
}

// Group: PTT and Audio Settings
#[tauri::command]
#[specta::specta]
pub fn change_ptt_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.push_to_talk = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_feedback_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_feedback_volume_setting(app: AppHandle, volume: f32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback_volume = volume;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_sound_theme_setting(app: AppHandle, theme: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match theme.as_str() {
        "marimba" => settings::SoundTheme::Marimba,
        "pop" => settings::SoundTheme::Pop,
        "custom" => settings::SoundTheme::Custom,
        _ => settings::SoundTheme::Marimba,
    };
    settings.sound_theme = parsed;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_translate_to_english_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.translate_to_english = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_selected_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selected_language = language;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_overlay_position_setting(app: AppHandle, position: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match position.as_str() {
        "bottom" => settings::OverlayPosition::Bottom,
        "top" => settings::OverlayPosition::Top,
        "none" => settings::OverlayPosition::None,
        _ => settings::OverlayPosition::Bottom,
    };
    settings.overlay_position = parsed;
    settings::write_settings(&app, settings);
    crate::utils::update_overlay_position(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_debug_mode_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.debug_mode = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_start_hidden_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.start_hidden = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_use_secondary_output_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_use_secondary_output = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}
