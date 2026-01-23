use crate::managers::history::HistoryManager;
use crate::managers::vocabulary::{VocabularyCorrection, VocabularyManager};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Get all vocabulary corrections (for management UI)
#[tauri::command]
pub async fn get_vocabulary_corrections(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    app_name: Option<String>,
) -> Result<Vec<VocabularyCorrection>, String> {
    let vocab_manager = VocabularyManager::new(history_manager.db_path.clone());
    if app_name.is_some() {
        // Get corrections for specific app (plus global ones)
        let scopes = vec![app_name.unwrap()];
        vocab_manager
            .get_active_corrections(Some(&scopes))
            .map_err(|e| e.to_string())
    } else {
        // Get all corrections (for management UI)
        vocab_manager
            .get_all_corrections()
            .map_err(|e| e.to_string())
    }
}

/// Delete a vocabulary correction
#[tauri::command]
pub async fn delete_vocabulary_correction(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    let vocab_manager = VocabularyManager::new(history_manager.db_path.clone());
    vocab_manager
        .delete_correction(id)
        .map_err(|e| e.to_string())
}
/// Update scope for a vocabulary correction (by target word)
#[tauri::command]
pub async fn update_vocabulary_correction_scope(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    corrected_text: String,
    is_global: bool,
    target_apps: Option<String>,
) -> Result<(), String> {
    let vocab_manager = VocabularyManager::new(history_manager.db_path.clone());
    vocab_manager
        .update_scope_by_target(&corrected_text, is_global, target_apps)
        .map_err(|e| e.to_string())
}
