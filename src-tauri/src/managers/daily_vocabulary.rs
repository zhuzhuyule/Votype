//! Daily Vocabulary Manager
//!
//! Manages a three-tier vocabulary system:
//! 1. Daily Vocabulary - AI-extracted words per day, user-editable
//! 2. Vocabulary Candidates - Dynamic aggregation from daily vocabulary
//! 3. Hotword Library - Promoted high-frequency words for speech recognition

use anyhow::Result;
use chrono::Utc;
use log::{debug, info};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Daily vocabulary item - extracted per day
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DailyVocabularyItem {
    pub id: i64,
    pub date: String,
    pub word: String,
    pub context_type: Option<String>,
    pub frequency: i32,
    pub source: String, // ai_extracted, user_added
    pub created_at: i64,
    pub updated_at: i64,
}

/// Hotword item with promotion metadata
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HotwordItem {
    pub word: String,
    pub context_type: Option<String>,
    pub weight: f64,
    pub total_occurrences: i32,
    pub days_count: i32,
    pub promotion_type: String, // manual, auto
    pub promoted_at: Option<i64>,
    pub promoted_from_date: Option<String>,
}

/// Context types for vocabulary classification
#[allow(dead_code)]
pub const CONTEXT_TYPES: &[&str] = &[
    "work",          // 工作相关
    "life",          // 生活相关
    "learning",      // 学习相关
    "entertainment", // 娱乐相关
    "people",        // 人名
    "location",      // 地点
    "other",         // 其他
];

pub struct DailyVocabularyManager {
    db_path: PathBuf,
}

impl DailyVocabularyManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        Ok(conn)
    }

    // ============================================================================
    // Daily Vocabulary Management
    // ============================================================================

    /// Store daily vocabulary items (batch)
    /// Replaces existing entries for the same date+word combination
    pub fn store_daily_vocabulary(
        &self,
        date: &str,
        words: Vec<(String, Option<String>, i32)>, // (word, context_type, frequency)
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        let word_count = words.len();

        let tx = conn.unchecked_transaction()?;

        for (word, context_type, frequency) in words {
            tx.execute(
                "INSERT INTO daily_vocabulary (date, word, context_type, frequency, source, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'ai_extracted', ?5, ?6)
                 ON CONFLICT(date, word) DO UPDATE SET
                    context_type = excluded.context_type,
                    frequency = excluded.frequency,
                    updated_at = excluded.updated_at",
                params![date, word, context_type, frequency, now, now],
            )?;
        }

        tx.commit()?;

        info!("Stored {} vocabulary items for date {}", word_count, date);
        Ok(())
    }

    /// Get daily vocabulary for a specific date
    pub fn get_daily_vocabulary(&self, date: &str) -> Result<Vec<DailyVocabularyItem>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, date, word, context_type, frequency, source, created_at, updated_at
             FROM daily_vocabulary
             WHERE date = ?1
             ORDER BY frequency DESC, word ASC",
        )?;

        let rows = stmt.query_map(params![date], |row| {
            Ok(DailyVocabularyItem {
                id: row.get(0)?,
                date: row.get(1)?,
                word: row.get(2)?,
                context_type: row.get(3)?,
                frequency: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }

        debug!(
            "Retrieved {} vocabulary items for date {}",
            items.len(),
            date
        );
        Ok(items)
    }

    /// Get aggregated vocabulary across all dates
    /// Aggregates frequency per word and keeps the most recently updated context type
    pub fn get_all_vocabulary_aggregated(&self) -> Result<Vec<DailyVocabularyItem>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT
                MIN(id) as id,
                MAX(date) as date,
                word,
                (SELECT context_type FROM daily_vocabulary dv2 WHERE dv2.word = dv.word ORDER BY updated_at DESC LIMIT 1) as context_type,
                SUM(frequency) as frequency,
                (SELECT source FROM daily_vocabulary dv2 WHERE dv2.word = dv.word ORDER BY updated_at DESC LIMIT 1) as source,
                MAX(created_at) as created_at,
                MAX(updated_at) as updated_at
             FROM daily_vocabulary dv
             GROUP BY word
             ORDER BY SUM(frequency) DESC, MAX(updated_at) DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(DailyVocabularyItem {
                id: row.get(0)?,
                date: row.get(1)?,
                word: row.get(2)?,
                context_type: row.get(3)?,
                frequency: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }

        Ok(items)
    }

    /// Get daily vocabulary for a date range
    pub fn get_daily_vocabulary_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailyVocabularyItem>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, date, word, context_type, frequency, source, created_at, updated_at
             FROM daily_vocabulary
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date DESC, frequency DESC",
        )?;

        let rows = stmt.query_map(params![start_date, end_date], |row| {
            Ok(DailyVocabularyItem {
                id: row.get(0)?,
                date: row.get(1)?,
                word: row.get(2)?,
                context_type: row.get(3)?,
                frequency: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }

        Ok(items)
    }

    /// Add a word to daily vocabulary (user action)
    pub fn add_word_to_daily_vocabulary(
        &self,
        date: &str,
        word: &str,
        context_type: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        conn.execute(
            "INSERT INTO daily_vocabulary (date, word, context_type, frequency, source, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, 'user_added', ?4, ?5)
             ON CONFLICT(date, word) DO NOTHING",
            params![date, word, context_type, now, now],
        )?;

        info!(
            "User added word '{}' to daily vocabulary for {}",
            word, date
        );
        Ok(())
    }

    /// Remove a word from daily vocabulary
    pub fn remove_word_from_daily_vocabulary(&self, date: &str, word: &str) -> Result<()> {
        let conn = self.get_connection()?;

        let rows_affected = conn.execute(
            "DELETE FROM daily_vocabulary WHERE date = ?1 AND word = ?2",
            params![date, word],
        )?;

        if rows_affected > 0 {
            info!("Removed word '{}' from daily vocabulary for {}", word, date);
        }

        Ok(())
    }

    /// Remove word across all dates
    pub fn remove_word_from_daily_vocabulary_global(&self, word: &str) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "DELETE FROM daily_vocabulary WHERE word = ?1",
            params![word],
        )?;
        Ok(())
    }

    /// Update word context type
    pub fn update_word_context_type(
        &self,
        date: &str,
        word: &str,
        context_type: &str,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        conn.execute(
            "UPDATE daily_vocabulary SET context_type = ?1, updated_at = ?2
             WHERE date = ?3 AND word = ?4",
            params![context_type, now, date, word],
        )?;

        debug!(
            "Updated context type for '{}' on {} to '{}'",
            word, date, context_type
        );
        Ok(())
    }

    /// Update context type across all dates for a word
    pub fn update_word_context_type_global(&self, word: &str, context_type: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        conn.execute(
            "UPDATE daily_vocabulary SET context_type = ?1, updated_at = ?2
             WHERE word = ?3",
            params![context_type, now, word],
        )?;

        Ok(())
    }

    /// Batch update context types for multiple words
    pub fn batch_update_context_types(
        &self,
        date: &str,
        updates: Vec<(String, String)>, // (word, context_type)
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        let tx = conn.unchecked_transaction()?;

        for (word, context_type) in updates {
            tx.execute(
                "UPDATE daily_vocabulary SET context_type = ?1, updated_at = ?2
                 WHERE date = ?3 AND word = ?4",
                params![context_type, now, date, word],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    // ============================================================================
    // Hotword Promotion
    // ============================================================================

    /// Map context_type from daily vocabulary to HotwordCategory string for the hotwords table.
    /// Falls back to HotwordManager::infer_category for unknown or unclassified types.
    fn map_context_to_category(context_type: Option<&str>, word: &str) -> &'static str {
        match context_type {
            Some("people") => "Person",
            Some("work") => "Brand",
            Some("learning") => "Term",
            _ => {
                // Use HotwordManager's heuristic inference for other/unknown types
                let cat = super::hotword::HotwordManager::infer_category(word);
                match cat {
                    crate::settings::HotwordCategory::Person => "Person",
                    crate::settings::HotwordCategory::Term => "Term",
                    crate::settings::HotwordCategory::Brand => "Brand",
                    crate::settings::HotwordCategory::Abbreviation => "Abbreviation",
                }
            }
        }
    }

    /// Promote a word to hotword library (manual)
    pub fn promote_to_hotword(
        &self,
        word: &str,
        context_type: Option<&str>,
        weight: Option<f64>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // Get statistics from daily vocabulary
        let stats: (i32, i32, String) = conn.query_row(
            "SELECT COUNT(DISTINCT date), SUM(frequency), MIN(date)
             FROM daily_vocabulary
             WHERE word = ?1",
            params![word],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        let (days_count, total_occurrences, promoted_from_date) = stats;
        let _weight = weight.unwrap_or(1.0);

        // Map context_type to the appropriate HotwordCategory
        let category = Self::map_context_to_category(context_type, word);

        // Insert into hotwords table with required fields
        conn.execute(
            "INSERT INTO hotwords (target, originals, category, scenarios,
                                    user_override, use_count, false_positive_count, created_at,
                                    context_type, total_occurrences, days_count,
                                    promotion_type, promoted_at, promoted_from_date)
             VALUES (?1, '[]', ?8, '[\"work\",\"casual\"]', 0, 0, 0, ?2,
                     ?3, ?4, ?5, 'manual', ?6, ?7)
             ON CONFLICT(target) DO UPDATE SET
                category = excluded.category,
                context_type = excluded.context_type,
                total_occurrences = excluded.total_occurrences,
                days_count = excluded.days_count,
                promoted_at = excluded.promoted_at,
                promoted_from_date = excluded.promoted_from_date",
            params![
                word,
                now,
                context_type,
                total_occurrences,
                days_count,
                now,
                promoted_from_date,
                category,
            ],
        )?;

        info!(
            "Manually promoted '{}' to hotword library (category: {}, days: {}, freq: {})",
            word, category, days_count, total_occurrences
        );
        Ok(())
    }

    /// Batch promote multiple words to hotword library
    pub fn batch_promote_to_hotword(
        &self,
        words: Vec<(String, Option<String>, Option<f64>)>, // (word, context_type, weight)
    ) -> Result<Vec<String>> {
        let mut promoted = Vec::new();

        for (word, context_type, weight) in words {
            if let Ok(()) = self.promote_to_hotword(&word, context_type.as_deref(), weight) {
                promoted.push(word);
            }
        }

        info!("Batch promoted {} words to hotword library", promoted.len());
        Ok(promoted)
    }

    /// Get all hotwords with metadata
    pub fn get_hotwords(&self, context_type: Option<&str>) -> Result<Vec<HotwordItem>> {
        let conn = self.get_connection()?;

        let mut items = Vec::new();

        if let Some(ctx) = context_type {
            let mut stmt = conn.prepare(
                "SELECT target, context_type, total_occurrences, days_count,
                        promotion_type, promoted_at, promoted_from_date
                 FROM hotwords
                 WHERE context_type = ?1
                 ORDER BY use_count DESC, total_occurrences DESC",
            )?;

            let rows = stmt.query_map(params![ctx], |row| {
                Ok(HotwordItem {
                    word: row.get(0)?,
                    context_type: row.get(1)?,
                    weight: 1.0,
                    total_occurrences: row.get(2).unwrap_or(0),
                    days_count: row.get(3).unwrap_or(0),
                    promotion_type: row.get(4).unwrap_or_else(|_| "manual".to_string()),
                    promoted_at: row.get(5).ok(),
                    promoted_from_date: row.get(6).ok(),
                })
            })?;

            for row in rows {
                items.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT target, context_type, total_occurrences, days_count,
                        promotion_type, promoted_at, promoted_from_date
                 FROM hotwords
                 ORDER BY use_count DESC, total_occurrences DESC",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok(HotwordItem {
                    word: row.get(0)?,
                    context_type: row.get(1)?,
                    weight: 1.0,
                    total_occurrences: row.get(2).unwrap_or(0),
                    days_count: row.get(3).unwrap_or(0),
                    promotion_type: row.get(4).unwrap_or_else(|_| "manual".to_string()),
                    promoted_at: row.get(5).ok(),
                    promoted_from_date: row.get(6).ok(),
                })
            })?;

            for row in rows {
                items.push(row?);
            }
        }

        Ok(items)
    }

    /// Remove a word from hotword library
    pub fn remove_from_hotword(&self, word: &str) -> Result<()> {
        let conn = self.get_connection()?;

        let rows_affected =
            conn.execute("DELETE FROM hotwords WHERE target = ?1", params![word])?;

        if rows_affected > 0 {
            info!("Removed '{}' from hotword library", word);
        }

        Ok(())
    }

    /// Update hotword metadata
    pub fn update_hotword_metadata(
        &self,
        word: &str,
        context_type: Option<&str>,
        _weight: Option<f64>,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        if let Some(ctx) = context_type {
            conn.execute(
                "UPDATE hotwords SET context_type = ?1 WHERE target = ?2",
                params![ctx, word],
            )?;
        }

        // Note: weight is not used in hotwords table structure
        // The use_count field serves as the importance metric

        Ok(())
    }

    // ============================================================================
    // Statistics & Utilities
    // ============================================================================

    /// Get vocabulary statistics by context type
    pub fn get_vocabulary_stats(&self) -> Result<HashMap<String, i32>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT COALESCE(context_type, 'unknown') as ctx, COUNT(*) as count
             FROM hotwords
             GROUP BY ctx",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })?;

        let mut stats = HashMap::new();
        for row in rows {
            let (ctx, count) = row?;
            stats.insert(ctx, count);
        }

        Ok(stats)
    }

    /// Get daily vocabulary stats by context type for a date
    pub fn get_daily_stats(&self, date: &str) -> Result<HashMap<String, i32>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT COALESCE(context_type, 'unknown') as ctx, COUNT(*) as count
             FROM daily_vocabulary
             WHERE date = ?1
             GROUP BY ctx",
        )?;

        let rows = stmt.query_map(params![date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })?;

        let mut stats = HashMap::new();
        for row in rows {
            let (ctx, count) = row?;
            stats.insert(ctx, count);
        }

        Ok(stats)
    }

    /// Clean up old daily vocabulary (optional maintenance)
    #[allow(dead_code)]
    pub fn cleanup_old_daily_vocabulary(&self, days_to_keep: i32) -> Result<usize> {
        let conn = self.get_connection()?;
        let cutoff_date =
            chrono::Local::now().naive_local().date() - chrono::Duration::days(days_to_keep as i64);
        let cutoff_str = cutoff_date.format("%Y-%m-%d").to_string();

        let rows_deleted = conn.execute(
            "DELETE FROM daily_vocabulary WHERE date < ?1",
            params![cutoff_str],
        )?;

        info!(
            "Cleaned up {} old daily vocabulary entries (before {})",
            rows_deleted, cutoff_str
        );
        Ok(rows_deleted)
    }
}
