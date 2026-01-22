//! Vocabulary Correction Manager
//!
//! Tracks vocabulary corrections made by users when editing history entries.
//! These corrections are used to improve future transcriptions by injecting
//! correction hints into LLM prompts.

use anyhow::Result;
use chrono::Utc;
use log::info;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use std::path::PathBuf;

/// Maximum number of tokens in a single change block to be considered a vocabulary correction
/// Changes larger than this are treated as semantic modifications and ignored
const MAX_CORRECTION_TOKENS: usize = 5;

/// Represents a single vocabulary correction record
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VocabularyCorrection {
    pub id: i64,
    pub original_text: String,
    pub corrected_text: String,
    pub app_name: Option<String>,
    pub correction_count: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub is_global: bool,
    pub target_apps: Option<String>,
}

/// Represents a detected word difference between original and edited text
#[derive(Clone, Debug, PartialEq)]
pub struct WordDiff {
    pub original: String,
    pub corrected: String,
}

/// Manages vocabulary corrections for improving transcription accuracy
pub struct VocabularyManager {
    db_path: PathBuf,
}

impl VocabularyManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Analyze edit differences between original and edited text
    /// Returns a list of small vocabulary corrections (≤5 tokens per change block)
    ///
    /// Algorithm:
    /// 1. Tokenize both strings into words (English) and characters (Chinese)
    /// 2. Use token-level diff to find changes, ensuring word boundaries are respected
    /// 3. Group contiguous Delete+Insert operations into change blocks
    /// 4. Keep only blocks with ≤5 tokens as vocabulary corrections
    pub fn analyze_edit_diff(original: &str, edited: &str) -> Vec<WordDiff> {
        if original == edited || original.is_empty() || edited.is_empty() {
            return Vec::new();
        }

        let original_tokens = Self::tokenize(original);
        let edited_tokens = Self::tokenize(edited);

        let ot: Vec<&str> = original_tokens.iter().map(|s| s.as_str()).collect();
        let et: Vec<&str> = edited_tokens.iter().map(|s| s.as_str()).collect();

        let diff = TextDiff::from_slices(&ot, &et);
        let mut diffs = Vec::new();

        // Track current change block
        let mut current_delete = String::new();
        let mut current_insert = String::new();

        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Delete => {
                    current_delete.push_str(change.value());
                }
                ChangeTag::Insert => {
                    current_insert.push_str(change.value());
                }
                ChangeTag::Equal => {
                    // When we hit an equal segment, finalize any pending change block
                    if !current_delete.is_empty() || !current_insert.is_empty() {
                        if let Some(diff) =
                            Self::finalize_change_block(&current_delete, &current_insert)
                        {
                            diffs.push(diff);
                        }
                        current_delete.clear();
                        current_insert.clear();
                    }
                }
            }
        }

        // Handle any remaining change block at the end
        if !current_delete.is_empty() || !current_insert.is_empty() {
            if let Some(diff) = Self::finalize_change_block(&current_delete, &current_insert) {
                diffs.push(diff);
            }
        }

        diffs
    }

    /// Tokenize text into units for diffing
    /// - Sequences of alphanumeric characters form tokens (English words/numbers)
    /// - Individual Chinese characters form tokens
    /// - Other individual characters (spaces, punctuation) form tokens
    fn tokenize(text: &str) -> Vec<String> {
        let mut tokens = Vec::new();
        let mut current_word = String::new();

        for c in text.chars() {
            let is_cjk = matches!(c,
                '\u{4E00}'..='\u{9FFF}' |  // CJK Unified Ideographs
                '\u{3400}'..='\u{4DBF}' |  // CJK Unified Ideographs Extension A
                '\u{3000}'..='\u{303F}' |  // CJK Symbols and Punctuation
                '\u{FF00}'..='\u{FFEF}'    // Fullwidth forms
            );

            if is_cjk {
                if !current_word.is_empty() {
                    tokens.push(current_word.clone());
                    current_word.clear();
                }
                tokens.push(c.to_string());
            } else if c.is_alphanumeric() {
                current_word.push(c);
            } else {
                // Whitespace, punctuation, etc.
                if !current_word.is_empty() {
                    tokens.push(current_word.clone());
                    current_word.clear();
                }
                tokens.push(c.to_string());
            }
        }

        if !current_word.is_empty() {
            tokens.push(current_word);
        }

        tokens
    }

    /// Finalize a change block and determine if it qualifies as a vocabulary correction
    fn finalize_change_block(deleted: &str, inserted: &str) -> Option<WordDiff> {
        let deleted = deleted.trim();
        let inserted = inserted.trim();

        // Skip if both are empty or identical
        if deleted.is_empty() && inserted.is_empty() {
            return None;
        }
        if deleted == inserted {
            return None;
        }

        // Count tokens in the larger of the two
        let delete_tokens = Self::count_tokens(deleted);
        let insert_tokens = Self::count_tokens(inserted);
        let max_tokens = delete_tokens.max(insert_tokens);

        // Only keep small changes as vocabulary corrections
        if max_tokens <= MAX_CORRECTION_TOKENS && max_tokens > 0 {
            info!(
                "[Vocabulary] Small correction detected: \"{}\" → \"{}\" ({} tokens)",
                deleted, inserted, max_tokens
            );
            Some(WordDiff {
                original: deleted.to_string(),
                corrected: inserted.to_string(),
            })
        } else {
            info!(
                "[Vocabulary] Skipping semantic/large change ({} tokens): \"{}\" → \"{}\"",
                max_tokens,
                deleted.chars().take(20).collect::<String>(),
                inserted.chars().take(20).collect::<String>()
            );
            None
        }
    }

    /// Count tokens in text
    /// Chinese: count by characters
    /// English/other: count by whitespace-separated words
    fn count_tokens(text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }

        // Check if text contains CJK characters
        let has_cjk = text.chars().any(|c| {
            matches!(c,
                '\u{4E00}'..='\u{9FFF}' |  // CJK Unified Ideographs
                '\u{3400}'..='\u{4DBF}' |  // CJK Unified Ideographs Extension A
                '\u{3000}'..='\u{303F}'    // CJK Symbols and Punctuation
            )
        });

        if has_cjk {
            // For CJK text, count characters (excluding spaces and punctuation)
            text.chars()
                .filter(|c| {
                    !c.is_whitespace()
                        && !matches!(
                            c,
                            '，' | '。'
                                | '！'
                                | '？'
                                | '、'
                                | '；'
                                | '：'
                                | '\u{201C}'
                                | '\u{201D}'
                                | '\u{2018}'
                                | '\u{2019}'
                                | '（'
                                | '）'
                        )
                })
                .count()
        } else {
            // For non-CJK text, count words by whitespace
            text.split_whitespace().count()
        }
    }

    /// Record a vocabulary correction to the database
    /// If the same correction already exists, increment its count
    pub fn record_correction(&self, diff: &WordDiff, app_name: Option<&str>) -> Result<()> {
        if diff.original.is_empty() && diff.corrected.is_empty() {
            return Ok(());
        }

        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // Try to update existing record first
        let updated = conn.execute(
            "UPDATE vocabulary_corrections 
             SET correction_count = correction_count + 1, last_seen_at = ?1
             WHERE original_text = ?2 AND corrected_text = ?3 AND app_name IS ?4",
            params![now, diff.original, diff.corrected, app_name],
        )?;

        if updated == 0 {
            // Insert new record
            conn.execute(
                "INSERT INTO vocabulary_corrections (original_text, corrected_text, app_name, correction_count, first_seen_at, last_seen_at, is_global)
                 VALUES (?1, ?2, ?3, 1, ?4, ?4, 0)",
                params![diff.original, diff.corrected, app_name, now],
            )?;
            info!(
                "[Vocabulary] New correction recorded: \"{}\" → \"{}\" (app: {:?})",
                diff.original, diff.corrected, app_name
            );
        } else {
            info!(
            "[Vocabulary] Correction count incremented: \"{}\" → \"{}\" (app: {:?})",
            diff.original, diff.corrected, app_name
        );
        }

        Ok(())
    }

    /// Get corrections applicable for the given app
    /// Returns both app-specific corrections and global corrections
    /// Ordered by correction_count (most common first)
    pub fn get_corrections_for_app(
        &self,
        app_name: Option<&str>,
    ) -> Result<Vec<VocabularyCorrection>> {
        let conn = self.get_connection()?;

        let mut stmt = conn.prepare(
            "SELECT id, original_text, corrected_text, app_name, correction_count, 
                    first_seen_at, last_seen_at, is_global, target_apps
             FROM vocabulary_corrections
             ORDER BY correction_count DESC, last_seen_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(VocabularyCorrection {
                id: row.get("id")?,
                original_text: row.get("original_text")?,
                corrected_text: row.get("corrected_text")?,
                app_name: row.get("app_name")?,
                correction_count: row.get("correction_count")?,
                first_seen_at: row.get("first_seen_at")?,
                last_seen_at: row.get("last_seen_at")?,
                is_global: row.get("is_global")?,
                target_apps: row.get("target_apps")?,
            })
        })?;

        let mut corrections = Vec::new();
        for row in rows {
            let correction = row?;
            // Filter logic:
            // 1. If global, include it
            // 2. If app_name matches source app (legacy behavior), include it
            // 3. If target_apps contains the app, include it
            let should_include = correction.is_global
                || (app_name.is_some() && correction.app_name.as_deref() == app_name)
                || (app_name.is_some() && correction.target_apps.as_ref().map_or(false, |apps| {
                    // Simple text check for now, can be upgraded to proper JSON parsing if needed
                    // Using format!("\"{}\"", name) to match JSON string elements roughly
                    apps.contains(&format!("\"{}\"", app_name.unwrap_or("")))
                }));
            
            if should_include {
                corrections.push(correction);
            }
        }

        Ok(corrections)
    }

    /// Get all corrections (for management UI)
    pub fn get_all_corrections(&self) -> Result<Vec<VocabularyCorrection>> {
        let conn = self.get_connection()?;

        let mut stmt = conn.prepare(
            "SELECT id, original_text, corrected_text, app_name, correction_count, 
                    first_seen_at, last_seen_at, is_global, target_apps
             FROM vocabulary_corrections
             ORDER BY last_seen_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(VocabularyCorrection {
                id: row.get("id")?,
                original_text: row.get("original_text")?,
                corrected_text: row.get("corrected_text")?,
                app_name: row.get("app_name")?,
                correction_count: row.get("correction_count")?,
                first_seen_at: row.get("first_seen_at")?,
                last_seen_at: row.get("last_seen_at")?,
                is_global: row.get("is_global")?,
                target_apps: row.get("target_apps")?,
            })
        })?;

        let mut corrections = Vec::new();
        for row in rows {
            corrections.push(row?);
        }

        Ok(corrections)
    }

    /// Delete a correction by ID
    pub fn delete_correction(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM vocabulary_corrections WHERE id = ?1", params![id])?;
        info!("[Vocabulary] Deleted correction id={}", id);
        Ok(())
    }

    /// Set the scope for a correction
    /// is_global: true if it applies everywhere
    /// target_apps: JSON array of app names if it applies to specific apps (only used if is_global is false)
    pub fn update_scope(&self, id: i64, is_global: bool, target_apps: Option<String>) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE vocabulary_corrections SET is_global = ?1, target_apps = ?2 WHERE id = ?3",
            params![is_global, target_apps, id],
        )?;
        info!(
            "[Vocabulary] Updated scope for correction id={}: global={}, apps={:?}",
            id, is_global, target_apps
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analyze_single_word_change() {
        let original = "hello wrold";
        let edited = "hello world";
        let diffs = VocabularyManager::analyze_edit_diff(original, edited);

        // Token-level diff should capture the whole word
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].original, "wrold");
        assert_eq!(diffs[0].corrected, "world");
    }

    #[test]
    fn test_analyze_fragmentation_prevention() {
        let original = "I like aple pie";
        let edited = "I like apple pie";
        let diffs = VocabularyManager::analyze_edit_diff(original, edited);

        // Should not split "aple" into chars, should keep the token
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].original, "aple");
        assert_eq!(diffs[0].corrected, "apple");
    }

    #[test]
    fn test_analyze_chinese_correction() {
        let original = "我今天去了北京天按门";
        let edited = "我今天去了北京天安门";
        let diffs = VocabularyManager::analyze_edit_diff(original, edited);

        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].original, "按");
        assert_eq!(diffs[0].corrected, "安");
    }

    #[test]
    fn test_analyze_multiple_corrections() {
        let original = "我今天去了北京天按门，还吃了北京烤鸦";
        let edited = "我今天去了北京天安门，还吃了北京烤鸭";
        let diffs = VocabularyManager::analyze_edit_diff(original, edited);

        assert_eq!(diffs.len(), 2);
    }

    #[test]
    fn test_skip_large_changes() {
        let original = "这是一段完全不同的文字内容";
        let edited = "这是另外一个完全重写的句子";
        let diffs = VocabularyManager::analyze_edit_diff(original, edited);

        // Large changes should be skipped
        assert!(
            diffs.iter().all(|d| {
                VocabularyManager::count_tokens(&d.original) <= MAX_CORRECTION_TOKENS
                    && VocabularyManager::count_tokens(&d.corrected) <= MAX_CORRECTION_TOKENS
            }),
            "All diffs should be within token limit"
        );
    }

    #[test]
    fn test_count_tokens_cjk() {
        assert_eq!(VocabularyManager::count_tokens("天安门"), 3);
        assert_eq!(VocabularyManager::count_tokens("天安门，"), 3); // Punctuation excluded
    }

    #[test]
    fn test_count_tokens_english() {
        assert_eq!(VocabularyManager::count_tokens("hello world"), 2);
        assert_eq!(
            VocabularyManager::count_tokens("this is a test sentence"),
            5
        );
    }

    #[test]
    fn test_identical_text() {
        let diffs = VocabularyManager::analyze_edit_diff("hello", "hello");
        assert!(diffs.is_empty());
    }

    #[test]
    fn test_empty_text() {
        let diffs = VocabularyManager::analyze_edit_diff("", "hello");
        assert!(diffs.is_empty());

        let diffs = VocabularyManager::analyze_edit_diff("hello", "");
        assert!(diffs.is_empty());
    }
}
