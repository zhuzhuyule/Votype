//! Keyboard shortcut management module
//!
//! This module provides a unified interface for keyboard shortcuts with
//! multiple backend implementations:
//!
//! - `tauri`: Uses Tauri's built-in global-shortcut plugin
//! - `handy_keys`: Uses the handy-keys library for more control
//!
//! The active implementation is determined by the `keyboard_implementation`
//! setting and can be changed at runtime.

mod handler;
pub mod handy_keys;
mod tauri_impl;

use chrono::Utc;
use log::{error, warn};
use serde::Serialize;
use specta::Type;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

use crate::settings::{
    self, get_settings, KeyboardImplementation, PostProcessProvider, ShortcutBinding, Skill,
    SkillSource, APPLE_INTELLIGENCE_DEFAULT_MODEL_ID, APPLE_INTELLIGENCE_PROVIDER_ID,
};
use crate::tray::{self, ManagedTrayIconState, TrayIconState};

/// Initialize shortcuts using the configured implementation
pub fn init_shortcuts(app: &AppHandle) {
    let user_settings = settings::load_or_create_app_settings(app);

    match user_settings.keyboard_implementation {
        KeyboardImplementation::Tauri => {
            tauri_impl::init_shortcuts(app);
        }
        KeyboardImplementation::HandyKeys => {
            if let Err(e) = handy_keys::init_shortcuts(app) {
                error!("Failed to initialize handy-keys shortcuts: {}", e);
                warn!("Falling back to Tauri global shortcut implementation");
                let mut settings = settings::get_settings(app);
                settings.keyboard_implementation = KeyboardImplementation::Tauri;
                settings::write_settings(app, settings);
                tauri_impl::init_shortcuts(app);
            }
        }
    }
}

pub fn register_cancel_shortcut(app: &AppHandle) {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::register_cancel_shortcut(app),
        KeyboardImplementation::HandyKeys => handy_keys::register_cancel_shortcut(app),
    }
}

pub fn unregister_cancel_shortcut(app: &AppHandle) {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::unregister_cancel_shortcut(app),
        KeyboardImplementation::HandyKeys => handy_keys::unregister_cancel_shortcut(app),
    }
}

pub fn register_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::register_shortcut(app, binding),
        KeyboardImplementation::HandyKeys => handy_keys::register_shortcut(app, binding),
    }
}

pub fn unregister_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let settings = get_settings(app);
    match settings.keyboard_implementation {
        KeyboardImplementation::Tauri => tauri_impl::unregister_shortcut(app, binding),
        KeyboardImplementation::HandyKeys => handy_keys::unregister_shortcut(app, binding),
    }
}

#[derive(Serialize, Type)]
pub struct BindingResponse {
    success: bool,
    binding: Option<ShortcutBinding>,
    error: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn change_binding(
    app: AppHandle,
    id: String,
    binding: String,
) -> Result<BindingResponse, String> {
    if binding.trim().is_empty() {
        return Err("Binding cannot be empty".to_string());
    }
    let mut settings = settings::get_settings(&app);
    let binding_to_modify = match settings.bindings.get(&id) {
        Some(b) => b.clone(),
        None => {
            let default_settings = settings::get_default_settings();
            match default_settings.bindings.get(&id) {
                Some(db) => db.clone(),
                None => {
                    return Ok(BindingResponse {
                        success: false,
                        binding: None,
                        error: Some(format!("Binding '{}' not found", id)),
                    })
                }
            }
        }
    };
    if id != "cancel" {
        let _ = unregister_shortcut(&app, binding_to_modify.clone());
    }
    validate_shortcut_for_implementation(&binding, settings.keyboard_implementation)?;
    let mut updated = binding_to_modify;
    updated.current_binding = binding;
    if id != "cancel" {
        if let Err(e) = register_shortcut(&app, updated.clone()) {
            return Ok(BindingResponse {
                success: false,
                binding: None,
                error: Some(e),
            });
        }
    }
    settings.bindings.insert(id, updated.clone());
    settings::write_settings(&app, settings);
    Ok(BindingResponse {
        success: true,
        binding: Some(updated),
        error: None,
    })
}

#[tauri::command]
#[specta::specta]
pub fn reset_binding(app: AppHandle, id: String) -> Result<BindingResponse, String> {
    let binding = settings::get_stored_binding(&app, &id);
    change_binding(app, id, binding.default_binding)
}

#[tauri::command]
#[specta::specta]
pub fn suspend_binding(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(b) = settings::get_bindings(&app).get(&id).cloned() {
        unregister_shortcut(&app, b)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn resume_binding(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(b) = settings::get_bindings(&app).get(&id).cloned() {
        register_shortcut(&app, b)?;
    }
    Ok(())
}

#[derive(Serialize, Type)]
pub struct ImplementationChangeResult {
    pub success: bool,
    pub reset_bindings: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub fn change_keyboard_implementation_setting(
    app: AppHandle,
    implementation: String,
) -> Result<ImplementationChangeResult, String> {
    let current_settings = settings::get_settings(&app);
    let new_impl = parse_keyboard_implementation(&implementation);
    if current_settings.keyboard_implementation == new_impl {
        return Ok(ImplementationChangeResult {
            success: true,
            reset_bindings: vec![],
        });
    }
    unregister_all_shortcuts(&app, current_settings.keyboard_implementation);
    let mut settings = settings::get_settings(&app);
    settings.keyboard_implementation = new_impl;
    settings::write_settings(&app, settings);
    if new_impl == KeyboardImplementation::HandyKeys {
        initialize_handy_keys_with_rollback(&app)?;
    }
    let reset_bindings = register_all_shortcuts_for_implementation(&app, new_impl);
    Ok(ImplementationChangeResult {
        success: true,
        reset_bindings,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_keyboard_implementation(app: AppHandle) -> settings::KeyboardImplementation {
    let settings = settings::get_settings(&app);
    settings.keyboard_implementation
}

fn validate_shortcut_for_implementation(
    raw: &str,
    implementation: KeyboardImplementation,
) -> Result<(), String> {
    match implementation {
        KeyboardImplementation::Tauri => tauri_impl::validate_shortcut(raw),
        KeyboardImplementation::HandyKeys => handy_keys::validate_shortcut(raw),
    }
}

fn parse_keyboard_implementation(s: &str) -> KeyboardImplementation {
    match s {
        "tauri" => KeyboardImplementation::Tauri,
        "handy_keys" => KeyboardImplementation::HandyKeys,
        _ => KeyboardImplementation::Tauri,
    }
}

// Group: Skills Management
#[tauri::command]
#[specta::specta]
pub fn get_all_skills(app: AppHandle) -> Vec<Skill> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.get_all_skills()
}

#[tauri::command]
#[specta::specta]
pub fn create_skill(app: AppHandle, skill: Skill) -> Result<Skill, String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.create_skill_file(&skill)
}

#[tauri::command]
#[specta::specta]
pub fn delete_skill(app: AppHandle, id: String) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.delete_skill_file(&id)
}

#[tauri::command]
#[specta::specta]
pub fn get_skill_templates() -> Vec<crate::managers::skill::SkillTemplate> {
    crate::managers::skill::get_builtin_templates()
}

#[tauri::command]
#[specta::specta]
pub fn save_external_skill(app: AppHandle, skill: Skill) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager.find_skill_file_path(&skill.id);
    let mut skill_with_path = skill;
    skill_with_path.file_path = file_path;
    skill_manager.save_skill_to_file(&skill_with_path)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn create_skill_from_template(app: AppHandle, template_id: String) -> Result<Skill, String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.create_skill_from_template(&template_id)
}

#[tauri::command]
#[specta::specta]
pub fn reorder_skills(app: AppHandle, order: Vec<String>) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.save_order(&order)
}

#[tauri::command]
#[specta::specta]
pub fn get_builtin_skills(app: AppHandle) -> Vec<Skill> {
    let settings = settings::get_settings(&app);
    settings
        .post_process_prompts
        .into_iter()
        .filter(|s| matches!(s.source, SkillSource::Builtin))
        .collect()
}

#[tauri::command]
#[specta::specta]
pub fn get_default_skill_content(app: AppHandle, skill_id: String) -> Option<Skill> {
    let settings = settings::get_settings(&app);
    settings
        .post_process_prompts
        .into_iter()
        .find(|s| s.id == skill_id && matches!(s.source, SkillSource::Builtin))
}

#[tauri::command]
#[specta::specta]
pub fn get_external_skills(app: AppHandle) -> Vec<Skill> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.load_all_external_skills()
}

#[tauri::command]
#[specta::specta]
pub fn open_skills_folder(app: AppHandle) -> Result<(), String> {
    let home_dir = app.path().home_dir().map_err(|e| e.to_string())?;
    let skills_dir = home_dir.join(".votype").join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    }
    app.opener()
        .open_path(skills_dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn refresh_external_skills(app: AppHandle) -> Vec<Skill> {
    get_external_skills(app)
}

#[tauri::command]
#[specta::specta]
pub fn reset_skill_to_file_version(app: AppHandle, skill_id: String) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager
        .find_skill_file_path(&skill_id)
        .ok_or_else(|| "File not found".to_string())?;
    let source = if file_path.to_string_lossy().contains("/user/") {
        SkillSource::User
    } else {
        SkillSource::Imported
    };
    let file_skill = skill_manager
        .load_skill_from_path(&file_path, source)
        .ok_or_else(|| "Load failed".to_string())?;
    let mut settings = settings::get_settings(&app);
    if let Some(existing) = settings
        .post_process_prompts
        .iter_mut()
        .find(|p| p.id == skill_id)
    {
        *existing = file_skill;
        existing.customized = false;
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err("Skill not found in settings".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_skill_source_file(app: AppHandle, skill_id: String) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager
        .find_skill_file_path(&skill_id)
        .ok_or_else(|| "File not found".to_string())?;
    app.opener()
        .open_path(file_path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn ai_generate_skill(
    app: AppHandle,
    name: String,
    description: String,
    output_mode: String,
) -> Result<String, String> {
    use crate::llm_client::create_client;
    use async_openai::types::{
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
    };

    let settings = settings::get_settings(&app);

    // Get text provider
    let provider = settings
        .active_post_process_provider()
        .ok_or("No text provider configured")?;

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = create_client(&provider, api_key).map_err(|e| e.to_string())?;

    // Get model ID
    let model_id = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .filter(|id| !id.trim().is_empty())
        .or_else(|| {
            settings
                .cached_models
                .iter()
                .find(|m| m.provider_id == provider.id && m.model_type == settings::ModelType::Text)
                .map(|m| m.model_id.clone())
        })
        .ok_or_else(|| format!("No model found for provider {}", provider.id))?;

    // Build prompt
    let prompt = format!(
        r#"You are a professional Prompt Engineer. Generate a high-quality AI Skill instruction based on the information provided.

## Skill Name
{}

## Function Description
{}

## Output Mode
{}

## Requirements
1. The instruction should be clear, professional, and easy to understand
2. Include role definition, task description, input variable description, and output format
3. Design appropriate output format based on "output mode" ({}):
   - polish mode: Return JSON format {{"text": "...", "confidence": 0-100, "reason": "..."}}
   - chat mode: Return processed text content directly
4. Use Markdown format with variable placeholders:
   - ${{output}}: Final recognized text
   - ${{raw_input}}: Complete original transcription text
   - ${{select}}: Selected text content
   - ${{streaming_output}}: Intermediate text during real-time transcription
   - ${{hot_words}}: Custom vocabulary/hot words
   - ${{context}}: Historical chat context
   - ${{app_name}}: Current application name
   - ${{window_title}}: Current window title
   - ${{time}}: Current time
5. Return ONLY the instruction content, without any explanation, preface, or suffix"#,
        name, description, output_mode, output_mode
    );

    // Call LLM
    let mut messages = Vec::new();

    if let Ok(sys_msg) = ChatCompletionRequestSystemMessageArgs::default()
        .content("You are a helpful prompt engineering assistant.")
        .build()
    {
        messages.push(ChatCompletionRequestMessage::System(sys_msg));
    }

    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    let request = CreateChatCompletionRequestArgs::default()
        .model(model_id)
        .messages(messages)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or("No response from LLM")?;

    Ok(content)
}

#[tauri::command]
#[specta::specta]
pub fn check_skill_id_conflict(
    app: AppHandle,
    skill_id: String,
    is_external: bool,
) -> Result<bool, String> {
    let settings = settings::get_settings(&app);
    if is_external {
        Ok(settings
            .post_process_prompts
            .iter()
            .any(|p| p.id == skill_id && p.source == SkillSource::Builtin))
    } else {
        let skill_manager = crate::managers::skill::SkillManager::new(&app);
        Ok(skill_manager
            .load_all_external_skills()
            .iter()
            .any(|s| s.id == skill_id))
    }
}

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
pub fn change_post_process_base_url_setting(
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;
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
    validate_provider_exists(&settings, &provider_id)?;
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
    validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_models.insert(provider_id, model);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_provider_id = provider_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_post_process_models(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<String>, String> {
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

    fetch_models_manual(provider, api_key).await
}

#[tauri::command]
#[specta::specta]
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
        base_url: crate::utils::normalize_base_url(&base_url),
        allow_base_url_edit: true,
        models_endpoint,
    };
    settings.post_process_providers.push(provider.clone());
    settings::write_settings(&app, settings);
    Ok(provider)
}

#[tauri::command]
#[specta::specta]
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
        .ok_or("Provider not found")?;
    if let Some(l) = label {
        provider.label = l;
    }
    if let Some(b) = base_url {
        provider.base_url = crate::utils::normalize_base_url(&b);
    }
    if let Some(m) = models_endpoint {
        provider.models_endpoint = Some(m);
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn remove_custom_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings
        .post_process_providers
        .retain(|p| p.id != provider_id);
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
    app_to_profile: HashMap<String, String>,
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
pub fn confirm_reviewed_transcription(
    app: AppHandle,
    text: String,
    history_id: Option<i64>,
    cached_model_id: Option<String>,
) -> Result<(), String> {
    use std::time::Duration;

    log::info!(
        "confirm_reviewed_transcription: inserting {} chars, history_id={:?}, cached_model_id={:?}",
        text.len(),
        history_id,
        cached_model_id
    );

    // Resolve the actual model_id from cached_model_id
    let model_id = cached_model_id.and_then(|cm_id| {
        let settings = settings::get_settings(&app);
        settings
            .get_cached_model(&cm_id)
            .map(|cm| cm.model_id.clone())
    });

    // Update history with the selected/inserted text
    if let Some(hid) = history_id {
        let app_for_history = app.clone();
        let text_for_history = text.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(hm) = app_for_history
                .try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
            {
                if let Err(e) = hm.update_reviewed_text(hid, text_for_history).await {
                    log::error!("Failed to update history with reviewed text: {}", e);
                }
                // Update model name if the user selected a specific candidate
                if let Some(model_name) = model_id {
                    if let Err(e) = hm.update_post_process_model(hid, &model_name) {
                        log::error!("Failed to update model in history: {}", e);
                    }
                }
            }
        });
    }

    // Hide the review window
    crate::review_window::hide_review_window(&app, history_id);

    // Focus the previously active window and paste
    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app: {}", e);
        } else {
            std::thread::sleep(Duration::from_millis(120));
        }
    }

    crate::clipboard::paste(text, app)
}

#[tauri::command]
#[specta::specta]
pub fn cancel_transcription_review(
    app: AppHandle,
    text: Option<String>,
    history_id: Option<i64>,
) -> Result<(), String> {
    log::info!(
        "cancel_transcription_review: history_id={:?}, has_text={}",
        history_id,
        text.is_some()
    );

    // Hide the review window
    crate::review_window::hide_review_window(&app, history_id);

    // Restore focus to previous window
    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app on cancel: {}", e);
        }
    }

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
pub fn change_confidence_check_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.confidence_check_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_confidence_threshold_setting(app: AppHandle, threshold: u8) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.confidence_threshold = threshold;
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

// Group: Multi-Model Post-Process Review Commands

#[derive(serde::Serialize, Clone, specta::Type)]
pub struct PromptInfo {
    pub id: String,
    pub name: String,
}

#[derive(serde::Serialize, Clone, specta::Type)]
pub struct PromptListResponse {
    pub prompts: Vec<PromptInfo>,
    pub selected_id: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn get_post_process_prompts(app: AppHandle) -> PromptListResponse {
    let settings = settings::get_settings(&app);
    let prompts = settings
        .post_process_prompts
        .iter()
        .filter(|p| p.enabled)
        .map(|p| PromptInfo {
            id: p.id.clone(),
            name: p.name.clone(),
        })
        .collect();
    PromptListResponse {
        prompts,
        selected_id: settings.post_process_selected_prompt_id.clone(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn rerun_multi_model_with_prompt(
    app: AppHandle,
    prompt_id: String,
    source_text: String,
    history_id: Option<i64>,
) -> Result<(), String> {
    let settings = settings::get_settings(&app);

    // Build multi-model items with the specified prompt_id
    let items: Vec<settings::MultiModelPostProcessItem> = settings
        .multi_model_selected_ids
        .iter()
        .filter_map(|id| {
            let cm = settings.get_cached_model(id)?;
            if cm.model_type != settings::ModelType::Text {
                return None;
            }
            Some(settings::MultiModelPostProcessItem {
                id: cm.id.clone(),
                provider_id: cm.provider_id.clone(),
                model_id: cm.model_id.clone(),
                prompt_id: prompt_id.clone(),
                custom_label: cm.custom_label.clone(),
                enabled: true,
            })
        })
        .collect();

    if items.is_empty() {
        return Err("No models selected".to_string());
    }

    // Build initial loading candidates
    let initial_candidates: Vec<crate::review_window::MultiModelCandidate> = items
        .iter()
        .map(|item| {
            let label = item
                .custom_label
                .clone()
                .unwrap_or_else(|| item.model_id.clone());
            crate::review_window::MultiModelCandidate {
                id: item.id.clone(),
                label,
                text: String::new(),
                confidence: None,
                processing_time_ms: 0,
                error: None,
                ready: false,
            }
        })
        .collect();

    // Emit loading candidates to reset the review window
    let _ = app.emit(
        "multi-model-rerun-reset",
        serde_json::json!({
            "candidates": initial_candidates,
        }),
    );

    // Spawn async task for re-processing
    let app_clone = app.clone();
    let source_clone = source_text.clone();
    // Get active window info for history context
    let active_window = crate::review_window::get_last_active_window();
    let ctx_app_name = active_window.as_ref().map(|w| w.app_name.clone());
    let ctx_window_title = active_window.as_ref().map(|w| w.title.clone());

    tauri::async_runtime::spawn(async move {
        // Build a modified settings with the overridden prompt for item lookup
        let mut rerun_settings = settings.clone();
        rerun_settings.multi_model_post_process_enabled = true;
        // Clear selected_ids so the function falls back to multi_model_post_process_items
        rerun_settings.multi_model_selected_ids = vec![];
        rerun_settings.multi_model_post_process_items = items;

        // Use the raw multi-model pipeline (it will use items directly)
        let _results = crate::actions::post_process::multi_post_process_transcription(
            &app_clone,
            &rerun_settings,
            &source_clone,
            None,
            history_id,
            ctx_app_name,
            ctx_window_title,
        )
        .await;
    });

    Ok(())
}

// Group: Multi-Model Post-Process Settings

#[tauri::command]
#[specta::specta]
pub fn toggle_multi_model_selection(
    app: AppHandle,
    cached_model_id: String,
    selected: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if selected {
        if !settings.multi_model_selected_ids.contains(&cached_model_id) {
            settings.multi_model_selected_ids.push(cached_model_id);
        }
    } else {
        settings
            .multi_model_selected_ids
            .retain(|id| id != &cached_model_id);
    }
    // Auto-enable/disable multi-model mode based on selection count
    settings.multi_model_post_process_enabled = settings.multi_model_selected_ids.len() >= 2;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_multi_model_post_process_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.multi_model_post_process_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn add_multi_model_post_process_item(
    app: AppHandle,
    item: settings::MultiModelPostProcessItem,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.multi_model_post_process_items.push(item);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_multi_model_post_process_item(
    app: AppHandle,
    item: settings::MultiModelPostProcessItem,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if let Some(pos) = settings
        .multi_model_post_process_items
        .iter()
        .position(|i| i.id == item.id)
    {
        settings.multi_model_post_process_items[pos] = item;
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err("Item not found".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn remove_multi_model_post_process_item(app: AppHandle, item_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings
        .multi_model_post_process_items
        .retain(|i| i.id != item_id);
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

// Group: Inference Testing
#[tauri::command]
#[specta::specta]
pub async fn test_post_process_model_inference(
    app: AppHandle,
    model_id: String,
    provider_id: String,
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

    let result = crate::llm_client::send_chat_completion(
        provider,
        api_key,
        &model_id,
        "你是啥模型？".to_string(),
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

// Helpers
fn validate_provider_exists(
    settings: &settings::AppSettings,
    provider_id: &str,
) -> Result<(), String> {
    if !settings
        .post_process_providers
        .iter()
        .any(|p| p.id == provider_id)
    {
        return Err("Provider not found".to_string());
    }
    Ok(())
}

async fn fetch_models_manual(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    crate::llm_client::fetch_models(provider, api_key).await
}

fn unregister_all_shortcuts(app: &AppHandle, implementation: KeyboardImplementation) {
    let settings = get_settings(app);
    for binding in settings.bindings.values() {
        match implementation {
            KeyboardImplementation::Tauri => {
                let _ = tauri_impl::unregister_shortcut(app, binding.clone());
            }
            KeyboardImplementation::HandyKeys => {
                let _ = handy_keys::unregister_shortcut(app, binding.clone());
            }
        }
    }
}

fn register_all_shortcuts_for_implementation(
    app: &AppHandle,
    implementation: KeyboardImplementation,
) -> Vec<String> {
    let mut settings = get_settings(app);
    let mut reset_bindings = vec![];
    let mut updated_bindings = settings.bindings.clone();
    for (id, binding) in settings.bindings.clone().iter() {
        if let Err(_) =
            validate_shortcut_for_implementation(&binding.current_binding, implementation)
        {
            let mut new_binding = binding.clone();
            new_binding.current_binding = binding.default_binding.clone();
            updated_bindings.insert(id.clone(), new_binding.clone());
            reset_bindings.push(id.clone());
            let _ = register_shortcut(app, new_binding);
        } else {
            let _ = register_shortcut(app, binding.clone());
        }
    }
    if !reset_bindings.is_empty() {
        settings.bindings = updated_bindings;
        settings::write_settings(app, settings);
    }
    reset_bindings
}

fn initialize_handy_keys_with_rollback(app: &AppHandle) -> Result<bool, String> {
    handy_keys::init_shortcuts(app).map(|_| true)
}
