//! Hotword Tauri Commands

use crate::managers::HotwordManager;
use crate::settings::{Hotword, HotwordCategory, HotwordScenario};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::managers::history::HistoryManager;

#[tauri::command]
pub fn get_hotwords(app: AppHandle) -> Result<Vec<Hotword>, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.get_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_hotword(
    app: AppHandle,
    target: String,
    originals: Vec<String>,
    category: Option<HotwordCategory>,
    scenarios: Vec<HotwordScenario>,
) -> Result<Hotword, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    let scenarios_opt = if scenarios.is_empty() {
        None
    } else {
        Some(scenarios)
    };
    manager
        .add(target, originals, category, scenarios_opt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_hotword(
    app: AppHandle,
    id: i64,
    target: Option<String>,
    originals: Vec<String>,
    category: HotwordCategory,
    scenarios: Vec<HotwordScenario>,
) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager
        .update(id, target, originals, category, scenarios)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_hotword(app: AppHandle, id: i64) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn infer_hotword_category(target: String) -> HotwordCategory {
    HotwordManager::infer_category(&target)
}

#[tauri::command]
pub fn increment_hotword_false_positive(app: AppHandle, id: i64) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager
        .increment_false_positive(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_hotword_suggestions(app: AppHandle) -> Result<Vec<Hotword>, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.get_suggestions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn accept_hotword_suggestion(app: AppHandle, id: i64) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.accept_suggestion(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_hotword_suggestion(app: AppHandle, id: i64) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.dismiss_suggestion(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn accept_all_hotword_suggestions(app: AppHandle) -> Result<u64, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.accept_all_suggestions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_all_hotword_suggestions(app: AppHandle) -> Result<u64, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.dismiss_all_suggestions().map_err(|e| e.to_string())
}
