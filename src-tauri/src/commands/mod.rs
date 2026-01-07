pub mod audio;
pub mod history;
pub mod models;
pub mod text;
pub mod transcription;

use crate::{active_window, settings, utils::cancel_current_operation};
use tauri::{AppHandle, Manager};
use tauri_plugin_log::LogLevel;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> settings::AppSettings {
    settings::get_settings(&app)
}

#[tauri::command]
pub fn cancel_operation(app: AppHandle) {
    cancel_current_operation(&app);
}

#[tauri::command]
pub fn get_app_dir_path(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_log_dir_path(app: AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    Ok(log_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_log_level(app: AppHandle, level: LogLevel) -> Result<(), String> {
    let log_level: log::Level = level.clone().into();
    // Update the file log level atomic so the filter picks up the new level
    crate::FILE_LOG_LEVEL.store(
        log_level.to_level_filter() as u8,
        std::sync::atomic::Ordering::Relaxed,
    );

    let mut settings = settings::get_settings(&app);
    settings.log_level = level;
    settings::write_settings(&app, settings);

    Ok(())
}

#[tauri::command]
pub fn open_recordings_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");

    let path = recordings_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open recordings folder: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_recordings_folder_path(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");

    Ok(recordings_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let path = log_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open log directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn open_app_data_dir(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let path = app_data_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open app data directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_active_window_info() -> Result<active_window::ActiveWindowInfo, String> {
    active_window::fetch_active_window()
}

#[tauri::command]
pub fn get_cursor_position() -> Result<active_window::CursorPosition, String> {
    active_window::fetch_cursor_position()
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    crate::utils::show_or_create_main_window(&app, Some("dashboard"))
        .map(|_| ())
        .map_err(|e| e)
}

#[tauri::command]
pub fn get_first_history_entry(
    app: AppHandle,
) -> Result<Option<crate::managers::history::HistoryEntry>, String> {
    use crate::managers::history::HistoryManager;
    use std::sync::Arc;
    use tauri::async_runtime::block_on;

    // Get the history manager state
    let history_manager = app.state::<Arc<HistoryManager>>();

    // Get all history entries
    let entries = block_on(history_manager.get_history_entries()).map_err(|e| e.to_string())?;

    // Return the first non-deleted entry
    Ok(entries.into_iter().find(|e| !e.deleted))
}

#[tauri::command]
pub fn paste_text_to_active_window(app: AppHandle, text: String) -> Result<(), String> {
    crate::clipboard::paste(text, app)
}

/// Paste text to the previously active window (saved before review window was shown)
/// This first focuses the saved window, then pastes the text
#[tauri::command]
pub fn paste_to_previous_window(app: AppHandle, text: String) -> Result<(), String> {
    use std::time::Duration;

    // Focus the previously active window first
    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app: {}", e);
        } else {
            std::thread::sleep(Duration::from_millis(120));
        }
    }

    // Then paste the text
    crate::clipboard::paste(text, app)
}

#[tauri::command]
pub fn log_to_console(msg: String, level: Option<String>) {
    // Default to info if no level provided
    let log_level = match level.as_deref() {
        Some("error") => log::Level::Error,
        Some("warn") => log::Level::Warn,
        Some("debug") => log::Level::Debug,
        Some("trace") => log::Level::Trace,
        _ => log::Level::Info,
    };

    log::log!(log_level, "[Frontend] {}", msg);
}

#[tauri::command]
pub async fn suggest_aliases(app: AppHandle, description: String) -> Result<Vec<String>, String> {
    crate::actions::post_process::suggest_aliases(&app, &description).await
}

/// Handle user response to skill confirmation prompt
#[tauri::command]
pub async fn confirm_skill(app: AppHandle, skill_id: String, accepted: bool) -> Result<(), String> {
    use crate::ManagedPendingSkillConfirmation;
    use tauri::Manager;

    // Get pending confirmation state
    let pending_state = app.state::<ManagedPendingSkillConfirmation>();
    let pending = {
        let guard = pending_state.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    // Clear the pending state
    {
        let mut guard = pending_state.lock().map_err(|e| e.to_string())?;
        *guard = crate::PendingSkillConfirmation::default();
    }

    // Verify skill_id matches
    if pending.skill_id.as_ref() != Some(&skill_id) {
        return Err("Skill confirmation mismatch".to_string());
    }

    let transcription = pending
        .transcription
        .ok_or("No transcription in pending state")?;
    let settings = crate::settings::get_settings(&app);

    if accepted {
        // User confirmed - execute the skill
        log::info!("[SkillConfirmation] User accepted skill: {}", skill_id);

        // Execute post-processing with the confirmed skill
        let (result, _model, _prompt_id, _err, _confidence, _reason) =
            crate::actions::post_process::maybe_post_process_transcription(
                &app,
                &settings,
                &transcription,
                None,
                false,
                Some(skill_id),
                pending.app_name,
                pending.window_title,
                None,
                None,
                pending.history_id,
                true, // skill_mode
                pending.selected_text,
            )
            .await;

        // Paste result if available
        if let Some(text) = result {
            crate::clipboard::paste(text, app)?;
        }
    } else {
        // User rejected - execute default polish
        log::info!("[SkillConfirmation] User rejected skill, using default polish");

        let (result, _model, _prompt_id, _err, _confidence, _reason) =
            crate::actions::post_process::maybe_post_process_transcription(
                &app,
                &settings,
                &transcription,
                None,
                false,
                None, // Use default prompt
                pending.app_name,
                pending.window_title,
                None,
                None,
                pending.history_id,
                false, // Not skill_mode
                None,  // Ignore selected text for polish
            )
            .await;

        // Paste result if available
        if let Some(text) = result {
            crate::clipboard::paste(text, app)?;
        }
    }

    Ok(())
}
