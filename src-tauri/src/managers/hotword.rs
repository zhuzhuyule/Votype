//! Hotword Manager
//!
//! Manages hotwords (vocabulary entries) with CRUD operations, category inference,
//! and LLM injection text generation for improving transcription accuracy.

use anyhow::Result;
use chrono::Utc;
use log::{debug, info};
use rusqlite::{params, Connection};
use std::path::PathBuf;

use crate::settings::{Hotword, HotwordCategory, HotwordScenario};

/// Technical term suffixes for category inference
const TECHNICAL_SUFFIXES: &[&str] = &[
    "-js",
    "-ts",
    "-api",
    "Config",
    "Manager",
    "Service",
    "Handler",
    "Controller",
    "Provider",
];

/// Manages hotword vocabulary for transcription enhancement
pub struct HotwordManager {
    db_path: PathBuf,
}

impl HotwordManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        Ok(conn)
    }

    /// Infer the category of a hotword based on its target form.
    ///
    /// Heuristics:
    /// - All uppercase 2-5 chars -> Abbreviation
    /// - Technical suffixes (-js, -ts, Config, Manager, etc.) -> Term
    /// - Single capitalized word -> Person
    /// - Default -> Term
    pub fn infer_category(target: &str) -> HotwordCategory {
        let trimmed = target.trim();

        // Check for abbreviations (all uppercase, 2-5 characters)
        if trimmed.len() >= 2
            && trimmed.len() <= 5
            && trimmed.chars().all(|c| c.is_ascii_uppercase())
        {
            return HotwordCategory::Abbreviation;
        }

        // Check for technical terms with known suffixes
        let lower = trimmed.to_lowercase();
        for suffix in TECHNICAL_SUFFIXES {
            let suffix_lower = suffix.to_lowercase();
            if lower.ends_with(&suffix_lower) || lower.contains(&suffix_lower) {
                return HotwordCategory::Term;
            }
        }

        // Check for single capitalized word (potential person name)
        // Must be a single word, start with uppercase, rest lowercase
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        if words.len() == 1 {
            let word = words[0];
            let chars: Vec<char> = word.chars().collect();
            if chars.len() >= 2
                && chars[0].is_uppercase()
                && chars[1..]
                    .iter()
                    .all(|c| c.is_lowercase() || !c.is_alphabetic())
            {
                return HotwordCategory::Person;
            }
        }

        HotwordCategory::Term
    }

    /// Map a database row to a Hotword struct
    fn row_to_hotword(row: &rusqlite::Row) -> rusqlite::Result<Hotword> {
        let originals_json: String = row.get("originals")?;
        let category_str: String = row.get("category")?;
        let scenarios_json: String = row.get("scenarios")?;
        let status: String = row.get("status").unwrap_or_else(|_| "active".to_string());
        let source: String = row.get("source").unwrap_or_else(|_| "manual".to_string());

        Ok(Hotword {
            id: row.get("id")?,
            target: row.get("target")?,
            originals: serde_json::from_str(&originals_json).unwrap_or_default(),
            category: serde_json::from_str(&format!("\"{}\"", category_str)).unwrap_or_default(),
            scenarios: serde_json::from_str(&scenarios_json).unwrap_or_default(),
            user_override: row.get("user_override")?,
            use_count: row.get("use_count")?,
            last_used_at: row.get("last_used_at")?,
            false_positive_count: row.get("false_positive_count")?,
            created_at: row.get("created_at")?,
            status,
            source,
        })
    }

    /// Get all hotwords from the database (both active and suggested)
    pub fn get_all(&self) -> Result<Vec<Hotword>> {
        let conn = self.get_connection()?;

        let mut stmt = conn.prepare(
            "SELECT id, target, originals, category, scenarios,
                    user_override, use_count, last_used_at, false_positive_count, created_at, status, source
             FROM hotwords
             ORDER BY use_count DESC, created_at DESC",
        )?;

        let rows = stmt.query_map([], Self::row_to_hotword)?;

        let mut hotwords = Vec::new();
        for row in rows {
            hotwords.push(row?);
        }

        debug!("[Hotword] Retrieved {} hotwords", hotwords.len());
        Ok(hotwords)
    }

    /// Get hotwords filtered by scenario
    pub fn get_by_scenario(&self, scenario: HotwordScenario) -> Result<Vec<Hotword>> {
        let all = self.get_all()?;
        let filtered: Vec<Hotword> = all
            .into_iter()
            .filter(|h| h.scenarios.contains(&scenario))
            .collect();

        debug!(
            "[Hotword] Retrieved {} hotwords for scenario {:?}",
            filtered.len(),
            scenario
        );
        Ok(filtered)
    }

    /// Add a new hotword
    pub fn add(
        &self,
        target: String,
        originals: Vec<String>,
        category: Option<HotwordCategory>,
        scenarios: Option<Vec<HotwordScenario>>,
    ) -> Result<Hotword> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // Infer category if not provided
        let inferred_category = Self::infer_category(&target);
        let final_category = category.unwrap_or(inferred_category);
        let user_override = category.is_some();

        // Default to both scenarios if not specified
        let final_scenarios =
            scenarios.unwrap_or_else(|| vec![HotwordScenario::Work, HotwordScenario::Casual]);

        let originals_json = serde_json::to_string(&originals)?;
        let category_str = serde_json::to_string(&final_category)?;
        // Remove quotes from category string for storage
        let category_str = category_str.trim_matches('"');
        let scenarios_json = serde_json::to_string(&final_scenarios)?;

        conn.execute(
            "INSERT INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, 'active', 'manual')",
            params![
                target,
                originals_json,
                category_str,
                scenarios_json,
                user_override,
                now
            ],
        )?;

        let id = conn.last_insert_rowid();

        info!(
            "[Hotword] Added hotword: {} (category={:?})",
            target, final_category
        );

        Ok(Hotword {
            id,
            target,
            originals,
            category: final_category,
            scenarios: final_scenarios,
            user_override,
            use_count: 0,
            last_used_at: None,
            false_positive_count: 0,
            created_at: now,
            status: "active".to_string(),
            source: "manual".to_string(),
        })
    }

    /// Update an existing hotword
    pub fn update(
        &self,
        id: i64,
        target: Option<String>,
        originals: Vec<String>,
        category: HotwordCategory,
        scenarios: Vec<HotwordScenario>,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        let originals_json = serde_json::to_string(&originals)?;
        let category_str = serde_json::to_string(&category)?;
        let category_str = category_str.trim_matches('"');
        let scenarios_json = serde_json::to_string(&scenarios)?;

        if let Some(ref new_target) = target {
            conn.execute(
                "UPDATE hotwords
                 SET target = ?1, originals = ?2, category = ?3, scenarios = ?4, user_override = 1
                 WHERE id = ?5",
                params![new_target, originals_json, category_str, scenarios_json, id],
            )?;
        } else {
            conn.execute(
                "UPDATE hotwords
                 SET originals = ?1, category = ?2, scenarios = ?3, user_override = 1
                 WHERE id = ?4",
                params![originals_json, category_str, scenarios_json, id],
            )?;
        }

        info!("[Hotword] Updated hotword id={}", id);
        Ok(())
    }

    /// Delete a hotword by ID
    pub fn delete(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM hotwords WHERE id = ?1", params![id])?;
        info!("[Hotword] Deleted hotword id={}", id);
        Ok(())
    }

    /// Increment use count for a hotword
    #[allow(dead_code)]
    pub fn increment_use(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        conn.execute(
            "UPDATE hotwords SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        debug!("[Hotword] Incremented use count for hotword id={}", id);
        Ok(())
    }

    /// Increment false positive count for a hotword
    pub fn increment_false_positive(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE hotwords SET false_positive_count = false_positive_count + 1 WHERE id = ?1",
            params![id],
        )?;

        debug!(
            "[Hotword] Incremented false positive count for hotword id={}",
            id
        );
        Ok(())
    }

    /// Build LLM injection text for a specific scenario.
    /// Groups hotwords by category and formats them for inclusion in prompts.
    ///
    /// Returns formatted text like:
    /// ```
    /// 【人名】
    /// - 张三
    /// - 李四
    ///
    /// 【专业术语】
    /// - Kubernetes
    /// - Docker
    ///
    /// 【缩写】
    /// - API -> Application Programming Interface
    /// - SDK -> Software Development Kit
    ///
    /// 【判断规则】
    /// - 仅在语境合适时使用上述词汇
    /// - 如不确定，保留原始转写
    /// ```
    pub fn build_llm_injection(&self, scenario: HotwordScenario, limit: usize) -> Result<String> {
        let hotwords = self.get_by_scenario(scenario)?;
        // Only inject confirmed (active) hotwords
        let hotwords: Vec<Hotword> = hotwords
            .into_iter()
            .filter(|h| h.status == "active")
            .collect();

        if hotwords.is_empty() {
            return Ok(String::new());
        }

        // Take top N by use_count (already sorted)
        let hotwords: Vec<&Hotword> = hotwords.iter().take(limit).collect();

        // Group by category
        let mut persons: Vec<&Hotword> = Vec::new();
        let mut terms: Vec<&Hotword> = Vec::new();
        let mut brands: Vec<&Hotword> = Vec::new();
        let mut abbreviations: Vec<&Hotword> = Vec::new();

        for h in hotwords {
            match h.category {
                HotwordCategory::Person => persons.push(h),
                HotwordCategory::Term => terms.push(h),
                HotwordCategory::Brand => brands.push(h),
                HotwordCategory::Abbreviation => abbreviations.push(h),
            }
        }

        let mut output = String::new();

        // Format each category
        if !persons.is_empty() {
            output.push_str("【人名】\n");
            for h in &persons {
                if h.originals.is_empty() {
                    output.push_str(&format!("- {}\n", h.target));
                } else {
                    output.push_str(&format!("- {} ({})\n", h.target, h.originals.join(", ")));
                }
            }
            output.push('\n');
        }

        if !terms.is_empty() {
            output.push_str("【专业术语】\n");
            for h in &terms {
                if h.originals.is_empty() {
                    output.push_str(&format!("- {}\n", h.target));
                } else {
                    output.push_str(&format!("- {} ({})\n", h.target, h.originals.join(", ")));
                }
            }
            output.push('\n');
        }

        if !brands.is_empty() {
            output.push_str("【品牌/产品】\n");
            for h in &brands {
                if h.originals.is_empty() {
                    output.push_str(&format!("- {}\n", h.target));
                } else {
                    output.push_str(&format!("- {} ({})\n", h.target, h.originals.join(", ")));
                }
            }
            output.push('\n');
        }

        if !abbreviations.is_empty() {
            output.push_str("【缩写】\n");
            for h in &abbreviations {
                if h.originals.is_empty() {
                    output.push_str(&format!("- {}\n", h.target));
                } else {
                    output.push_str(&format!("- {} ({})\n", h.target, h.originals.join(", ")));
                }
            }
            output.push('\n');
        }

        // Add judgment rules
        output.push_str("【判断规则】\n");
        output.push_str("- 括号内为常见误识别形式，遇到时请替换为正确词汇\n");
        output.push_str("- 仅在语境合适时使用上述词汇\n");
        output.push_str("- 如不确定，保留原始转写\n");

        debug!(
            "[Hotword] Built LLM injection for scenario {:?}: {} chars",
            scenario,
            output.len()
        );

        Ok(output)
    }

    /// Record an auto-learned hotword from user edit corrections.
    /// If the target already exists, merges the original into its originals array.
    /// If not, creates a new hotword with source='auto_learned'.
    pub fn record_auto_learned(&self, target: &str, original: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // Check if hotword with same target already exists (case-insensitive)
        let existing: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, originals FROM hotwords WHERE LOWER(target) = LOWER(?1)",
                params![target],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((id, originals_json)) = existing {
            // Merge original into existing originals
            let mut originals: Vec<String> =
                serde_json::from_str(&originals_json).unwrap_or_default();
            if !originals.iter().any(|o| o.eq_ignore_ascii_case(original)) {
                originals.push(original.to_string());
                let merged_json = serde_json::to_string(&originals)?;
                conn.execute(
                    "UPDATE hotwords SET originals = ?1, use_count = use_count + 1, last_used_at = ?2 WHERE id = ?3",
                    params![merged_json, now, id],
                )?;
                info!(
                    "[Hotword] Auto-learned: merged \"{}\" into existing hotword \"{}\" (id={})",
                    original, target, id
                );
            } else {
                // Original already exists, just increment use_count
                conn.execute(
                    "UPDATE hotwords SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
                    params![now, id],
                )?;
                debug!(
                    "[Hotword] Auto-learned: \"{}\" already in hotword \"{}\", incremented use_count",
                    original, target
                );
            }
        } else {
            // Create new hotword
            let inferred_category = Self::infer_category(target);
            let category_str = serde_json::to_string(&inferred_category)?;
            let category_str = category_str.trim_matches('"');
            let originals_json = serde_json::to_string(&vec![original])?;

            conn.execute(
                "INSERT INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
                 VALUES (?1, ?2, ?3, '[\"work\",\"casual\"]', 0, 1, 0, ?4, 'active', 'auto_learned')",
                params![target, originals_json, category_str, now],
            )?;

            info!(
                "[Hotword] Auto-learned: new hotword \"{}\" from correction \"{}\" (category={:?})",
                target, original, inferred_category
            );
        }

        Ok(())
    }

    /// Add AI-suggested hotwords in batch. Uses ON CONFLICT to avoid overwriting existing active hotwords.
    pub fn add_suggested(
        &self,
        items: Vec<(String, Vec<String>, HotwordCategory)>,
    ) -> Result<Vec<Hotword>> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        let mut added = Vec::new();

        for (target, originals, category) in items {
            let originals_json = serde_json::to_string(&originals)?;
            let category_str = serde_json::to_string(&category)?;
            let category_str = category_str.trim_matches('"');
            let scenarios_json = "[\"work\",\"casual\"]";

            let result = conn.execute(
                "INSERT OR IGNORE INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
                 VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, 'suggested', 'ai_extracted')",
                params![
                    target,
                    originals_json,
                    category_str,
                    scenarios_json,
                    now
                ],
            )?;

            if result > 0 {
                let id = conn.last_insert_rowid();
                added.push(Hotword {
                    id,
                    target,
                    originals,
                    category,
                    scenarios: vec![HotwordScenario::Work, HotwordScenario::Casual],
                    user_override: false,
                    use_count: 0,
                    last_used_at: None,
                    false_positive_count: 0,
                    created_at: now,
                    status: "suggested".to_string(),
                    source: "ai_extracted".to_string(),
                });
            }
        }

        info!(
            "[Hotword] Added {} suggested hotwords (batch of {})",
            added.len(),
            added.len()
        );
        Ok(added)
    }

    /// Get all suggested hotwords
    pub fn get_suggestions(&self) -> Result<Vec<Hotword>> {
        let conn = self.get_connection()?;

        let mut stmt = conn.prepare(
            "SELECT id, target, originals, category, scenarios,
                    user_override, use_count, last_used_at, false_positive_count, created_at, status, source
             FROM hotwords
             WHERE status = 'suggested'
             ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], Self::row_to_hotword)?;

        let mut hotwords = Vec::new();
        for row in rows {
            hotwords.push(row?);
        }

        debug!("[Hotword] Retrieved {} suggestions", hotwords.len());
        Ok(hotwords)
    }

    /// Accept a suggestion: change status from 'suggested' to 'active'
    pub fn accept_suggestion(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE hotwords SET status = 'active' WHERE id = ?1 AND status = 'suggested'",
            params![id],
        )?;
        info!("[Hotword] Accepted suggestion id={}", id);
        Ok(())
    }

    /// Dismiss a suggestion: delete the suggested hotword
    pub fn dismiss_suggestion(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "DELETE FROM hotwords WHERE id = ?1 AND status = 'suggested'",
            params![id],
        )?;
        info!("[Hotword] Dismissed suggestion id={}", id);
        Ok(())
    }

    /// Accept all suggestions: batch change status to 'active'
    pub fn accept_all_suggestions(&self) -> Result<u64> {
        let conn = self.get_connection()?;
        let count = conn.execute(
            "UPDATE hotwords SET status = 'active' WHERE status = 'suggested'",
            [],
        )?;
        info!("[Hotword] Accepted all {} suggestions", count);
        Ok(count as u64)
    }

    /// Dismiss all suggestions: batch delete
    pub fn dismiss_all_suggestions(&self) -> Result<u64> {
        let conn = self.get_connection()?;
        let count = conn.execute("DELETE FROM hotwords WHERE status = 'suggested'", [])?;
        info!("[Hotword] Dismissed all {} suggestions", count);
        Ok(count as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_category_abbreviation() {
        // All uppercase 2-5 chars should be abbreviations
        assert_eq!(
            HotwordManager::infer_category("API"),
            HotwordCategory::Abbreviation
        );
        assert_eq!(
            HotwordManager::infer_category("SDK"),
            HotwordCategory::Abbreviation
        );
        assert_eq!(
            HotwordManager::infer_category("CEO"),
            HotwordCategory::Abbreviation
        );
        assert_eq!(
            HotwordManager::infer_category("HTTP"),
            HotwordCategory::Abbreviation
        );
        assert_eq!(
            HotwordManager::infer_category("HTTPS"),
            HotwordCategory::Abbreviation
        );
    }

    #[test]
    fn test_infer_category_abbreviation_too_long() {
        // More than 5 chars should not be abbreviations
        let category = HotwordManager::infer_category("ABCDEF");
        assert_ne!(category, HotwordCategory::Abbreviation);
    }

    #[test]
    fn test_infer_category_abbreviation_too_short() {
        // Less than 2 chars should not be abbreviations
        let category = HotwordManager::infer_category("A");
        assert_ne!(category, HotwordCategory::Abbreviation);
    }

    #[test]
    fn test_infer_category_technical_terms() {
        // Technical suffixes should be Term
        assert_eq!(
            HotwordManager::infer_category("UserConfig"),
            HotwordCategory::Term
        );
        assert_eq!(
            HotwordManager::infer_category("TaskManager"),
            HotwordCategory::Term
        );
        assert_eq!(
            HotwordManager::infer_category("AuthService"),
            HotwordCategory::Term
        );
        assert_eq!(
            HotwordManager::infer_category("EventHandler"),
            HotwordCategory::Term
        );
        assert_eq!(
            HotwordManager::infer_category("AppController"),
            HotwordCategory::Term
        );
        assert_eq!(
            HotwordManager::infer_category("DataProvider"),
            HotwordCategory::Term
        );
    }

    #[test]
    fn test_infer_category_person() {
        // Single capitalized word should be Person
        assert_eq!(
            HotwordManager::infer_category("John"),
            HotwordCategory::Person
        );
        assert_eq!(
            HotwordManager::infer_category("Alice"),
            HotwordCategory::Person
        );
    }

    #[test]
    fn test_infer_category_default() {
        // Random words should default to Term
        assert_eq!(
            HotwordManager::infer_category("kubernetes"),
            HotwordCategory::Term
        );
        assert_eq!(
            HotwordManager::infer_category("docker"),
            HotwordCategory::Term
        );
    }

    #[test]
    fn test_infer_category_mixed_case_not_abbreviation() {
        // Mixed case should not be abbreviation
        let category = HotwordManager::infer_category("Api");
        assert_ne!(category, HotwordCategory::Abbreviation);
    }
}
