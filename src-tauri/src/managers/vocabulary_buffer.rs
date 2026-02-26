//! Vocabulary Buffer Manager
//!
//! Manages the extraction buffer for AI-extracted vocabulary with rich metadata.
//! Three-tier architecture:
//! 1. Extraction Buffer (this module) - All AI-extracted words with metadata
//! 2. Candidate Pool - User-marked words (user_decision != null)
//! 3. Hotword Library - Auto-promoted high-frequency words

use anyhow::Result;
use chrono::Utc;
use log::{debug, info};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Represents a vocabulary item in the extraction buffer
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VocabularyBufferItem {
    pub id: i64,
    pub word: String,
    pub normalized_word: String,
    pub category: String,
    pub confidence: i32,
    pub frequency_count: i32,
    pub frequency_type: String,
    pub possible_typo: bool,
    pub similar_suggestions: Option<Vec<String>>,
    pub context_sample: Option<String>,
    pub source_summary_id: Option<i64>,
    pub extraction_date: String,
    pub cumulative_count: i32,
    pub days_appeared: i32,
    pub user_decision: Option<String>,
    pub promoted_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input data for adding a new vocabulary item
#[derive(Clone, Debug)]
pub struct VocabularyInput {
    pub word: String,
    pub category: String,
    pub confidence: i32,
    pub frequency_count: i32,
    pub frequency_type: String,
    pub possible_typo: bool,
    pub similar_suggestions: Option<Vec<String>>,
    pub context_sample: Option<String>,
    pub source_summary_id: Option<i64>,
}

/// Manages vocabulary buffer for AI-extracted words
pub struct VocabularyBufferManager {
    db_path: PathBuf,
}

impl VocabularyBufferManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Normalize a word for deduplication (lowercase, trim)
    fn normalize_word(word: &str) -> String {
        word.trim().to_lowercase()
    }

    /// Add or update a vocabulary item in the buffer
    /// If the word already exists (by normalized_word), accumulate counts and update metadata
    pub fn add_or_update(&self, input: VocabularyInput) -> Result<VocabularyBufferItem> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let normalized = Self::normalize_word(&input.word);

        let similar_suggestions_json = input
            .similar_suggestions
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));

        // Check if word already exists
        let existing: Option<(i64, i32, i32, String, i64)> = conn
            .query_row(
                "SELECT id, cumulative_count, days_appeared, extraction_date, created_at
                 FROM vocabulary_buffer
                 WHERE normalized_word = ?1",
                params![normalized],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .ok();

        if let Some((id, cumulative_count, days_appeared, last_extraction_date, _created_at)) =
            existing
        {
            // Update existing record
            let new_cumulative_count = cumulative_count + input.frequency_count;
            let new_days_appeared = if last_extraction_date == today {
                days_appeared
            } else {
                days_appeared + 1
            };

            // Only update confidence if new confidence is higher
            conn.execute(
                "UPDATE vocabulary_buffer
                 SET cumulative_count = ?1,
                     days_appeared = ?2,
                     extraction_date = ?3,
                     confidence = MAX(confidence, ?4),
                     frequency_count = ?5,
                     frequency_type = ?6,
                     source_summary_id = COALESCE(?7, source_summary_id),
                     context_sample = COALESCE(?8, context_sample),
                     updated_at = ?9
                 WHERE id = ?10",
                params![
                    new_cumulative_count,
                    new_days_appeared,
                    today,
                    input.confidence,
                    input.frequency_count,
                    input.frequency_type,
                    input.source_summary_id,
                    input.context_sample,
                    now,
                    id
                ],
            )?;

            info!(
                "[VocabBuffer] Updated '{}': cumulative={}, days={}, confidence={}",
                input.word, new_cumulative_count, new_days_appeared, input.confidence
            );

            // Return updated record
            self.get_by_id(id)
        } else {
            // Insert new record
            conn.execute(
                "INSERT INTO vocabulary_buffer
                 (word, normalized_word, category, confidence, frequency_count, frequency_type,
                  possible_typo, similar_suggestions, context_sample, source_summary_id,
                  extraction_date, cumulative_count, days_appeared, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                params![
                    input.word,
                    normalized,
                    input.category,
                    input.confidence,
                    input.frequency_count,
                    input.frequency_type,
                    input.possible_typo,
                    similar_suggestions_json,
                    input.context_sample,
                    input.source_summary_id,
                    today,
                    input.frequency_count,
                    1,
                    now
                ],
            )?;

            let id = conn.last_insert_rowid();

            info!(
                "[VocabBuffer] Added '{}' (category={}, confidence={}, frequency={})",
                input.word, input.category, input.confidence, input.frequency_count
            );

            self.get_by_id(id)
        }
    }

    /// Get a vocabulary item by ID
    pub fn get_by_id(&self, id: i64) -> Result<VocabularyBufferItem> {
        let conn = self.get_connection()?;
        conn.query_row(
            "SELECT id, word, normalized_word, category, confidence, frequency_count,
                    frequency_type, possible_typo, similar_suggestions, context_sample,
                    source_summary_id, extraction_date, cumulative_count, days_appeared,
                    user_decision, promoted_at, created_at, updated_at
             FROM vocabulary_buffer WHERE id = ?1",
            params![id],
            |row| {
                Ok(VocabularyBufferItem {
                    id: row.get(0)?,
                    word: row.get(1)?,
                    normalized_word: row.get(2)?,
                    category: row.get(3)?,
                    confidence: row.get(4)?,
                    frequency_count: row.get(5)?,
                    frequency_type: row.get(6)?,
                    possible_typo: row.get(7)?,
                    similar_suggestions: row
                        .get::<_, Option<String>>(8)?
                        .and_then(|s| serde_json::from_str(&s).ok()),
                    context_sample: row.get(9)?,
                    source_summary_id: row.get(10)?,
                    extraction_date: row.get(11)?,
                    cumulative_count: row.get(12)?,
                    days_appeared: row.get(13)?,
                    user_decision: row.get(14)?,
                    promoted_at: row.get(15)?,
                    created_at: row.get(16)?,
                    updated_at: row.get(17)?,
                })
            },
        )
        .map_err(|e| anyhow::anyhow!("Failed to get vocabulary item: {}", e))
    }

    /// Get all items in the buffer, ordered by cumulative count
    pub fn get_all(&self) -> Result<Vec<VocabularyBufferItem>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, word, normalized_word, category, confidence, frequency_count,
                    frequency_type, possible_typo, similar_suggestions, context_sample,
                    source_summary_id, extraction_date, cumulative_count, days_appeared,
                    user_decision, promoted_at, created_at, updated_at
             FROM vocabulary_buffer
             ORDER BY cumulative_count DESC, confidence DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(VocabularyBufferItem {
                id: row.get(0)?,
                word: row.get(1)?,
                normalized_word: row.get(2)?,
                category: row.get(3)?,
                confidence: row.get(4)?,
                frequency_count: row.get(5)?,
                frequency_type: row.get(6)?,
                possible_typo: row.get(7)?,
                similar_suggestions: row
                    .get::<_, Option<String>>(8)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                context_sample: row.get(9)?,
                source_summary_id: row.get(10)?,
                extraction_date: row.get(11)?,
                cumulative_count: row.get(12)?,
                days_appeared: row.get(13)?,
                user_decision: row.get(14)?,
                promoted_at: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }

        debug!("[VocabBuffer] Retrieved {} items", items.len());
        Ok(items)
    }

    /// Get items that meet auto-promotion criteria
    /// Default criteria: cumulative_count >= 10 AND days_appeared >= 3 AND confidence >= 80
    pub fn get_auto_promotion_candidates(
        &self,
        min_cumulative: i32,
        min_days: i32,
        min_confidence: i32,
    ) -> Result<Vec<VocabularyBufferItem>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, word, normalized_word, category, confidence, frequency_count,
                    frequency_type, possible_typo, similar_suggestions, context_sample,
                    source_summary_id, extraction_date, cumulative_count, days_appeared,
                    user_decision, promoted_at, created_at, updated_at
             FROM vocabulary_buffer
             WHERE cumulative_count >= ?1
               AND days_appeared >= ?2
               AND confidence >= ?3
               AND promoted_at IS NULL
             ORDER BY cumulative_count DESC",
        )?;

        let rows = stmt.query_map(params![min_cumulative, min_days, min_confidence], |row| {
            Ok(VocabularyBufferItem {
                id: row.get(0)?,
                word: row.get(1)?,
                normalized_word: row.get(2)?,
                category: row.get(3)?,
                confidence: row.get(4)?,
                frequency_count: row.get(5)?,
                frequency_type: row.get(6)?,
                possible_typo: row.get(7)?,
                similar_suggestions: row
                    .get::<_, Option<String>>(8)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                context_sample: row.get(9)?,
                source_summary_id: row.get(10)?,
                extraction_date: row.get(11)?,
                cumulative_count: row.get(12)?,
                days_appeared: row.get(13)?,
                user_decision: row.get(14)?,
                promoted_at: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }

        if !items.is_empty() {
            info!("[VocabBuffer] Found {} auto-promotion candidates", items.len());
        }

        Ok(items)
    }

    /// Mark a word as promoted (moved to hotword library)
    pub fn mark_as_promoted(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        conn.execute(
            "UPDATE vocabulary_buffer SET promoted_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        debug!("[VocabBuffer] Marked item {} as promoted", id);
        Ok(())
    }

    /// Update user decision (approve/reject/ignore)
    pub fn update_user_decision(&self, id: i64, decision: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        conn.execute(
            "UPDATE vocabulary_buffer SET user_decision = ?1, updated_at = ?2 WHERE id = ?3",
            params![decision, now, id],
        )?;

        info!(
            "[VocabBuffer] Updated user decision for item {}: {}",
            id, decision
        );
        Ok(())
    }

    /// Delete a vocabulary item
    pub fn delete(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM vocabulary_buffer WHERE id = ?1", params![id])?;
        info!("[VocabBuffer] Deleted item {}", id);
        Ok(())
    }

    /// Get statistics about the buffer
    pub fn get_stats(&self) -> Result<BufferStats> {
        let conn = self.get_connection()?;

        let (total, high_confidence, typos, promoted): (i64, i64, i64, i64) = conn.query_row(
            "SELECT
                COUNT(*) as total,
                SUM(CASE WHEN confidence >= 80 THEN 1 ELSE 0 END) as high_confidence,
                SUM(CASE WHEN possible_typo = 1 THEN 1 ELSE 0 END) as typos,
                SUM(CASE WHEN promoted_at IS NOT NULL THEN 1 ELSE 0 END) as promoted
             FROM vocabulary_buffer",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;

        Ok(BufferStats {
            total,
            high_confidence,
            typos,
            promoted,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BufferStats {
    pub total: i64,
    pub high_confidence: i64,
    pub typos: i64,
    pub promoted: i64,
}
