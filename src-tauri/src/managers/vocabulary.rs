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
    /// scope_hint params are only used if creating a NEW record and no precedent exists.
    pub fn record_correction(
        &self,
        diff: &WordDiff,
        is_global_hint: bool,
        target_apps_hint: Option<String>,
    ) -> Result<()> {
        if diff.original.is_empty() && diff.corrected.is_empty() {
            return Ok(());
        }

        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // 1. Try to inherit scope from existing corrections for the same target word
        // This ensures that "Skill -> SKIIL" and "Skil -> SKIIL" share the same scope settings
        let (existing_is_global, existing_target_apps): (Option<bool>, Option<Option<String>>) =
            conn.query_row(
                "SELECT is_global, target_apps FROM vocabulary_corrections 
                 WHERE corrected_text = ?1 
                 ORDER BY last_seen_at DESC LIMIT 1",
                params![diff.corrected],
                |row| Ok((Some(row.get(0)?), Some(row.get(1)?))),
            )
            .unwrap_or((None, None));

        // Determine scope to use:
        // - If exists in DB, MUST use existing scope (ignore hints)
        // - If new, use hints
        let (final_is_global, final_target_apps) =
            if let (Some(g), Some(t)) = (existing_is_global, existing_target_apps) {
                (g, t)
            } else {
                (is_global_hint, target_apps_hint)
            };

        // 2. Try to update existing record first
        let updated = conn.execute(
            "UPDATE vocabulary_corrections 
             SET correction_count = correction_count + 1, last_seen_at = ?1
             WHERE original_text = ?2 AND corrected_text = ?3",
            params![now, diff.original, diff.corrected],
        )?;

        if updated == 0 {
            // 3. Insert new record with determined scope
            conn.execute(
                "INSERT INTO vocabulary_corrections 
                 (original_text, corrected_text, correction_count, first_seen_at, last_seen_at, is_global, target_apps)
                 VALUES (?1, ?2, 1, ?3, ?3, ?4, ?5)",
                params![diff.original, diff.corrected, now, final_is_global, final_target_apps],
            )?;
            info!(
                "[Vocabulary] New correction recorded: \"{}\" → \"{}\" (global={}, apps={:?})",
                diff.original, diff.corrected, final_is_global, final_target_apps
            );
        } else {
            info!(
                "[Vocabulary] Correction count incremented: \"{}\" → \"{}\"",
                diff.original, diff.corrected
            );
        }

        Ok(())
    }

    /// Get active corrections (ordered by frequency)
    /// Returns corrections that should be applied to transcription
    /// Filtered by active scopes if provided (if None, checking global only is not typically useful, usually we pass scopes)
    pub fn get_active_corrections(
        &self,
        active_scopes: Option<&[String]>,
    ) -> Result<Vec<VocabularyCorrection>> {
        let conn = self.get_connection()?;

        let mut stmt = conn.prepare(
            "SELECT id, original_text, corrected_text, correction_count, 
                    first_seen_at, last_seen_at, is_global, target_apps
             FROM vocabulary_corrections
             ORDER BY correction_count DESC, last_seen_at DESC",
        )?;

        // Reuse the logic to map rows
        let rows = stmt.query_map([], |row| {
            Ok(VocabularyCorrection {
                id: row.get("id")?,
                original_text: row.get("original_text")?,
                corrected_text: row.get("corrected_text")?,
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
            // 2. If active_scopes is provided and matches target_apps json array
            let should_include = correction.is_global || {
                if let Some(scopes) = active_scopes {
                    correction.target_apps.as_ref().map_or(false, |apps_json| {
                        if let Ok(targets) = serde_json::from_str::<Vec<String>>(apps_json) {
                            targets.iter().any(|t| scopes.contains(t))
                        } else {
                            false
                        }
                    })
                } else {
                    false
                }
            };

            if should_include {
                corrections.push(correction);
            }
        }

        Ok(corrections)
    }

    /// Get all corrections (for management UI)
    pub fn get_all_corrections(&self) -> Result<Vec<VocabularyCorrection>> {
        self.get_active_corrections(None).map(|mut list| {
            // Re-fetch everything because get_active_corrections filters.
            // Actually simpler to just run query again or make get_active_corrections return all if scopes is None?
            // Implementation logic in get_active_corrections returns NONE if scopes is None and not global.
            // Let's copy the query logic for get_all_corrections to be safe and clear.

            let conn_res = self.get_connection();
            if conn_res.is_err() {
                return Vec::new();
            }
            let conn = conn_res.unwrap();

            let mut stmt = conn
                .prepare(
                    "SELECT id, original_text, corrected_text, correction_count, 
                first_seen_at, last_seen_at, is_global, target_apps
                FROM vocabulary_corrections
                ORDER BY last_seen_at DESC",
                )
                .unwrap();

            let rows = stmt
                .query_map([], |row| {
                    Ok(VocabularyCorrection {
                        id: row.get("id")?,
                        original_text: row.get("original_text")?,
                        corrected_text: row.get("corrected_text")?,
                        correction_count: row.get("correction_count")?,
                        first_seen_at: row.get("first_seen_at")?,
                        last_seen_at: row.get("last_seen_at")?,
                        is_global: row.get("is_global")?,
                        target_apps: row.get("target_apps")?,
                    })
                })
                .unwrap();

            let mut all = Vec::new();
            for r in rows {
                all.push(r.unwrap());
            }
            all
        })
    }

    /// Update scope for ALL corrections that share the same target word
    pub fn update_scope_by_target(
        &self,
        corrected_text: &str,
        is_global: bool,
        target_apps: Option<String>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        // Update all records with the same corrected_text (case-insensitive)
        let updated = conn.execute(
            "UPDATE vocabulary_corrections 
             SET is_global = ?1, target_apps = ?2 
             WHERE LOWER(corrected_text) = LOWER(?3)",
            params![is_global, target_apps, corrected_text],
        )?;

        info!(
            "[Vocabulary] Updated scope for {} corrections targeting \"{}\": global={}, apps={:?}",
            updated, corrected_text, is_global, target_apps
        );
        Ok(())
    }

    /// Delete a correction by ID
    pub fn delete_correction(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "DELETE FROM vocabulary_corrections WHERE id = ?1",
            params![id],
        )?;
        info!("[Vocabulary] Deleted correction id={}", id);
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
