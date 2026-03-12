use tauri::AppHandle;

use crate::settings;

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
pub fn change_multi_model_strategy_setting(app: AppHandle, strategy: String) -> Result<(), String> {
    if !matches!(strategy.as_str(), "manual" | "race" | "lazy") {
        return Err("Invalid multi-model strategy".to_string());
    }
    let mut settings = settings::get_settings(&app);
    settings.multi_model_strategy = strategy;
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
