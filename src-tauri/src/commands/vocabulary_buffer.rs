use crate::managers::vocabulary_buffer::{BufferStats, VocabularyBufferItem};
use crate::managers::VocabularyBufferManager;
use crate::settings::{HotwordCategory, HotwordScenario};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_vocabulary_buffer(
    vocab_buffer_manager: State<'_, Arc<VocabularyBufferManager>>,
) -> Result<Vec<VocabularyBufferItem>, String> {
    vocab_buffer_manager.get_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_vocabulary_buffer_stats(
    vocab_buffer_manager: State<'_, Arc<VocabularyBufferManager>>,
) -> Result<BufferStats, String> {
    vocab_buffer_manager.get_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_vocabulary_decision(
    vocab_buffer_manager: State<'_, Arc<VocabularyBufferManager>>,
    id: i64,
    decision: String,
) -> Result<(), String> {
    vocab_buffer_manager
        .update_user_decision(id, &decision)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn promote_vocabulary_to_hotword(
    vocab_buffer_manager: State<'_, Arc<VocabularyBufferManager>>,
    hotword_manager: State<'_, Arc<crate::managers::HotwordManager>>,
    id: i64,
) -> Result<(), String> {
    // Get the item from buffer
    let item = vocab_buffer_manager
        .get_by_id(id)
        .map_err(|e| e.to_string())?;

    // Map category string to enum
    let category = match item.category.as_str() {
        "Person" | "人名" => Some(HotwordCategory::Person),
        "Term" | "术语" | "Project" | "项目" => Some(HotwordCategory::Term),
        "Abbreviation" | "缩写" => Some(HotwordCategory::Abbreviation),
        "Brand" | "品牌" => Some(HotwordCategory::Brand),
        _ => None,
    };

    // Add to hotword library
    match hotword_manager
        .add(
            item.word.clone(),
            vec![], // No originals for now
            category,
            Some(vec![HotwordScenario::Work]),
        ) {
        Ok(_) => {},
        Err(e) => {
            // If it's a unique constraint error, that's OK - already promoted
            if e.to_string().contains("UNIQUE constraint") {
                log::info!("Vocabulary '{}' already exists in hotword library", item.word);
            } else {
                return Err(e.to_string());
            }
        }
    }

    // Mark as promoted in buffer
    vocab_buffer_manager
        .mark_as_promoted(id)
        .map_err(|e| e.to_string())?;

    log::info!(
        "Promoted vocabulary '{}' to hotword library (id={})",
        item.word,
        id
    );

    Ok(())
}

#[tauri::command]
pub async fn delete_vocabulary_buffer_item(
    vocab_buffer_manager: State<'_, Arc<VocabularyBufferManager>>,
    id: i64,
) -> Result<(), String> {
    vocab_buffer_manager.delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_promote_vocabulary(
    vocab_buffer_manager: State<'_, Arc<VocabularyBufferManager>>,
    hotword_manager: State<'_, Arc<crate::managers::HotwordManager>>,
    min_cumulative: Option<i32>,
    min_days: Option<i32>,
    min_confidence: Option<i32>,
) -> Result<usize, String> {
    let min_cumulative = min_cumulative.unwrap_or(10);
    let min_days = min_days.unwrap_or(3);
    let min_confidence = min_confidence.unwrap_or(80);

    let candidates = vocab_buffer_manager
        .get_auto_promotion_candidates(min_cumulative, min_days, min_confidence)
        .map_err(|e| e.to_string())?;

    let mut promoted_count = 0;

    for item in candidates {
        // Map category
        let category = match item.category.as_str() {
            "Person" | "人名" => Some(HotwordCategory::Person),
            "Term" | "术语" | "Project" | "项目" => Some(HotwordCategory::Term),
            "Abbreviation" | "缩写" => Some(HotwordCategory::Abbreviation),
            "Brand" | "品牌" => Some(HotwordCategory::Brand),
            _ => None,
        };

        // Try to add to hotword library
        match hotword_manager.add(
            item.word.clone(),
            vec![],
            category,
            Some(vec![HotwordScenario::Work]),
        ) {
            Ok(_) => {
                // Mark as promoted
                if let Err(e) = vocab_buffer_manager.mark_as_promoted(item.id) {
                    log::warn!("Failed to mark {} as promoted: {}", item.word, e);
                } else {
                    promoted_count += 1;
                    log::info!("Auto-promoted '{}' to hotword library", item.word);
                }
            }
            Err(e) => {
                // If unique constraint, it's already in hotwords
                if e.to_string().contains("UNIQUE constraint") {
                    if let Err(e) = vocab_buffer_manager.mark_as_promoted(item.id) {
                        log::warn!("Failed to mark {} as promoted: {}", item.word, e);
                    }
                } else {
                    log::warn!("Failed to auto-promote '{}': {}", item.word, e);
                }
            }
        }
    }

    log::info!(
        "Auto-promotion completed: {} words promoted to hotword library",
        promoted_count
    );

    Ok(promoted_count)
}
