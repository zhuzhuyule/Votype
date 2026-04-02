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

// Command modules - must be public for Tauri's generated macro code
pub mod multi_model_cmds;
pub mod provider_cmds;
pub mod review_cmds;
pub mod settings_cmds;
pub mod skills_cmds;
pub mod test_cmds;

use log::{error, warn};
use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

use crate::settings::{
    self, get_settings, KeyboardImplementation, PostProcessProvider, ShortcutBinding,
};

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
    let binding = settings::get_stored_binding(&app, &id)
        .ok_or_else(|| format!("Unknown binding: {}", id))?;
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
    crate::llm_client::fetch_models(provider, api_key, None).await
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
