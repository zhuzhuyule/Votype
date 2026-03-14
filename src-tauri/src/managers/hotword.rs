//! Hotword Manager
//!
//! Manages hotwords (vocabulary entries) with CRUD operations, category inference,
//! and LLM injection text generation for improving transcription accuracy.

use anyhow::Result;
use chrono::Utc;
use log::{debug, error, info, warn};
use rusqlite::{params, Connection};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use tauri::{Emitter, Manager};

use crate::settings::{Hotword, HotwordCategoryMeta, HotwordScenario};

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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HotwordInjection {
    pub person_names: Vec<HotwordEntry>,
    pub product_names: Vec<HotwordEntry>,
    pub domain_terms: Vec<HotwordEntry>,
    pub hotwords: Vec<HotwordEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HotwordEntry {
    pub target: String,
    pub aliases: Vec<String>,
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
    /// - All uppercase 2-5 chars -> "abbreviation"
    /// - Technical suffixes (-js, -ts, Config, Manager, etc.) -> "term"
    /// - Single capitalized word -> "person"
    /// - Default -> "term"
    pub fn infer_category(target: &str) -> String {
        let trimmed = target.trim();

        // Check for abbreviations (all uppercase, 2-5 characters)
        if trimmed.len() >= 2
            && trimmed.len() <= 5
            && trimmed.chars().all(|c| c.is_ascii_uppercase())
        {
            return "abbreviation".to_string();
        }

        // Check for technical terms with known suffixes
        let lower = trimmed.to_lowercase();
        for suffix in TECHNICAL_SUFFIXES {
            let suffix_lower = suffix.to_lowercase();
            if lower.ends_with(&suffix_lower) || lower.contains(&suffix_lower) {
                return "term".to_string();
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
                return "person".to_string();
            }
        }

        "term".to_string()
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
            category: category_str,
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

    /// Add a new hotword (with case-insensitive dedup)
    pub fn add(
        &self,
        target: String,
        originals: Vec<String>,
        category: Option<String>,
        scenarios: Option<Vec<HotwordScenario>>,
    ) -> Result<Hotword> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // Case-insensitive duplicate check
        let existing: Option<(i64, String, String, String, String, bool, i64, Option<i64>, i64, i64, String, String)> = conn
            .query_row(
                "SELECT id, target, originals, category, scenarios, user_override, use_count, last_used_at, false_positive_count, created_at, status, source FROM hotwords WHERE LOWER(target) = LOWER(?1)",
                params![target],
                |row| Ok((
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                    row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
                    row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?,
                )),
            )
            .ok();

        if let Some((
            id,
            existing_target,
            existing_originals_json,
            existing_category,
            existing_scenarios_json,
            existing_user_override,
            existing_use_count,
            existing_last_used_at,
            existing_fp_count,
            existing_created_at,
            existing_status,
            existing_source,
        )) = existing
        {
            // Merge originals into existing hotword
            let mut existing_originals: Vec<String> =
                serde_json::from_str(&existing_originals_json).unwrap_or_default();
            for orig in &originals {
                if !existing_originals
                    .iter()
                    .any(|o| o.eq_ignore_ascii_case(orig))
                {
                    existing_originals.push(orig.clone());
                }
            }
            let merged_json = serde_json::to_string(&existing_originals)?;
            conn.execute(
                "UPDATE hotwords SET originals = ?1 WHERE id = ?2",
                params![merged_json, id],
            )?;
            info!(
                "[Hotword] Merged into existing hotword \"{}\" (id={}), originals: {:?}",
                existing_target, id, existing_originals
            );
            let existing_scenarios: Vec<HotwordScenario> =
                serde_json::from_str(&existing_scenarios_json).unwrap_or_default();
            return Ok(Hotword {
                id,
                target: existing_target,
                originals: existing_originals,
                category: existing_category,
                scenarios: existing_scenarios,
                user_override: existing_user_override,
                use_count: existing_use_count,
                last_used_at: existing_last_used_at,
                false_positive_count: existing_fp_count,
                created_at: existing_created_at,
                status: existing_status,
                source: existing_source,
            });
        }

        // Infer category if not provided
        let final_category = category
            .clone()
            .unwrap_or_else(|| Self::infer_category(&target));
        let user_override = category.is_some();

        // Default to both scenarios if not specified
        let final_scenarios =
            scenarios.unwrap_or_else(|| vec![HotwordScenario::Work, HotwordScenario::Casual]);

        let originals_json = serde_json::to_string(&originals)?;
        let scenarios_json = serde_json::to_string(&final_scenarios)?;

        conn.execute(
            "INSERT INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, 'active', 'manual')",
            params![
                target,
                originals_json,
                final_category,
                scenarios_json,
                user_override,
                now
            ],
        )?;

        let id = conn.last_insert_rowid();

        info!(
            "[Hotword] Added hotword: {} (category={})",
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
        category: String,
        scenarios: Vec<HotwordScenario>,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        let originals_json = serde_json::to_string(&originals)?;
        let scenarios_json = serde_json::to_string(&scenarios)?;

        if let Some(ref new_target) = target {
            conn.execute(
                "UPDATE hotwords
                 SET target = ?1, originals = ?2, category = ?3, scenarios = ?4, user_override = 1
                 WHERE id = ?5",
                params![new_target, originals_json, category, scenarios_json, id],
            )?;
        } else {
            conn.execute(
                "UPDATE hotwords
                 SET originals = ?1, category = ?2, scenarios = ?3, user_override = 1
                 WHERE id = ?4",
                params![originals_json, category, scenarios_json, id],
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

    // ── Category CRUD ────────────────────────────────────────────────────

    /// Get all hotword categories from the database
    pub fn get_categories(&self) -> Result<Vec<HotwordCategoryMeta>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, label, color, icon, sort_order, is_builtin FROM hotword_categories ORDER BY sort_order ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HotwordCategoryMeta {
                id: row.get("id")?,
                label: row.get("label")?,
                color: row.get("color")?,
                icon: row.get("icon")?,
                sort_order: row.get("sort_order")?,
                is_builtin: row.get("is_builtin")?,
            })
        })?;
        let mut categories = Vec::new();
        for row in rows {
            categories.push(row?);
        }
        Ok(categories)
    }

    /// Add a new custom category
    pub fn add_category(
        &self,
        id: &str,
        label: &str,
        color: &str,
        icon: &str,
    ) -> Result<HotwordCategoryMeta> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        // Get next sort_order
        let max_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) FROM hotword_categories",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        conn.execute(
            "INSERT INTO hotword_categories (id, label, color, icon, sort_order, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            params![id, label, color, icon, max_order + 1, now],
        )?;

        info!("[Hotword] Added category: {} ({})", label, id);
        Ok(HotwordCategoryMeta {
            id: id.to_string(),
            label: label.to_string(),
            color: color.to_string(),
            icon: icon.to_string(),
            sort_order: max_order + 1,
            is_builtin: false,
        })
    }

    /// Update an existing category (only non-builtin)
    pub fn update_category(
        &self,
        id: &str,
        label: Option<&str>,
        color: Option<&str>,
        icon: Option<&str>,
        sort_order: Option<i64>,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        if let Some(label) = label {
            conn.execute(
                "UPDATE hotword_categories SET label = ?1 WHERE id = ?2",
                params![label, id],
            )?;
        }
        if let Some(color) = color {
            conn.execute(
                "UPDATE hotword_categories SET color = ?1 WHERE id = ?2",
                params![color, id],
            )?;
        }
        if let Some(icon) = icon {
            conn.execute(
                "UPDATE hotword_categories SET icon = ?1 WHERE id = ?2",
                params![icon, id],
            )?;
        }
        if let Some(sort_order) = sort_order {
            conn.execute(
                "UPDATE hotword_categories SET sort_order = ?1 WHERE id = ?2",
                params![sort_order, id],
            )?;
        }

        info!("[Hotword] Updated category: {}", id);
        Ok(())
    }

    /// Delete a custom category and reassign its hotwords to "term"
    pub fn delete_category(&self, id: &str) -> Result<()> {
        let conn = self.get_connection()?;

        // Check if builtin
        let is_builtin: bool = conn
            .query_row(
                "SELECT is_builtin FROM hotword_categories WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or(true);

        if is_builtin {
            return Err(anyhow::anyhow!("Cannot delete built-in category: {}", id));
        }

        // Reassign hotwords to "term"
        conn.execute(
            "UPDATE hotwords SET category = 'term' WHERE category = ?1",
            params![id],
        )?;

        // Delete the category
        conn.execute(
            "DELETE FROM hotword_categories WHERE id = ?1 AND is_builtin = 0",
            params![id],
        )?;

        info!(
            "[Hotword] Deleted category: {}, reassigned hotwords to 'term'",
            id
        );
        Ok(())
    }

    // ── LLM Injection ────────────────────────────────────────────────────

    fn normalize_hotword_bucket(category: &str) -> &'static str {
        match category {
            "person" => "person",
            "brand" => "product",
            "term" | "abbreviation" => "domain",
            _ => "hotword",
        }
    }

    fn merge_hotword_entry(
        entries: &mut Vec<HotwordEntry>,
        seen: &mut HashMap<String, usize>,
        target: &str,
        aliases: &[String],
    ) {
        let normalized_target = target.trim();
        if normalized_target.is_empty() {
            return;
        }

        if let Some(index) = seen.get(normalized_target).copied() {
            let entry = &mut entries[index];
            let mut alias_seen: BTreeSet<String> = entry.aliases.iter().cloned().collect();
            for alias in aliases {
                let alias = alias.trim();
                if alias.is_empty() || alias.eq_ignore_ascii_case(normalized_target) {
                    continue;
                }
                if alias_seen.insert(alias.to_string()) {
                    entry.aliases.push(alias.to_string());
                }
            }
            return;
        }

        let mut alias_seen = BTreeSet::new();
        let mut normalized_aliases = Vec::new();
        for alias in aliases {
            let alias = alias.trim();
            if alias.is_empty() || alias.eq_ignore_ascii_case(normalized_target) {
                continue;
            }
            if alias_seen.insert(alias.to_string()) {
                normalized_aliases.push(alias.to_string());
            }
        }

        let index = entries.len();
        entries.push(HotwordEntry {
            target: normalized_target.to_string(),
            aliases: normalized_aliases,
        });
        seen.insert(normalized_target.to_string(), index);
    }

    /// Build structured hotword injection data for a specific scenario.
    /// Includes all active hotwords, grouped by category using DB-stored metadata.
    pub fn build_injection(&self, scenario: HotwordScenario) -> Result<HotwordInjection> {
        let hotwords = self.get_by_scenario(scenario)?;
        let hotwords: Vec<Hotword> = hotwords
            .into_iter()
            .filter(|h| h.status == "active")
            .collect();

        if hotwords.is_empty() {
            return Ok(HotwordInjection::default());
        }

        let categories = self.get_categories().unwrap_or_default();
        let cat_map: HashMap<String, HotwordCategoryMeta> =
            categories.into_iter().map(|c| (c.id.clone(), c)).collect();

        let mut grouped_hotwords: Vec<&Hotword> = hotwords.iter().collect();
        grouped_hotwords.sort_by_key(|h| {
            cat_map
                .get(&h.category)
                .map(|m| m.sort_order)
                .unwrap_or(999)
        });

        let mut injection = HotwordInjection::default();
        let mut seen_person = HashMap::new();
        let mut seen_product = HashMap::new();
        let mut seen_domain = HashMap::new();
        let mut seen_hotword = HashMap::new();

        for hotword in grouped_hotwords {
            match Self::normalize_hotword_bucket(&hotword.category) {
                "person" => Self::merge_hotword_entry(
                    &mut injection.person_names,
                    &mut seen_person,
                    &hotword.target,
                    &hotword.originals,
                ),
                "product" => Self::merge_hotword_entry(
                    &mut injection.product_names,
                    &mut seen_product,
                    &hotword.target,
                    &hotword.originals,
                ),
                "domain" => Self::merge_hotword_entry(
                    &mut injection.domain_terms,
                    &mut seen_domain,
                    &hotword.target,
                    &hotword.originals,
                ),
                _ => Self::merge_hotword_entry(
                    &mut injection.hotwords,
                    &mut seen_hotword,
                    &hotword.target,
                    &hotword.originals,
                ),
            }
        }

        debug!(
            "[Hotword] Built structured injection for scenario {:?}: person={}, product={}, domain={}, hotwords={}",
            scenario,
            injection.person_names.len(),
            injection.product_names.len(),
            injection.domain_terms.len(),
            injection.hotwords.len()
        );

        Ok(injection)
    }

    // ── Auto-learning ────────────────────────────────────────────────────

    /// Record an auto-learned hotword from user edit corrections.
    /// If the target already exists, merges the original into its originals array.
    /// If not, creates a new hotword with source='auto_learned'.
    #[allow(dead_code)]
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
            let originals_json = serde_json::to_string(&vec![original])?;

            conn.execute(
                "INSERT INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
                 VALUES (?1, ?2, ?3, '[\"work\",\"casual\"]', 0, 1, 0, ?4, 'active', 'auto_learned')",
                params![target, originals_json, inferred_category, now],
            )?;

            info!(
                "[Hotword] Auto-learned: new hotword \"{}\" from correction \"{}\" (category={})",
                target, original, inferred_category
            );
        }

        Ok(())
    }

    /// Record an auto-learned hotword as a suggestion (status='suggested') from LLM analysis.
    pub fn record_auto_learned_suggested(
        &self,
        target: &str,
        original: &str,
        category: &str,
    ) -> Result<()> {
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
                    "UPDATE hotwords SET originals = ?1 WHERE id = ?2",
                    params![merged_json, id],
                )?;
                info!(
                    "[Hotword] LLM suggested: merged \"{}\" into existing hotword \"{}\" (id={})",
                    original, target, id
                );
            }
        } else {
            let originals_json = serde_json::to_string(&vec![original])?;
            conn.execute(
                "INSERT OR IGNORE INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
                 VALUES (?1, ?2, ?3, '[\"work\",\"casual\"]', 0, 0, 0, ?4, 'suggested', 'auto_learned')",
                params![target, originals_json, category, now],
            )?;
            info!(
                "[Hotword] LLM suggested: new hotword \"{}\" from correction \"{}\" (category={})",
                target, original, category
            );
        }

        Ok(())
    }

    /// Add AI-suggested hotwords in batch. Uses ON CONFLICT to avoid overwriting existing active hotwords.
    pub fn add_suggested(&self, items: Vec<(String, Vec<String>, String)>) -> Result<Vec<Hotword>> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        let mut added = Vec::new();

        for (target, originals, category) in items {
            let originals_json = serde_json::to_string(&originals)?;
            let scenarios_json = "[\"work\",\"casual\"]";

            let result = conn.execute(
                "INSERT OR IGNORE INTO hotwords (target, originals, category, scenarios, user_override, use_count, false_positive_count, created_at, status, source)
                 VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, 'suggested', 'ai_extracted')",
                params![
                    target,
                    originals_json,
                    category,
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

    // ── LLM Correction Analysis ──────────────────────────────────────────

    /// Analyze correction diffs via LLM to determine if they are ASR errors.
    /// Runs as fire-and-forget from the edit pipeline.
    pub async fn analyze_corrections_via_llm(
        app_handle: tauri::AppHandle,
        db_path: PathBuf,
        corrections: Vec<(String, String)>, // (original, corrected)
    ) {
        if corrections.is_empty() {
            return;
        }

        info!(
            "[Hotword] LLM correction analysis: {} corrections to analyze: [{}]",
            corrections.len(),
            corrections
                .iter()
                .map(|(o, c)| format!("\"{}\" → \"{}\"", o, c))
                .collect::<Vec<_>>()
                .join(", ")
        );

        use crate::llm_client;
        use crate::managers::prompt::{self, PromptManager};
        use crate::settings::get_settings;
        use async_openai::types::CreateChatCompletionRequestArgs;
        use std::sync::Arc;

        let settings = get_settings(&app_handle);

        // Resolve provider and model via CachedModel (same as main pipeline)
        let (provider, api_key, model) = {
            // Try selected_prompt_model_id first (it's a CachedModel.id UUID)
            if let Some(cm_id) = &settings.selected_prompt_model_id {
                if let Some(cm) = settings.get_cached_model(cm_id) {
                    let prov = settings
                        .post_process_providers
                        .iter()
                        .find(|p| p.id == cm.provider_id);
                    if let Some(p) = prov {
                        let key = settings
                            .post_process_api_keys
                            .get(&p.id)
                            .cloned()
                            .unwrap_or_default();
                        (p.clone(), key, cm.model_id.clone())
                    } else {
                        info!(
                            "[Hotword] Provider {} not found for cached model {}, skipping LLM correction analysis",
                            cm.provider_id, cm_id
                        );
                        return;
                    }
                } else {
                    info!(
                        "[Hotword] Cached model {} not found, skipping LLM correction analysis",
                        cm_id
                    );
                    return;
                }
            } else {
                // Fallback to active provider + default model
                let prov = match settings.active_post_process_provider() {
                    Some(p) => p.clone(),
                    None => {
                        info!("[Hotword] No active post-process provider, skipping LLM correction analysis");
                        return;
                    }
                };
                let key = settings
                    .post_process_api_keys
                    .get(&prov.id)
                    .cloned()
                    .unwrap_or_default();
                let mdl = settings
                    .post_process_models
                    .get(&prov.id)
                    .cloned()
                    .unwrap_or_default();
                if mdl.is_empty() {
                    info!("[Hotword] No model configured, skipping LLM correction analysis");
                    return;
                }
                (prov, key, mdl)
            }
        };

        if api_key.is_empty() {
            info!(
                "[Hotword] No API key for provider {}, skipping LLM correction analysis",
                provider.id
            );
            return;
        }

        // Load prompt template
        let prompt_manager = app_handle.state::<Arc<PromptManager>>();
        let template = match prompt_manager.get_prompt(&app_handle, "system_correction_analysis") {
            Ok(t) => t,
            Err(e) => {
                warn!("[Hotword] Failed to load correction analysis prompt: {}", e);
                return;
            }
        };

        let filtered_corrections: Vec<_> = corrections
            .iter()
            .filter(|(orig, corr)| {
                let original = orig.trim();
                let corrected = corr.trim();
                !original.is_empty() && !corrected.is_empty() && original != corrected
            })
            .collect();

        if filtered_corrections.is_empty() {
            info!("[Hotword] No meaningful corrections to analyze, skipping");
            return;
        }

        // Format corrections
        let corrections_text: String = filtered_corrections
            .iter()
            .map(|(orig, corr)| format!("- \"{}\" → \"{}\"", orig, corr))
            .collect::<Vec<_>>()
            .join("\n");

        info!(
            "[Hotword] LLM correction analysis: provider={}, model={}, corrections_text_len={}",
            provider.id,
            model,
            corrections_text.len()
        );

        let mut vars = HashMap::new();
        vars.insert("corrections", corrections_text);
        let system_prompt = prompt::substitute_variables(&template, &vars);
        info!(
            "[Hotword] LLM correction analysis prompt:\n{}",
            system_prompt
        );

        // Create LLM client and call
        let client = match llm_client::create_client(&provider, api_key) {
            Ok(c) => c,
            Err(e) => {
                warn!("[Hotword] Failed to create LLM client: {}", e);
                return;
            }
        };

        let mut messages = Vec::new();
        let prompt_role = crate::actions::post_process::resolve_prompt_message_role(
            &settings,
            &provider.id,
            settings.selected_prompt_model_id.as_deref(),
            &model,
        );
        if let Some(msg) =
            crate::actions::post_process::build_instruction_message(prompt_role, system_prompt)
        {
            messages.push(msg);
        }
        if let Some(msg) = crate::actions::post_process::build_user_message("请分析上述修正对。")
        {
            messages.push(msg);
        }

        let req = match CreateChatCompletionRequestArgs::default()
            .model(model.to_string())
            .messages(messages)
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                warn!("[Hotword] Failed to build LLM request: {}", e);
                return;
            }
        };

        let response = match client.chat().create(req).await {
            Ok(r) => r,
            Err(e) => {
                warn!("[Hotword] LLM correction analysis request failed: {}", e);
                return;
            }
        };

        let content = match response
            .choices
            .first()
            .and_then(|c| c.message.content.as_ref())
        {
            Some(c) => c.clone(),
            None => {
                warn!("[Hotword] LLM returned empty response for correction analysis");
                return;
            }
        };

        info!(
            "[Hotword] LLM correction analysis raw response ({} chars):\n{}",
            content.len(),
            content
        );

        // Extract JSON from response
        let json_str = extract_json_block_standalone(&content);
        let json_str = match json_str {
            Some(s) => s,
            None => {
                warn!("[Hotword] Failed to extract JSON from LLM response");
                return;
            }
        };

        // Parse response
        #[derive(serde::Deserialize)]
        struct CorrectionItem {
            original: String,
            corrected: String,
            #[serde(rename = "type")]
            correction_type: String,
            category: Option<String>,
        }

        let items: Vec<CorrectionItem> = match serde_json::from_str(&json_str) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "[Hotword] Failed to parse LLM correction analysis JSON: {}",
                    e
                );
                return;
            }
        };

        for item in &items {
            info!(
                "[Hotword] LLM classified: \"{}\" → \"{}\" = {} (category: {:?})",
                item.original, item.corrected, item.correction_type, item.category
            );
        }

        // Record ASR errors as suggested hotwords
        let hotword_manager = HotwordManager::new(db_path);
        let mut created_count = 0;

        for item in &items {
            if item.correction_type == "asr_error" {
                let category = item.category.as_deref().unwrap_or("term");
                info!(
                    "[Hotword] Recording LLM suggestion: \"{}\" (original: \"{}\", category: {})",
                    item.corrected, item.original, category
                );
                if let Err(e) = hotword_manager.record_auto_learned_suggested(
                    &item.corrected,
                    &item.original,
                    category,
                ) {
                    error!("[Hotword] Failed to record LLM-suggested hotword: {}", e);
                } else {
                    created_count += 1;
                }
            }
        }

        if created_count > 0 {
            info!(
                "[Hotword] LLM correction analysis: created {} suggested hotwords from {} items",
                created_count,
                items.len()
            );
            // Notify frontend
            if let Err(e) = app_handle.emit("hotword-suggestions-updated", ()) {
                error!(
                    "[Hotword] Failed to emit hotword-suggestions-updated: {}",
                    e
                );
            }
        }
    }
}

/// Standalone JSON block extractor (mirrors core::extract_json_block but accessible from here)
fn extract_json_block_standalone(content: &str) -> Option<String> {
    // Remove <think>...</think> blocks
    let mut text = content.to_string();
    while let Some(start) = text.find("<think>") {
        if let Some(end) = text[start..].find("</think>") {
            text.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }
    let content = text.trim();

    // Try ```json block
    if let Some(start) = content.find("```json") {
        let rest = &content[start + 7..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }
    // Try generic ``` block
    if let Some(start) = content.find("```") {
        let rest = &content[start + 3..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }
    // Try raw [ or {
    let start_bracket = content.find('[');
    let start_brace = content.find('{');
    let (start_char, end_char) = match (start_bracket, start_brace) {
        (Some(b), Some(c)) if b < c => (b, content.rfind(']')?),
        (Some(_), Some(c)) => (c, content.rfind('}')?),
        (Some(b), None) => (b, content.rfind(']')?),
        (None, Some(c)) => (c, content.rfind('}')?),
        (None, None) => return None,
    };
    if end_char > start_char {
        return Some(content[start_char..=end_char].trim().to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_category_abbreviation() {
        assert_eq!(HotwordManager::infer_category("API"), "abbreviation");
        assert_eq!(HotwordManager::infer_category("SDK"), "abbreviation");
        assert_eq!(HotwordManager::infer_category("CEO"), "abbreviation");
        assert_eq!(HotwordManager::infer_category("HTTP"), "abbreviation");
        assert_eq!(HotwordManager::infer_category("HTTPS"), "abbreviation");
    }

    #[test]
    fn test_infer_category_abbreviation_too_long() {
        let category = HotwordManager::infer_category("ABCDEF");
        assert_ne!(category, "abbreviation");
    }

    #[test]
    fn test_infer_category_abbreviation_too_short() {
        let category = HotwordManager::infer_category("A");
        assert_ne!(category, "abbreviation");
    }

    #[test]
    fn test_infer_category_technical_terms() {
        assert_eq!(HotwordManager::infer_category("UserConfig"), "term");
        assert_eq!(HotwordManager::infer_category("TaskManager"), "term");
        assert_eq!(HotwordManager::infer_category("AuthService"), "term");
        assert_eq!(HotwordManager::infer_category("EventHandler"), "term");
        assert_eq!(HotwordManager::infer_category("AppController"), "term");
        assert_eq!(HotwordManager::infer_category("DataProvider"), "term");
    }

    #[test]
    fn test_infer_category_person() {
        assert_eq!(HotwordManager::infer_category("John"), "person");
        assert_eq!(HotwordManager::infer_category("Alice"), "person");
    }

    #[test]
    fn test_infer_category_default() {
        assert_eq!(HotwordManager::infer_category("kubernetes"), "term");
        assert_eq!(HotwordManager::infer_category("docker"), "term");
    }

    #[test]
    fn test_infer_category_mixed_case_not_abbreviation() {
        let category = HotwordManager::infer_category("Api");
        assert_ne!(category, "abbreviation");
    }
}
