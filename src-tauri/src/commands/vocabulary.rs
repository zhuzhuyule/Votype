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
    if let Some(name) = app_name {
        // Get corrections for specific app (plus global ones)
        let scopes = vec![name];
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
/// Record a new vocabulary correction manually (e.g. from review dialog)
#[tauri::command]
pub async fn record_vocabulary_correction(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    original_text: String,
    corrected_text: String,
    app_name: Option<String>,
) -> Result<(), String> {
    let vocab_manager = VocabularyManager::new(history_manager.db_path.clone());

    // We construct a Diff object manually
    let diff = crate::managers::vocabulary::WordDiff {
        original: original_text,
        corrected: corrected_text,
    };

    // For manual recording, if app_name is provided, use it as scope hint.
    // If not, default to global.
    let is_global = app_name.is_none();
    let target_apps = app_name
        .map(|app| serde_json::to_string(&vec![app]))
        .transpose()
        .map_err(|e| e.to_string())?;

    vocab_manager
        .record_correction(&diff, is_global, target_apps)
        .map_err(|e| e.to_string())
}
