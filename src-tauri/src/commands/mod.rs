pub mod audio;
pub mod history;
pub mod models;
pub mod transcription;

use crate::{active_window, settings, utils::cancel_current_operation};
use tauri::{AppHandle, Manager};
use tauri_plugin_log::LogLevel;
use tauri_plugin_opener::OpenerExt;

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
