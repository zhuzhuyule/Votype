# Hotword Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the simple custom_words system with a categorized hotword system that provides structured context to LLM for better accuracy and reduced false positives.

**Architecture:** New Hotword model stored in SQLite with category/scenario metadata. LLM injection reformatted to provide structured guidance by category. Frontend rebuilt with category-aware UI for management.

**Tech Stack:** Rust (Tauri backend), SQLite, React/TypeScript (frontend), Radix UI components

---

## Task 1: Backend - Define Hotword Data Model

**Files:**

- Modify: `src-tauri/src/settings.rs:1-50` (add new types)

**Step 1: Add Hotword types to settings.rs**

Add after line 44 (after `SkillSource` enum):

```rust
/// Hotword category for semantic classification
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum HotwordCategory {
    /// Person names (colleagues, friends, public figures)
    #[default]
    Person,
    /// Technical terms, industry vocabulary
    Term,
    /// Product/brand names, company names
    Brand,
    /// Abbreviations like API, SDK, CEO
    Abbreviation,
}

/// Usage scenario for hotwords
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HotwordScenario {
    /// Work context (meetings, documents, code)
    Work,
    /// Casual conversation (chat, memos)
    Casual,
}

/// Hotword entry with classification metadata
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Hotword {
    pub id: i64,
    /// Possible misrecognized forms (can be multiple)
    pub originals: Vec<String>,
    /// Target correct form
    pub target: String,
    /// Semantic category
    pub category: HotwordCategory,
    /// Usage scenarios (can be multiple)
    pub scenarios: Vec<HotwordScenario>,
    /// Auto-inference confidence (0.0-1.0)
    pub confidence: f64,
    /// Whether user manually overrode the category
    pub user_override: bool,
    /// Usage statistics
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub false_positive_count: i64,
    pub created_at: i64,
}
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 3: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat(hotword): add Hotword data model types"
```

---

## Task 2: Backend - Create Hotwords Database Table

**Files:**

- Modify: `src-tauri/src/managers/history.rs:140-145` (add migration)

**Step 1: Add database migration**

Add new migration after the last one (around line 145):

```rust
    // Migration 17: Add hotwords table for categorized vocabulary
    M::up(
        "CREATE TABLE IF NOT EXISTS hotwords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target TEXT NOT NULL UNIQUE,
            originals TEXT NOT NULL DEFAULT '[]',
            category TEXT NOT NULL DEFAULT 'term',
            scenarios TEXT NOT NULL DEFAULT '[\"work\",\"casual\"]',
            confidence REAL NOT NULL DEFAULT 0.5,
            user_override BOOLEAN NOT NULL DEFAULT 0,
            use_count INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER,
            false_positive_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hotwords_category ON hotwords(category);
        CREATE INDEX IF NOT EXISTS idx_hotwords_use_count ON hotwords(use_count DESC);",
    ),
```

**Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 3: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "feat(hotword): add hotwords database table migration"
```

---

## Task 3: Backend - Create HotwordManager

**Files:**

- Create: `src-tauri/src/managers/hotword.rs`

**Step 1: Create the hotword manager module**

```rust
//! Hotword Manager
//!
//! Manages categorized hotwords for vocabulary correction.
//! Provides CRUD operations and category inference.

use anyhow::Result;
use chrono::Utc;
use log::{debug, info};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::settings::{Hotword, HotwordCategory, HotwordScenario};

/// Manages hotwords in the database
pub struct HotwordManager {
    db_path: PathBuf,
}

impl HotwordManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Infer category from target word
    pub fn infer_category(target: &str) -> (HotwordCategory, f64) {
        // All uppercase 2-5 chars -> abbreviation
        if target.len() >= 2 && target.len() <= 5 && target.chars().all(|c| c.is_ascii_uppercase()) {
            return (HotwordCategory::Abbreviation, 0.9);
        }

        // Technical suffixes -> term
        let tech_patterns = ["-js", "-ts", "-api", "Config", "Manager", "Service", "Handler", "Controller", "Provider"];
        for pattern in tech_patterns {
            if target.to_lowercase().ends_with(&pattern.to_lowercase()) {
                return (HotwordCategory::Term, 0.8);
            }
        }

        // Single capitalized word -> likely person or brand (lower confidence)
        if target.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
            && target.chars().skip(1).all(|c| c.is_lowercase())
        {
            return (HotwordCategory::Person, 0.5);
        }

        // Default to term with low confidence
        (HotwordCategory::Term, 0.3)
    }

    /// Get all hotwords
    pub fn get_all(&self) -> Result<Vec<Hotword>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, target, originals, category, scenarios, confidence, user_override,
                    use_count, last_used_at, false_positive_count, created_at
             FROM hotwords ORDER BY use_count DESC, created_at DESC"
        )?;

        let hotwords = stmt.query_map([], |row| {
            let originals_json: String = row.get(2)?;
            let category_str: String = row.get(3)?;
            let scenarios_json: String = row.get(4)?;

            Ok(Hotword {
                id: row.get(0)?,
                target: row.get(1)?,
                originals: serde_json::from_str(&originals_json).unwrap_or_default(),
                category: serde_json::from_str(&format!("\"{}\"", category_str)).unwrap_or_default(),
                scenarios: serde_json::from_str(&scenarios_json).unwrap_or_default(),
                confidence: row.get(5)?,
                user_override: row.get(6)?,
                use_count: row.get(7)?,
                last_used_at: row.get(8)?,
                false_positive_count: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(hotwords)
    }

    /// Get hotwords filtered by scenario
    pub fn get_by_scenario(&self, scenario: HotwordScenario) -> Result<Vec<Hotword>> {
        let all = self.get_all()?;
        let scenario_str = serde_json::to_string(&scenario)?;
        Ok(all.into_iter().filter(|h| {
            h.scenarios.contains(&scenario)
        }).collect())
    }

    /// Add a new hotword
    pub fn add(&self, target: &str, originals: Vec<String>, category: Option<HotwordCategory>, scenarios: Vec<HotwordScenario>) -> Result<Hotword> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();

        let (inferred_category, confidence) = Self::infer_category(target);
        let final_category = category.unwrap_or(inferred_category);
        let user_override = category.is_some();
        let final_confidence = if user_override { 1.0 } else { confidence };

        let scenarios = if scenarios.is_empty() {
            vec![HotwordScenario::Work, HotwordScenario::Casual]
        } else {
            scenarios
        };

        let originals_json = serde_json::to_string(&originals)?;
        let category_str = serde_json::to_string(&final_category)?.trim_matches('"').to_string();
        let scenarios_json = serde_json::to_string(&scenarios)?;

        conn.execute(
            "INSERT INTO hotwords (target, originals, category, scenarios, confidence, user_override, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![target, originals_json, category_str, scenarios_json, final_confidence, user_override, now],
        )?;

        let id = conn.last_insert_rowid();
        info!("[Hotword] Added: {} (category={:?}, confidence={})", target, final_category, final_confidence);

        Ok(Hotword {
            id,
            target: target.to_string(),
            originals,
            category: final_category,
            scenarios,
            confidence: final_confidence,
            user_override,
            use_count: 0,
            last_used_at: None,
            false_positive_count: 0,
            created_at: now,
        })
    }

    /// Update a hotword
    pub fn update(&self, id: i64, originals: Vec<String>, category: HotwordCategory, scenarios: Vec<HotwordScenario>) -> Result<()> {
        let conn = self.get_connection()?;

        let originals_json = serde_json::to_string(&originals)?;
        let category_str = serde_json::to_string(&category)?.trim_matches('"').to_string();
        let scenarios_json = serde_json::to_string(&scenarios)?;

        conn.execute(
            "UPDATE hotwords SET originals = ?1, category = ?2, scenarios = ?3, user_override = 1
             WHERE id = ?4",
            params![originals_json, category_str, scenarios_json, id],
        )?;

        info!("[Hotword] Updated: id={}", id);
        Ok(())
    }

    /// Delete a hotword
    pub fn delete(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute("DELETE FROM hotwords WHERE id = ?1", params![id])?;
        info!("[Hotword] Deleted: id={}", id);
        Ok(())
    }

    /// Increment use count
    pub fn increment_use(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE hotwords SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    /// Increment false positive count
    pub fn increment_false_positive(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE hotwords SET false_positive_count = false_positive_count + 1 WHERE id = ?1",
            params![id],
        )?;
        debug!("[Hotword] False positive recorded: id={}", id);
        Ok(())
    }

    /// Build structured LLM injection text
    pub fn build_llm_injection(&self, scenario: Option<HotwordScenario>, limit: usize) -> Result<String> {
        let all = self.get_all()?;

        // Filter by scenario if specified
        let filtered: Vec<_> = if let Some(s) = scenario {
            all.into_iter().filter(|h| h.scenarios.contains(&s)).collect()
        } else {
            all
        };

        // Sort by use_count desc, false_positive_count asc
        let mut sorted = filtered;
        sorted.sort_by(|a, b| {
            let score_a = a.use_count as f64 - (a.false_positive_count as f64 * 2.0);
            let score_b = b.use_count as f64 - (b.false_positive_count as f64 * 2.0);
            score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Group by category
        let mut persons = Vec::new();
        let mut terms = Vec::new();
        let mut brands = Vec::new();
        let mut abbreviations = Vec::new();

        for h in sorted.into_iter().take(limit) {
            let entry = if h.originals.is_empty() {
                h.target.clone()
            } else {
                format!("\"{}\" → \"{}\"", h.originals.join("/"), h.target)
            };

            let scenarios_str: Vec<_> = h.scenarios.iter().map(|s| match s {
                HotwordScenario::Work => "工作",
                HotwordScenario::Casual => "日常",
            }).collect();
            let entry_with_scenario = format!("{} [{}]", entry, scenarios_str.join(","));

            match h.category {
                HotwordCategory::Person => persons.push(entry_with_scenario),
                HotwordCategory::Term => terms.push(entry_with_scenario),
                HotwordCategory::Brand => brands.push(entry_with_scenario),
                HotwordCategory::Abbreviation => abbreviations.push(entry_with_scenario),
            }
        }

        let mut sections = Vec::new();

        if !persons.is_empty() {
            sections.push(format!(
                "### 人名 (person)\n当对话涉及人物时考虑：\n{}",
                persons.iter().map(|p| format!("- {}", p)).collect::<Vec<_>>().join("\n")
            ));
        }

        if !terms.is_empty() {
            sections.push(format!(
                "### 专业术语 (term)\n技术讨论中考虑：\n{}",
                terms.iter().map(|t| format!("- {}", t)).collect::<Vec<_>>().join("\n")
            ));
        }

        if !brands.is_empty() {
            sections.push(format!(
                "### 品牌/产品 (brand)\n提及产品或公司时考虑：\n{}",
                brands.iter().map(|b| format!("- {}", b)).collect::<Vec<_>>().join("\n")
            ));
        }

        if !abbreviations.is_empty() {
            sections.push(format!(
                "### 缩写 (abbreviation)\n通常可直接替换：\n{}",
                abbreviations.iter().map(|a| format!("- {}", a)).collect::<Vec<_>>().join("\n")
            ));
        }

        if sections.is_empty() {
            return Ok(String::new());
        }

        let guidance = r#"
## 替换判断规则

1. **语义相关性** - 原词在当前语境中是否指向目标概念？
   - ✓ "我要问一下 cloud" (谈论人) → Claude
   - ✗ "deploy to cloud" (谈论云服务) → 保持 cloud

2. **场景匹配** - 热词标记的场景是否与当前场景一致？

3. **置信度要求** - 不确定时保守处理，保留原词"#;

        Ok(format!(
            "## 词汇修正指引\n\n{}\n{}",
            sections.join("\n\n"),
            guidance
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_category_abbreviation() {
        let (cat, conf) = HotwordManager::infer_category("API");
        assert_eq!(cat, HotwordCategory::Abbreviation);
        assert!(conf > 0.8);
    }

    #[test]
    fn test_infer_category_term() {
        let (cat, conf) = HotwordManager::infer_category("UserService");
        assert_eq!(cat, HotwordCategory::Term);
    }

    #[test]
    fn test_infer_category_person() {
        let (cat, conf) = HotwordManager::infer_category("Claude");
        assert_eq!(cat, HotwordCategory::Person);
        assert!(conf < 0.6); // Lower confidence for person names
    }
}
```

**Step 2: Register module in managers/mod.rs**

Find `src-tauri/src/managers/mod.rs` and add:

```rust
pub mod hotword;
pub use hotword::HotwordManager;
```

**Step 3: Verify compilation and run tests**

Run: `cd src-tauri && cargo test hotword`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src-tauri/src/managers/hotword.rs src-tauri/src/managers/mod.rs
git commit -m "feat(hotword): add HotwordManager with category inference"
```

---

## Task 4: Backend - Add Tauri Commands

**Files:**

- Create: `src-tauri/src/commands/hotword.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

**Step 1: Create hotword commands**

```rust
//! Hotword Tauri Commands

use crate::managers::HotwordManager;
use crate::settings::{Hotword, HotwordCategory, HotwordScenario};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::managers::HistoryManager;

#[tauri::command]
pub fn get_hotwords(app: AppHandle) -> Result<Vec<Hotword>, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.get_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_hotword(
    app: AppHandle,
    target: String,
    originals: Vec<String>,
    category: Option<HotwordCategory>,
    scenarios: Vec<HotwordScenario>,
) -> Result<Hotword, String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.add(&target, originals, category, scenarios).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_hotword(
    app: AppHandle,
    id: i64,
    originals: Vec<String>,
    category: HotwordCategory,
    scenarios: Vec<HotwordScenario>,
) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.update(id, originals, category, scenarios).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_hotword(app: AppHandle, id: i64) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn infer_hotword_category(target: String) -> (HotwordCategory, f64) {
    HotwordManager::infer_category(&target)
}

#[tauri::command]
pub fn increment_hotword_false_positive(app: AppHandle, id: i64) -> Result<(), String> {
    let hm = app.state::<Arc<HistoryManager>>();
    let manager = HotwordManager::new(hm.db_path.clone());
    manager.increment_false_positive(id).map_err(|e| e.to_string())
}
```

**Step 2: Register module in commands/mod.rs**

```rust
pub mod hotword;
```

**Step 3: Register commands in lib.rs**

Find the `.invoke_handler(tauri::generate_handler![...])` block and add:

```rust
commands::hotword::get_hotwords,
commands::hotword::add_hotword,
commands::hotword::update_hotword,
commands::hotword::delete_hotword,
commands::hotword::infer_hotword_category,
commands::hotword::increment_hotword_false_positive,
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 5: Commit**

```bash
git add src-tauri/src/commands/hotword.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(hotword): add Tauri commands for hotword management"
```

---

## Task 5: Backend - Update LLM Injection in post_process.rs

**Files:**

- Modify: `src-tauri/src/actions/post_process.rs:1220-1346`

**Step 1: Import HotwordManager**

Add import at top of file:

```rust
use crate::managers::HotwordManager;
use crate::settings::HotwordScenario;
```

**Step 2: Replace hot_words injection logic**

Replace the section from approximately line 1222 to 1266 (the hot_words injection block) with:

```rust
        // Inject structured hotwords
        if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
            let hotword_manager = HotwordManager::new(hm.db_path.clone());

            // Determine scenario from app context
            let scenario = Self::detect_scenario(&app_name);

            if let Ok(injection) = hotword_manager.build_llm_injection(scenario, 25) {
                if !injection.is_empty() {
                    input_data_parts.push(injection);
                    debug!("[PostProcess] Injected structured hotwords for scenario {:?}", scenario);
                }
            }
        }
```

**Step 3: Add scenario detection helper**

Add this function to the impl block:

```rust
    /// Detect usage scenario from app name
    fn detect_scenario(app_name: &Option<String>) -> Option<HotwordScenario> {
        let work_apps = ["Code", "VSCode", "Cursor", "Terminal", "iTerm", "Slack", "Notion", "Figma", "Xcode", "IntelliJ"];
        let casual_apps = ["WeChat", "Messages", "Telegram", "WhatsApp", "Discord"];

        if let Some(name) = app_name {
            for app in work_apps {
                if name.contains(app) {
                    return Some(HotwordScenario::Work);
                }
            }
            for app in casual_apps {
                if name.contains(app) {
                    return Some(HotwordScenario::Casual);
                }
            }
        }
        None // Both scenarios apply
    }
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds

**Step 5: Commit**

```bash
git add src-tauri/src/actions/post_process.rs
git commit -m "feat(hotword): integrate structured hotword injection into post-processing"
```

---

## Task 6: Backend - Remove Old custom_words

**Files:**

- Modify: `src-tauri/src/settings.rs` (remove custom_words field)
- Modify: `src-tauri/src/shortcut.rs` (remove update_custom_words)
- Modify: `src-tauri/src/audio_toolkit/text.rs` (remove apply_custom_words)
- Modify: `src-tauri/src/managers/transcription.rs` (remove custom_words usage)
- Modify: `src-tauri/src/lib.rs` (remove command registration)

**Step 1: Remove custom_words from AppSettings**

In `settings.rs`, find and remove:

```rust
    pub custom_words: Vec<String>,
```

And from default initialization:

```rust
        custom_words: Vec::new(),
```

**Step 2: Remove update_custom_words from shortcut.rs**

Remove the entire function `update_custom_words`.

**Step 3: Remove apply_custom_words function**

In `audio_toolkit/text.rs`, remove or comment out the `apply_custom_words` function and its tests.

Update `audio_toolkit/mod.rs` to remove the export.

**Step 4: Update transcription.rs**

Remove all references to `apply_custom_words` and `get_all_custom_words`. Search for `custom_words` and remove related code.

**Step 5: Remove command from lib.rs**

Remove `shortcut::update_custom_words` from the invoke_handler.

**Step 6: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compilation succeeds (possibly with warnings about unused imports)

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(hotword): remove old custom_words system"
```

---

## Task 7: Frontend - Add TypeScript Types

**Files:**

- Create: `src/types/hotword.ts`

**Step 1: Create types file**

```typescript
export type HotwordCategory = "person" | "term" | "brand" | "abbreviation";
export type HotwordScenario = "work" | "casual";

export interface Hotword {
  id: number;
  originals: string[];
  target: string;
  category: HotwordCategory;
  scenarios: HotwordScenario[];
  confidence: number;
  user_override: boolean;
  use_count: number;
  last_used_at: number | null;
  false_positive_count: number;
  created_at: number;
}

export const CATEGORY_LABELS: Record<HotwordCategory, string> = {
  person: "人名",
  term: "术语",
  brand: "品牌",
  abbreviation: "缩写",
};

export const CATEGORY_ICONS: Record<HotwordCategory, string> = {
  person: "👤",
  term: "🔧",
  brand: "🏢",
  abbreviation: "🔤",
};

export const SCENARIO_LABELS: Record<HotwordScenario, string> = {
  work: "工作",
  casual: "日常",
};
```

**Step 2: Commit**

```bash
git add src/types/hotword.ts
git commit -m "feat(hotword): add frontend TypeScript types"
```

---

## Task 8: Frontend - Create HotwordSettings Component

**Files:**

- Create: `src/components/settings/HotwordSettings.tsx`

**Step 1: Create the component**

```typescript
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  Flex,
  IconButton,
  RadioGroup,
  SegmentedControl,
  Table,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  IconDownload,
  IconFilter,
  IconPlus,
  IconTrash,
  IconUpload,
  IconEdit,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../ui/Card";
import {
  Hotword,
  HotwordCategory,
  HotwordScenario,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  SCENARIO_LABELS,
} from "../../types/hotword";

// Add Hotword Dialog
const AddHotwordDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (target: string, originals: string[], category: HotwordCategory | null, scenarios: HotwordScenario[]) => Promise<void>;
}> = ({ open, onOpenChange, onAdd }) => {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
  const [originals, setOriginals] = useState("");
  const [category, setCategory] = useState<HotwordCategory | null>(null);
  const [inferredCategory, setInferredCategory] = useState<HotwordCategory>("term");
  const [confidence, setConfidence] = useState(0);
  const [scenarios, setScenarios] = useState<HotwordScenario[]>(["work", "casual"]);
  const [loading, setLoading] = useState(false);

  // Infer category when target changes
  useEffect(() => {
    if (target.trim()) {
      invoke<[HotwordCategory, number]>("infer_hotword_category", { target: target.trim() })
        .then(([cat, conf]) => {
          setInferredCategory(cat);
          setConfidence(conf);
        })
        .catch(console.error);
    }
  }, [target]);

  const handleAdd = async () => {
    if (!target.trim()) return;
    setLoading(true);
    try {
      const originalsList = originals
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await onAdd(target.trim(), originalsList, category, scenarios);
      setTarget("");
      setOriginals("");
      setCategory(null);
      setScenarios(["work", "casual"]);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleScenario = (s: HotwordScenario) => {
    setScenarios((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const finalCategory = category ?? inferredCategory;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="450px">
        <Dialog.Title>添加热词</Dialog.Title>
        <Flex direction="column" gap="4" mt="4">
          <div>
            <Text size="2" weight="medium" mb="1">目标词</Text>
            <TextField.Root
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="例如: Claude, Tauri, API"
            />
          </div>

          <div>
            <Text size="2" weight="medium" mb="1">可能的错误识别（可选，逗号分隔）</Text>
            <TextField.Root
              value={originals}
              onChange={(e) => setOriginals(e.target.value)}
              placeholder="例如: cloud, claud"
            />
          </div>

          <div>
            <Text size="2" weight="medium" mb="2">分类</Text>
            <RadioGroup.Root value={category ?? ""} onValueChange={(v) => setCategory(v as HotwordCategory || null)}>
              <Flex gap="3" wrap="wrap">
                {(["person", "term", "brand", "abbreviation"] as HotwordCategory[]).map((cat) => (
                  <label key={cat} className="flex items-center gap-1 cursor-pointer">
                    <RadioGroup.Item value={cat} />
                    <Text size="2">
                      {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                      {!category && cat === inferredCategory && (
                        <Text size="1" color="gray"> (推断)</Text>
                      )}
                    </Text>
                  </label>
                ))}
              </Flex>
            </RadioGroup.Root>
          </div>

          <div>
            <Text size="2" weight="medium" mb="2">使用场景</Text>
            <Flex gap="3">
              {(["work", "casual"] as HotwordScenario[]).map((s) => (
                <label key={s} className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={scenarios.includes(s)}
                    onCheckedChange={() => toggleScenario(s)}
                  />
                  <Text size="2">{SCENARIO_LABELS[s]}</Text>
                </label>
              ))}
            </Flex>
          </div>
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">取消</Button>
          </Dialog.Close>
          <Button onClick={handleAdd} disabled={!target.trim() || loading}>
            添加
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

// Batch Add Dialog
const BatchAddDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBatchAdd: (targets: string[]) => Promise<void>;
}> = ({ open, onOpenChange, onBatchAdd }) => {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const targets = text.split("\n").map((s) => s.trim()).filter(Boolean);

  const handleAdd = async () => {
    if (targets.length === 0) return;
    setLoading(true);
    try {
      await onBatchAdd(targets);
      setText("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="450px">
        <Dialog.Title>批量添加</Dialog.Title>
        <Text size="2" color="gray" mb="3">
          每行一个热词，分类将自动推断
        </Text>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Claude&#10;Tauri&#10;API&#10;Anthropic"
          rows={8}
        />
        {targets.length > 0 && (
          <Text size="2" color="gray" mt="2">
            将添加 {targets.length} 个热词
          </Text>
        )}
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">取消</Button>
          </Dialog.Close>
          <Button onClick={handleAdd} disabled={targets.length === 0 || loading}>
            添加全部
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export const HotwordSettings: React.FC = () => {
  const { t } = useTranslation();
  const [hotwords, setHotwords] = useState<Hotword[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HotwordCategory | "all">("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const loadHotwords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Hotword[]>("get_hotwords");
      setHotwords(result);
    } catch (e) {
      console.error("[HotwordSettings] Load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHotwords();
  }, [loadHotwords]);

  const handleAdd = async (
    target: string,
    originals: string[],
    category: HotwordCategory | null,
    scenarios: HotwordScenario[]
  ) => {
    const result = await invoke<Hotword>("add_hotword", {
      target,
      originals,
      category,
      scenarios,
    });
    setHotwords((prev) => [result, ...prev]);
  };

  const handleBatchAdd = async (targets: string[]) => {
    for (const target of targets) {
      await invoke<Hotword>("add_hotword", {
        target,
        originals: [],
        category: null,
        scenarios: ["work", "casual"],
      });
    }
    await loadHotwords();
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    await invoke("delete_hotword", { id: deleteId });
    setHotwords((prev) => prev.filter((h) => h.id !== deleteId));
    setDeleteId(null);
  };

  const handleExport = () => {
    const data = {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      hotwords: hotwords.map(({ id, use_count, last_used_at, false_positive_count, created_at, confidence, user_override, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hotwords.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const items = data.hotwords || data;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (typeof item === "string") {
              // Old format: string[]
              await invoke("add_hotword", {
                target: item,
                originals: [],
                category: null,
                scenarios: ["work", "casual"],
              });
            } else if (item.target) {
              // New format
              await invoke("add_hotword", {
                target: item.target,
                originals: item.originals || [],
                category: item.category || null,
                scenarios: item.scenarios || ["work", "casual"],
              });
            }
          }
          await loadHotwords();
        }
      } catch (err) {
        console.error("[HotwordSettings] Import failed:", err);
      }
    };
    input.click();
  };

  // Group by category
  const grouped = React.useMemo(() => {
    const filtered = filter === "all" ? hotwords : hotwords.filter((h) => h.category === filter);
    const groups: Record<HotwordCategory, Hotword[]> = {
      person: [],
      term: [],
      brand: [],
      abbreviation: [],
    };
    filtered.forEach((h) => {
      groups[h.category].push(h);
    });
    return groups;
  }, [hotwords, filter]);

  return (
    <>
      <Card className="max-w-5xl w-full mx-auto p-0 flex flex-col">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-100 shrink-0 bg-white z-10">
          <Flex justify="between" align="center" wrap="wrap" gap="3">
            <Flex gap="2" align="center">
              <SegmentedControl.Root
                value={filter}
                onValueChange={(v) => setFilter(v as HotwordCategory | "all")}
                size="1"
              >
                <SegmentedControl.Item value="all">全部</SegmentedControl.Item>
                <SegmentedControl.Item value="person">👤 人名</SegmentedControl.Item>
                <SegmentedControl.Item value="term">🔧 术语</SegmentedControl.Item>
                <SegmentedControl.Item value="brand">🏢 品牌</SegmentedControl.Item>
                <SegmentedControl.Item value="abbreviation">🔤 缩写</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Flex>
            <Flex gap="2">
              <Button variant="soft" onClick={() => setBatchDialogOpen(true)}>
                <IconPlus size={14} />
                批量添加
              </Button>
              <Button onClick={() => setAddDialogOpen(true)}>
                <IconPlus size={14} />
                添加
              </Button>
              <Button variant="soft" onClick={handleImport}>
                <IconUpload size={14} />
                导入
              </Button>
              <Button variant="soft" onClick={handleExport} disabled={hotwords.length === 0}>
                <IconDownload size={14} />
                导出
              </Button>
            </Flex>
          </Flex>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 bg-gray-50/50 overflow-auto">
          {loading ? (
            <Text size="2" color="gray" className="py-8 text-center">
              加载中...
            </Text>
          ) : hotwords.length === 0 ? (
            <Text size="2" color="gray" className="py-8 text-center">
              暂无热词，点击"添加"开始
            </Text>
          ) : (
            <Flex direction="column" gap="4">
              {(["person", "term", "brand", "abbreviation"] as HotwordCategory[]).map((cat) => {
                const items = grouped[cat];
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <Text size="2" weight="medium" mb="2" className="flex items-center gap-1">
                      {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                      <Badge size="1" color="gray" ml="2">{items.length}</Badge>
                    </Text>
                    <Table.Root variant="surface">
                      <Table.Body>
                        {items.map((h) => (
                          <Table.Row key={h.id}>
                            <Table.Cell width="30%">
                              <Text weight="bold" className="text-green-600 font-mono">
                                {h.target}
                              </Text>
                            </Table.Cell>
                            <Table.Cell width="30%">
                              {h.originals.length > 0 ? (
                                <Flex gap="1" wrap="wrap">
                                  {h.originals.slice(0, 3).map((o, i) => (
                                    <Badge key={i} size="1" color="gray" variant="soft">
                                      {o}
                                    </Badge>
                                  ))}
                                  {h.originals.length > 3 && (
                                    <Badge size="1" color="gray" variant="soft">
                                      +{h.originals.length - 3}
                                    </Badge>
                                  )}
                                </Flex>
                              ) : (
                                <Text size="1" color="gray">-</Text>
                              )}
                            </Table.Cell>
                            <Table.Cell width="15%">
                              <Flex gap="1">
                                {h.scenarios.map((s) => (
                                  <Badge key={s} size="1" variant="soft">
                                    {SCENARIO_LABELS[s]}
                                  </Badge>
                                ))}
                              </Flex>
                            </Table.Cell>
                            <Table.Cell width="15%" align="center">
                              <Text size="1" color="gray">
                                使用 {h.use_count} 次
                              </Text>
                            </Table.Cell>
                            <Table.Cell width="10%" align="right">
                              <IconButton
                                variant="ghost"
                                size="1"
                                color="red"
                                onClick={() => setDeleteId(h.id)}
                              >
                                <IconTrash size={14} />
                              </IconButton>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </div>
                );
              })}
            </Flex>
          )}
        </div>
      </Card>

      {/* Add Dialog */}
      <AddHotwordDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAdd}
      />

      {/* Batch Add Dialog */}
      <BatchAddDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        onBatchAdd={handleBatchAdd}
      />

      {/* Delete Confirmation */}
      <AlertDialog.Root open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description size="2">
            确定要删除这个热词吗？此操作无法撤销。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={handleDelete}>
                删除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/settings/HotwordSettings.tsx
git commit -m "feat(hotword): add HotwordSettings component with category UI"
```

---

## Task 9: Frontend - Update VocabularySettings to Use New Component

**Files:**

- Modify: `src/components/settings/VocabularySettings.tsx`

**Step 1: Replace hotwords tab with new component**

Import the new component at the top:

```typescript
import { HotwordSettings } from "./HotwordSettings";
```

Replace the entire hotwords tab content (the section `{activeTab === "hotwords" && ...}`) with:

```typescript
        {/* Hot Words Tab Content */}
        {activeTab === "hotwords" && <HotwordSettings />}
```

Remove all the old hotword-related state and handlers:

- `newWord`, `setNewWord`
- `hotwordToDelete`, `setHotwordToDelete`
- `handleAddWord`, `confirmRemoveHotword`, `executeRemoveHotword`
- `handleKeyPress`
- `handleExportHotWords`, `handleImportHotWords`
- Any imports no longer needed

**Step 2: Verify frontend builds**

Run: `bun build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/settings/VocabularySettings.tsx
git commit -m "refactor(hotword): integrate new HotwordSettings into VocabularySettings"
```

---

## Task 10: Frontend - Remove Old CustomWords Component

**Files:**

- Delete: `src/components/settings/CustomWords.tsx`
- Modify: Any files that import it

**Step 1: Find and remove imports**

Search for imports of `CustomWords` and remove them:

```bash
grep -r "CustomWords" src/
```

Remove the component file and any references.

**Step 2: Verify frontend builds**

Run: `bun build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(hotword): remove old CustomWords component"
```

---

## Task 11: Integration Testing

**Files:** None (manual testing)

**Step 1: Start the app**

Run: `bun tauri dev`

**Step 2: Test hotword management**

1. Navigate to Vocabulary Settings
2. Switch to "Hot Words" tab
3. Add a hotword (verify auto-inference)
4. Add multiple hotwords via batch add
5. Filter by category
6. Export and re-import

**Step 3: Test LLM injection**

1. Enable post-processing
2. Perform a transcription
3. Check logs for "Injected structured hotwords"

**Step 4: Commit any fixes**

---

## Task 12: Final Cleanup

**Files:** Various

**Step 1: Remove any unused imports**

Run: `cd src-tauri && cargo clippy`
Fix any warnings.

**Step 2: Format code**

Run: `bun format`

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: cleanup and format after hotword optimization"
```

---

## Summary

This plan implements the hotword optimization feature in 12 tasks:

1. **Task 1-2**: Backend data model and database
2. **Task 3-5**: Backend manager, commands, and LLM injection
3. **Task 6**: Remove old system
4. **Task 7-10**: Frontend implementation
5. **Task 11-12**: Testing and cleanup

Each task is self-contained with verification steps and commits.
