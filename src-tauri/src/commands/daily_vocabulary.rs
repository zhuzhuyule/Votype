use crate::managers::daily_vocabulary::{DailyVocabularyItem, DailyVocabularyManager, HotwordItem};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

// ============================================================================
// Daily Vocabulary Commands
// ============================================================================

#[tauri::command]
pub async fn get_daily_vocabulary(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    date: String,
) -> Result<Vec<DailyVocabularyItem>, String> {
    vocab_manager
        .get_daily_vocabulary(&date)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_daily_vocabulary(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
) -> Result<Vec<DailyVocabularyItem>, String> {
    vocab_manager
        .get_all_vocabulary_aggregated()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_daily_vocabulary_range(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<DailyVocabularyItem>, String> {
    vocab_manager
        .get_daily_vocabulary_range(&start_date, &end_date)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_word_to_daily_vocabulary(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    date: String,
    word: String,
    context_type: Option<String>,
) -> Result<(), String> {
    vocab_manager
        .add_word_to_daily_vocabulary(&date, &word, context_type.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_word_from_daily_vocabulary(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    date: String,
    word: String,
) -> Result<(), String> {
    vocab_manager
        .remove_word_from_daily_vocabulary(&date, &word)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_word_from_daily_vocabulary_global(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    word: String,
) -> Result<(), String> {
    vocab_manager
        .remove_word_from_daily_vocabulary_global(&word)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_word_context_type(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    date: String,
    word: String,
    context_type: String,
) -> Result<(), String> {
    vocab_manager
        .update_word_context_type(&date, &word, &context_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_word_context_type_global(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    word: String,
    context_type: String,
) -> Result<(), String> {
    vocab_manager
        .update_word_context_type_global(&word, &context_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn batch_update_context_types(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    date: String,
    updates: Vec<(String, String)>,
) -> Result<(), String> {
    vocab_manager
        .batch_update_context_types(&date, updates)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Hotword Promotion Commands
// ============================================================================

#[tauri::command]
pub async fn promote_word_to_hotword(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    word: String,
    context_type: Option<String>,
    weight: Option<f64>,
) -> Result<(), String> {
    vocab_manager
        .promote_to_hotword(&word, context_type.as_deref(), weight)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn batch_promote_to_hotword(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    words: Vec<(String, Option<String>, Option<f64>)>,
) -> Result<Vec<String>, String> {
    vocab_manager
        .batch_promote_to_hotword(words)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_vocabulary_hotwords(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    context_type: Option<String>,
) -> Result<Vec<HotwordItem>, String> {
    vocab_manager
        .get_hotwords(context_type.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_from_hotword(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    word: String,
) -> Result<(), String> {
    vocab_manager
        .remove_from_hotword(&word)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_hotword_metadata(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    word: String,
    context_type: Option<String>,
    weight: Option<f64>,
) -> Result<(), String> {
    vocab_manager
        .update_hotword_metadata(&word, context_type.as_deref(), weight)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Statistics Commands
// ============================================================================

#[tauri::command]
pub async fn get_vocabulary_stats(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
) -> Result<HashMap<String, i32>, String> {
    vocab_manager
        .get_vocabulary_stats()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_daily_vocabulary_stats(
    vocab_manager: State<'_, Arc<DailyVocabularyManager>>,
    date: String,
) -> Result<HashMap<String, i32>, String> {
    vocab_manager
        .get_daily_stats(&date)
        .map_err(|e| e.to_string())
}
