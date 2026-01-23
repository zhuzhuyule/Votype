# Summary & User Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement an intelligent summary system with user profile analysis that feeds back into the polish workflow.

**Architecture:**

- Backend: New `summary` manager in Rust handling database operations, stats calculation, and LLM analysis
- Frontend: New `summary/` component directory with page and sub-components
- Integration: User profile `style_prompt` injected into existing post_process flow

**Tech Stack:** Rust (rusqlite, async-openai), React, TypeScript, Radix UI, Tailwind CSS

---

## Phase 1: Database Foundation (P0)

### Task 1.1: Add Database Migrations

**Files:**

- Modify: `src-tauri/src/managers/history.rs` (add migrations to MIGRATIONS array)

**Step 1: Add migrations for summaries and user_profile tables**

Add to the `MIGRATIONS` array in `history.rs`:

```rust
// Migration 18: Add summaries table for caching period summaries
M::up(
    "CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_type TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        stats TEXT NOT NULL,
        ai_summary TEXT,
        ai_reflection TEXT,
        ai_generated_at INTEGER,
        ai_model_used TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(period_type, period_start, period_end)
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_period ON summaries(period_type, period_start);",
),
// Migration 19: Add user_profile table for communication style tracking
M::up(
    "CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        vocabulary_stats TEXT,
        expression_stats TEXT,
        app_usage_stats TEXT,
        time_pattern_stats TEXT,
        communication_style TEXT,
        tone_preference TEXT,
        style_prompt TEXT,
        feedback_style TEXT DEFAULT 'encouraging',
        last_analyzed_at INTEGER,
        updated_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO user_profile (id, updated_at) VALUES (1, strftime('%s', 'now'));",
),
```

**Step 2: Run the app to verify migrations apply**

Run: `bun tauri dev`
Expected: App starts without database errors

**Step 3: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "feat(db): add summaries and user_profile tables"
```

---

## Phase 2: Rust Backend - Summary Manager (P0)

### Task 2.1: Create Summary Manager Module

**Files:**

- Create: `src-tauri/src/managers/summary.rs`
- Modify: `src-tauri/src/managers/mod.rs`

**Step 1: Create the summary manager file**

```rust
use anyhow::Result;
use log::{debug, info};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SummaryStats {
    pub entry_count: i64,
    pub total_duration_ms: i64,
    pub total_chars: i64,
    pub llm_calls: i64,
    pub by_app: std::collections::HashMap<String, AppStats>,
    pub by_hour: Vec<i64>,
    pub top_skills: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppStats {
    pub count: i64,
    pub chars: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Summary {
    pub id: i64,
    pub period_type: String,
    pub period_start: i64,
    pub period_end: i64,
    pub stats: SummaryStats,
    pub ai_summary: Option<String>,
    pub ai_reflection: Option<String>,
    pub ai_generated_at: Option<i64>,
    pub ai_model_used: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserProfile {
    pub vocabulary_stats: Option<String>,
    pub expression_stats: Option<String>,
    pub app_usage_stats: Option<String>,
    pub time_pattern_stats: Option<String>,
    pub communication_style: Option<String>,
    pub tone_preference: Option<String>,
    pub style_prompt: Option<String>,
    pub feedback_style: String,
    pub last_analyzed_at: Option<i64>,
    pub updated_at: i64,
}

pub struct SummaryManager {
    db_path: PathBuf,
}

impl SummaryManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Calculate stats for a given time range from history entries
    pub fn calculate_stats(&self, start_ts: i64, end_ts: i64) -> Result<SummaryStats> {
        let conn = self.get_connection()?;

        let mut stmt = conn.prepare(
            "SELECT
                COUNT(*) as entry_count,
                COALESCE(SUM(duration_ms), 0) as total_duration_ms,
                COALESCE(SUM(char_count), 0) as total_chars,
                COALESCE(SUM(CASE WHEN post_processed_text IS NOT NULL AND post_processed_text != '' THEN 1 ELSE 0 END), 0) as llm_calls
            FROM transcription_history
            WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0"
        )?;

        let (entry_count, total_duration_ms, total_chars, llm_calls): (i64, i64, i64, i64) =
            stmt.query_row(params![start_ts, end_ts], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?;

        // Get by_app stats
        let mut by_app = std::collections::HashMap::new();
        let mut app_stmt = conn.prepare(
            "SELECT app_name, COUNT(*) as count, COALESCE(SUM(char_count), 0) as chars
            FROM transcription_history
            WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0 AND app_name IS NOT NULL
            GROUP BY app_name
            ORDER BY count DESC"
        )?;
        let app_rows = app_stmt.query_map(params![start_ts, end_ts], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })?;
        for row in app_rows {
            let (app_name, count, chars) = row?;
            by_app.insert(app_name, AppStats { count, chars });
        }

        // Get by_hour stats (24 hours)
        let mut by_hour = vec![0i64; 24];
        let mut hour_stmt = conn.prepare(
            "SELECT strftime('%H', datetime(timestamp, 'unixepoch', 'localtime')) as hour, COUNT(*) as count
            FROM transcription_history
            WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0
            GROUP BY hour"
        )?;
        let hour_rows = hour_stmt.query_map(params![start_ts, end_ts], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in hour_rows {
            let (hour_str, count) = row?;
            if let Ok(hour) = hour_str.parse::<usize>() {
                if hour < 24 {
                    by_hour[hour] = count;
                }
            }
        }

        // Get top skills
        let mut top_skills = Vec::new();
        let mut skill_stmt = conn.prepare(
            "SELECT post_process_prompt_id, COUNT(*) as count
            FROM transcription_history
            WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0
                AND post_process_prompt_id IS NOT NULL AND post_process_prompt_id != ''
            GROUP BY post_process_prompt_id
            ORDER BY count DESC
            LIMIT 5"
        )?;
        let skill_rows = skill_stmt.query_map(params![start_ts, end_ts], |row| {
            Ok(row.get::<_, String>(0)?)
        })?;
        for row in skill_rows {
            top_skills.push(row?);
        }

        Ok(SummaryStats {
            entry_count,
            total_duration_ms,
            total_chars,
            llm_calls,
            by_app,
            by_hour,
            top_skills,
        })
    }

    /// Get or create a summary for a given period
    pub fn get_or_create_summary(&self, period_type: &str, start_ts: i64, end_ts: i64) -> Result<Summary> {
        let conn = self.get_connection()?;

        // Try to get existing summary
        let existing: Option<Summary> = conn.query_row(
            "SELECT id, period_type, period_start, period_end, stats, ai_summary, ai_reflection,
                    ai_generated_at, ai_model_used, created_at, updated_at
             FROM summaries WHERE period_type = ?1 AND period_start = ?2 AND period_end = ?3",
            params![period_type, start_ts, end_ts],
            |row| {
                let stats_json: String = row.get(4)?;
                let stats: SummaryStats = serde_json::from_str(&stats_json).unwrap_or_else(|_| SummaryStats {
                    entry_count: 0,
                    total_duration_ms: 0,
                    total_chars: 0,
                    llm_calls: 0,
                    by_app: std::collections::HashMap::new(),
                    by_hour: vec![0; 24],
                    top_skills: Vec::new(),
                });
                Ok(Summary {
                    id: row.get(0)?,
                    period_type: row.get(1)?,
                    period_start: row.get(2)?,
                    period_end: row.get(3)?,
                    stats,
                    ai_summary: row.get(5)?,
                    ai_reflection: row.get(6)?,
                    ai_generated_at: row.get(7)?,
                    ai_model_used: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            }
        ).ok();

        if let Some(summary) = existing {
            return Ok(summary);
        }

        // Calculate fresh stats and create new summary
        let stats = self.calculate_stats(start_ts, end_ts)?;
        let now = chrono::Utc::now().timestamp();
        let stats_json = serde_json::to_string(&stats)?;

        conn.execute(
            "INSERT INTO summaries (period_type, period_start, period_end, stats, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![period_type, start_ts, end_ts, stats_json, now, now],
        )?;

        let id = conn.last_insert_rowid();
        Ok(Summary {
            id,
            period_type: period_type.to_string(),
            period_start: start_ts,
            period_end: end_ts,
            stats,
            ai_summary: None,
            ai_reflection: None,
            ai_generated_at: None,
            ai_model_used: None,
            created_at: now,
            updated_at: now,
        })
    }

    /// Update AI-generated content for a summary
    pub fn update_summary_ai_content(
        &self,
        summary_id: i64,
        ai_summary: Option<String>,
        ai_reflection: Option<String>,
        model_used: Option<String>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE summaries SET ai_summary = ?1, ai_reflection = ?2, ai_model_used = ?3,
             ai_generated_at = ?4, updated_at = ?5 WHERE id = ?6",
            params![ai_summary, ai_reflection, model_used, now, now, summary_id],
        )?;

        Ok(())
    }

    /// Get list of cached summaries for sidebar
    pub fn get_summary_list(&self) -> Result<Vec<Summary>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, period_type, period_start, period_end, stats, ai_summary, ai_reflection,
                    ai_generated_at, ai_model_used, created_at, updated_at
             FROM summaries ORDER BY period_start DESC LIMIT 50"
        )?;

        let rows = stmt.query_map([], |row| {
            let stats_json: String = row.get(4)?;
            let stats: SummaryStats = serde_json::from_str(&stats_json).unwrap_or_else(|_| SummaryStats {
                entry_count: 0,
                total_duration_ms: 0,
                total_chars: 0,
                llm_calls: 0,
                by_app: std::collections::HashMap::new(),
                by_hour: vec![0; 24],
                top_skills: Vec::new(),
            });
            Ok(Summary {
                id: row.get(0)?,
                period_type: row.get(1)?,
                period_start: row.get(2)?,
                period_end: row.get(3)?,
                stats,
                ai_summary: row.get(5)?,
                ai_reflection: row.get(6)?,
                ai_generated_at: row.get(7)?,
                ai_model_used: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        let mut summaries = Vec::new();
        for row in rows {
            summaries.push(row?);
        }
        Ok(summaries)
    }

    /// Get user profile
    pub fn get_user_profile(&self) -> Result<UserProfile> {
        let conn = self.get_connection()?;

        conn.query_row(
            "SELECT vocabulary_stats, expression_stats, app_usage_stats, time_pattern_stats,
                    communication_style, tone_preference, style_prompt, feedback_style,
                    last_analyzed_at, updated_at
             FROM user_profile WHERE id = 1",
            [],
            |row| {
                Ok(UserProfile {
                    vocabulary_stats: row.get(0)?,
                    expression_stats: row.get(1)?,
                    app_usage_stats: row.get(2)?,
                    time_pattern_stats: row.get(3)?,
                    communication_style: row.get(4)?,
                    tone_preference: row.get(5)?,
                    style_prompt: row.get(6)?,
                    feedback_style: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "encouraging".to_string()),
                    last_analyzed_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            }
        )
    }

    /// Update user profile
    pub fn update_user_profile(&self, profile: &UserProfile) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE user_profile SET
                vocabulary_stats = ?1, expression_stats = ?2, app_usage_stats = ?3,
                time_pattern_stats = ?4, communication_style = ?5, tone_preference = ?6,
                style_prompt = ?7, feedback_style = ?8, last_analyzed_at = ?9, updated_at = ?10
             WHERE id = 1",
            params![
                profile.vocabulary_stats,
                profile.expression_stats,
                profile.app_usage_stats,
                profile.time_pattern_stats,
                profile.communication_style,
                profile.tone_preference,
                profile.style_prompt,
                profile.feedback_style,
                profile.last_analyzed_at,
                now,
            ],
        )?;

        Ok(())
    }

    /// Update only the style_prompt field
    pub fn update_style_prompt(&self, style_prompt: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE user_profile SET style_prompt = ?1, updated_at = ?2 WHERE id = 1",
            params![style_prompt, now],
        )?;

        Ok(())
    }

    /// Update feedback style preference
    pub fn update_feedback_style(&self, feedback_style: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE user_profile SET feedback_style = ?1, updated_at = ?2 WHERE id = 1",
            params![feedback_style, now],
        )?;

        Ok(())
    }

    /// Get entries for a time range (for LLM analysis)
    pub fn get_entries_for_analysis(&self, start_ts: i64, end_ts: i64, limit: usize) -> Result<Vec<AnalysisEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, transcription_text, post_processed_text, app_name, char_count
             FROM transcription_history
             WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0
             ORDER BY timestamp DESC
             LIMIT ?3"
        )?;

        let rows = stmt.query_map(params![start_ts, end_ts, limit as i64], |row| {
            Ok(AnalysisEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                transcription_text: row.get(2)?,
                post_processed_text: row.get(3)?,
                app_name: row.get(4)?,
                char_count: row.get(5)?,
            })
        })?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnalysisEntry {
    pub id: i64,
    pub timestamp: i64,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub app_name: Option<String>,
    pub char_count: Option<i64>,
}
```

**Step 2: Register module in mod.rs**

Add to `src-tauri/src/managers/mod.rs`:

```rust
pub mod summary;

pub use summary::SummaryManager;
```

**Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src-tauri/src/managers/summary.rs src-tauri/src/managers/mod.rs
git commit -m "feat(backend): add SummaryManager for stats and profile management"
```

---

### Task 2.2: Create Summary Commands

**Files:**

- Create: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create commands file**

```rust
use crate::managers::summary::{Summary, SummaryManager, SummaryStats, UserProfile};
use log::{debug, info};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_summary_stats(
    summary_manager: State<'_, Arc<SummaryManager>>,
    period_type: String,
    start_ts: i64,
    end_ts: i64,
) -> Result<SummaryStats, String> {
    summary_manager
        .calculate_stats(start_ts, end_ts)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_or_create_summary(
    summary_manager: State<'_, Arc<SummaryManager>>,
    period_type: String,
    start_ts: i64,
    end_ts: i64,
) -> Result<Summary, String> {
    summary_manager
        .get_or_create_summary(&period_type, start_ts, end_ts)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_summary_list(
    summary_manager: State<'_, Arc<SummaryManager>>,
) -> Result<Vec<Summary>, String> {
    summary_manager
        .get_summary_list()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_profile(
    summary_manager: State<'_, Arc<SummaryManager>>,
) -> Result<UserProfile, String> {
    summary_manager
        .get_user_profile()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_feedback_style(
    summary_manager: State<'_, Arc<SummaryManager>>,
    feedback_style: String,
) -> Result<(), String> {
    summary_manager
        .update_feedback_style(&feedback_style)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_style_prompt(
    summary_manager: State<'_, Arc<SummaryManager>>,
    style_prompt: String,
) -> Result<(), String> {
    summary_manager
        .update_style_prompt(&style_prompt)
        .map_err(|e| e.to_string())
}
```

**Step 2: Register in mod.rs**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod summary;
```

**Step 3: Register manager and commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the `run()` function:

1. Import at top:

```rust
use managers::SummaryManager;
```

2. Create manager after history_manager (they share the same db_path):

```rust
let summary_manager = Arc::new(SummaryManager::new(db_path.clone()));
```

3. Register state:

```rust
.manage(summary_manager)
```

4. Add commands to invoke_handler:

```rust
commands::summary::get_summary_stats,
commands::summary::get_or_create_summary,
commands::summary::get_summary_list,
commands::summary::get_user_profile,
commands::summary::update_feedback_style,
commands::summary::update_style_prompt,
```

**Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add src-tauri/src/commands/summary.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add summary commands for frontend communication"
```

---

## Phase 3: Frontend - Summary Page UI (P1)

### Task 3.1: Create TypeScript Types

**Files:**

- Create: `src/components/settings/summary/summaryTypes.ts`

**Step 1: Create types file**

```typescript
export interface AppStats {
  count: number;
  chars: number;
}

export interface SummaryStats {
  entry_count: number;
  total_duration_ms: number;
  total_chars: number;
  llm_calls: number;
  by_app: Record<string, AppStats>;
  by_hour: number[];
  top_skills: string[];
}

export interface Summary {
  id: number;
  period_type: string;
  period_start: number;
  period_end: number;
  stats: SummaryStats;
  ai_summary: string | null;
  ai_reflection: string | null;
  ai_generated_at: number | null;
  ai_model_used: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserProfile {
  vocabulary_stats: string | null;
  expression_stats: string | null;
  app_usage_stats: string | null;
  time_pattern_stats: string | null;
  communication_style: string | null;
  tone_preference: string | null;
  style_prompt: string | null;
  feedback_style: string;
  last_analyzed_at: number | null;
  updated_at: number;
}

export type PeriodType = "day" | "week" | "month" | "custom";

export type FeedbackStyle = "neutral" | "encouraging" | "direct";

export interface PeriodSelection {
  type: PeriodType;
  startTs: number;
  endTs: number;
  label: string;
}
```

**Step 2: Commit**

```bash
git add src/components/settings/summary/summaryTypes.ts
git commit -m "feat(frontend): add TypeScript types for summary feature"
```

---

### Task 3.2: Create Summary Hook

**Files:**

- Create: `src/components/settings/summary/hooks/useSummary.ts`

**Step 1: Create hook file**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type {
  PeriodSelection,
  Summary,
  SummaryStats,
  UserProfile,
} from "../summaryTypes";

export function useSummary() {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryList, setSummaryList] = useState<Summary[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Load summary list on mount
  useEffect(() => {
    loadSummaryList();
    loadUserProfile();
  }, []);

  const loadSummaryList = useCallback(async () => {
    try {
      const list = await invoke<Summary[]>("get_summary_list");
      setSummaryList(list);
    } catch (error) {
      console.error("Failed to load summary list:", error);
    }
  }, []);

  const loadUserProfile = useCallback(async () => {
    try {
      const profile = await invoke<UserProfile>("get_user_profile");
      setUserProfile(profile);
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }
  }, []);

  const loadStats = useCallback(async (selection: PeriodSelection) => {
    setLoading(true);
    try {
      const result = await invoke<SummaryStats>("get_summary_stats", {
        periodType: selection.type,
        startTs: selection.startTs,
        endTs: selection.endTs,
      });
      setStats(result);
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async (selection: PeriodSelection) => {
    setLoading(true);
    try {
      const result = await invoke<Summary>("get_or_create_summary", {
        periodType: selection.type,
        startTs: selection.startTs,
        endTs: selection.endTs,
      });
      setSummary(result);
      setStats(result.stats);
    } catch (error) {
      console.error("Failed to load summary:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateFeedbackStyle = useCallback(
    async (style: string) => {
      try {
        await invoke("update_feedback_style", { feedbackStyle: style });
        await loadUserProfile();
      } catch (error) {
        console.error("Failed to update feedback style:", error);
      }
    },
    [loadUserProfile],
  );

  const updateStylePrompt = useCallback(
    async (prompt: string) => {
      try {
        await invoke("update_style_prompt", { stylePrompt: prompt });
        await loadUserProfile();
      } catch (error) {
        console.error("Failed to update style prompt:", error);
      }
    },
    [loadUserProfile],
  );

  return {
    stats,
    summary,
    summaryList,
    userProfile,
    loading,
    generating,
    loadStats,
    loadSummary,
    loadSummaryList,
    loadUserProfile,
    updateFeedbackStyle,
    updateStylePrompt,
  };
}
```

**Step 2: Commit**

```bash
git add src/components/settings/summary/hooks/useSummary.ts
git commit -m "feat(frontend): add useSummary hook for data management"
```

---

### Task 3.3: Create Summary Stats Component

**Files:**

- Create: `src/components/settings/summary/SummaryStats.tsx`

**Step 1: Create stats component**

```typescript
import { Box, Flex, Grid, Text } from "@radix-ui/themes";
import {
  IconClock,
  IconFileText,
  IconHash,
  IconSparkles,
} from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SummaryStats as SummaryStatsType } from "./summaryTypes";

interface SummaryStatsProps {
  stats: SummaryStatsType | null;
  loading: boolean;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 1000).toFixed(1)}k`;
  return num.toLocaleString();
}

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
}> = ({ icon, label, value, subValue }) => (
  <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
    <Flex align="center" gap="2" mb="2">
      <Box className="text-(--gray-9)">{icon}</Box>
      <Text size="1" color="gray">
        {label}
      </Text>
    </Flex>
    <Text size="6" weight="bold" className="block">
      {value}
    </Text>
    {subValue && (
      <Text size="1" color="gray">
        {subValue}
      </Text>
    )}
  </Box>
);

export const SummaryStatsCards: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  if (loading || !stats) {
    return (
      <Grid columns="4" gap="4">
        {[1, 2, 3, 4].map((i) => (
          <Box
            key={i}
            className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4) animate-pulse h-24"
          />
        ))}
      </Grid>
    );
  }

  return (
    <Grid columns="4" gap="4">
      <StatCard
        icon={<IconHash size={16} />}
        label={t("summary.stats.entries")}
        value={stats.entry_count.toString()}
      />
      <StatCard
        icon={<IconFileText size={16} />}
        label={t("summary.stats.chars")}
        value={formatNumber(stats.total_chars)}
      />
      <StatCard
        icon={<IconClock size={16} />}
        label={t("summary.stats.duration")}
        value={formatDuration(stats.total_duration_ms)}
      />
      <StatCard
        icon={<IconSparkles size={16} />}
        label={t("summary.stats.aiCalls")}
        value={stats.llm_calls.toString()}
      />
    </Grid>
  );
};

export const SummaryAppDistribution: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  const sortedApps = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.by_app)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5);
  }, [stats]);

  const maxCount = useMemo(() => {
    if (sortedApps.length === 0) return 1;
    return Math.max(...sortedApps.map(([, s]) => s.count));
  }, [sortedApps]);

  if (loading || !stats) {
    return (
      <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4) animate-pulse h-40" />
    );
  }

  if (sortedApps.length === 0) {
    return (
      <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
        <Text size="2" color="gray">
          {t("summary.stats.noApps")}
        </Text>
      </Box>
    );
  }

  return (
    <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
      <Text size="2" weight="medium" mb="3" className="block">
        {t("summary.stats.appDistribution")}
      </Text>
      <Flex direction="column" gap="2">
        {sortedApps.map(([appName, appStats]) => (
          <Flex key={appName} align="center" gap="3">
            <Text size="1" className="w-24 truncate">
              {appName}
            </Text>
            <Box className="flex-1 h-2 bg-(--gray-4) rounded-full overflow-hidden">
              <Box
                className="h-full bg-(--accent-9) rounded-full transition-all"
                style={{ width: `${(appStats.count / maxCount) * 100}%` }}
              />
            </Box>
            <Text size="1" color="gray" className="w-12 text-right">
              {appStats.count}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
};

export const SummaryHourlyChart: React.FC<SummaryStatsProps> = ({
  stats,
  loading,
}) => {
  const { t } = useTranslation();

  const maxHour = useMemo(() => {
    if (!stats) return 1;
    return Math.max(1, ...stats.by_hour);
  }, [stats]);

  if (loading || !stats) {
    return (
      <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4) animate-pulse h-40" />
    );
  }

  return (
    <Box className="bg-(--gray-2) rounded-lg p-4 border border-(--gray-4)">
      <Text size="2" weight="medium" mb="3" className="block">
        {t("summary.stats.timeDistribution")}
      </Text>
      <Flex gap="1" align="end" className="h-20">
        {stats.by_hour.map((count, hour) => (
          <Box
            key={hour}
            className="flex-1 bg-(--accent-9) rounded-t-sm transition-all hover:bg-(--accent-10)"
            style={{
              height: `${(count / maxHour) * 100}%`,
              minHeight: count > 0 ? "4px" : "0",
            }}
            title={`${hour}:00 - ${count} entries`}
          />
        ))}
      </Flex>
      <Flex justify="between" mt="1">
        <Text size="1" color="gray">
          0
        </Text>
        <Text size="1" color="gray">
          12
        </Text>
        <Text size="1" color="gray">
          24
        </Text>
      </Flex>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/settings/summary/SummaryStats.tsx
git commit -m "feat(frontend): add summary statistics components"
```

---

### Task 3.4: Create Summary Timeline Component

**Files:**

- Create: `src/components/settings/summary/SummaryTimeline.tsx`

**Step 1: Create timeline component**

```typescript
import { Box, Flex, Text } from "@radix-ui/themes";
import { IconCalendar, IconSparkles } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PeriodSelection, Summary } from "./summaryTypes";

interface SummaryTimelineProps {
  summaryList: Summary[];
  currentSelection: PeriodSelection | null;
  onSelectSummary: (summary: Summary) => void;
}

function formatPeriodLabel(summary: Summary): string {
  const start = new Date(summary.period_start * 1000);

  if (summary.period_type === "day") {
    return start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  }

  if (summary.period_type === "week") {
    const end = new Date(summary.period_end * 1000);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  if (summary.period_type === "month") {
    return start.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }

  return `${start.toLocaleDateString()} - ${new Date(summary.period_end * 1000).toLocaleDateString()}`;
}

export const SummaryTimeline: React.FC<SummaryTimelineProps> = ({
  summaryList,
  currentSelection,
  onSelectSummary,
}) => {
  const { t } = useTranslation();

  const groupedSummaries = useMemo(() => {
    const groups: Record<string, Summary[]> = {
      day: [],
      week: [],
      month: [],
    };

    for (const summary of summaryList) {
      if (groups[summary.period_type]) {
        groups[summary.period_type].push(summary);
      }
    }

    return groups;
  }, [summaryList]);

  const isSelected = (summary: Summary) => {
    if (!currentSelection) return false;
    return (
      summary.period_start === currentSelection.startTs &&
      summary.period_end === currentSelection.endTs
    );
  };

  return (
    <Box className="space-y-4">
      <Text size="2" weight="medium" color="gray">
        {t("summary.timeline.title")}
      </Text>

      {/* Days */}
      {groupedSummaries.day.length > 0 && (
        <Box>
          <Text size="1" color="gray" mb="2" className="block uppercase">
            {t("summary.timeline.days")}
          </Text>
          <Flex direction="column" gap="1">
            {groupedSummaries.day.slice(0, 7).map((summary) => (
              <TimelineItem
                key={summary.id}
                summary={summary}
                selected={isSelected(summary)}
                onClick={() => onSelectSummary(summary)}
              />
            ))}
          </Flex>
        </Box>
      )}

      {/* Weeks */}
      {groupedSummaries.week.length > 0 && (
        <Box>
          <Text size="1" color="gray" mb="2" className="block uppercase">
            {t("summary.timeline.weeks")}
          </Text>
          <Flex direction="column" gap="1">
            {groupedSummaries.week.slice(0, 4).map((summary) => (
              <TimelineItem
                key={summary.id}
                summary={summary}
                selected={isSelected(summary)}
                onClick={() => onSelectSummary(summary)}
              />
            ))}
          </Flex>
        </Box>
      )}

      {/* Months */}
      {groupedSummaries.month.length > 0 && (
        <Box>
          <Text size="1" color="gray" mb="2" className="block uppercase">
            {t("summary.timeline.months")}
          </Text>
          <Flex direction="column" gap="1">
            {groupedSummaries.month.slice(0, 3).map((summary) => (
              <TimelineItem
                key={summary.id}
                summary={summary}
                selected={isSelected(summary)}
                onClick={() => onSelectSummary(summary)}
              />
            ))}
          </Flex>
        </Box>
      )}

      {summaryList.length === 0 && (
        <Text size="2" color="gray">
          {t("summary.timeline.empty")}
        </Text>
      )}
    </Box>
  );
};

const TimelineItem: React.FC<{
  summary: Summary;
  selected: boolean;
  onClick: () => void;
}> = ({ summary, selected, onClick }) => {
  return (
    <Flex
      align="center"
      justify="between"
      px="3"
      py="2"
      className={`rounded-md cursor-pointer transition-colors ${
        selected
          ? "bg-(--accent-a3) text-(--accent-11)"
          : "hover:bg-(--gray-3) text-(--gray-11)"
      }`}
      onClick={onClick}
    >
      <Flex align="center" gap="2">
        <IconCalendar size={14} />
        <Text size="2">{formatPeriodLabel(summary)}</Text>
      </Flex>
      {summary.ai_summary && (
        <IconSparkles size={14} className="text-(--accent-9)" />
      )}
    </Flex>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/settings/summary/SummaryTimeline.tsx
git commit -m "feat(frontend): add summary timeline sidebar component"
```

---

### Task 3.5: Create Main Summary Page

**Files:**

- Create: `src/components/settings/summary/SummaryPage.tsx`

**Step 1: Create main page component**

```typescript
import { Box, Button, Flex, Heading, SegmentedControl, Text } from "@radix-ui/themes";
import { IconCalendar, IconDownload, IconSparkles } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SummaryAppDistribution,
  SummaryHourlyChart,
  SummaryStatsCards,
} from "./SummaryStats";
import { SummaryTimeline } from "./SummaryTimeline";
import { useSummary } from "./hooks/useSummary";
import type { PeriodSelection, PeriodType, Summary } from "./summaryTypes";

function getPeriodSelection(
  type: PeriodType,
  customStart?: number,
  customEnd?: number,
): PeriodSelection {
  const now = new Date();
  let startTs: number;
  let endTs: number;
  let label: string;

  switch (type) {
    case "day": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(now.getTime() / 1000);
      label = "Today";
      break;
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(now.getTime() / 1000);
      label = "This Week";
      break;
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      startTs = Math.floor(start.getTime() / 1000);
      endTs = Math.floor(now.getTime() / 1000);
      label = "This Month";
      break;
    }
    case "custom": {
      startTs = customStart || Math.floor(now.getTime() / 1000) - 86400 * 7;
      endTs = customEnd || Math.floor(now.getTime() / 1000);
      label = "Custom Range";
      break;
    }
  }

  return { type, startTs, endTs, label };
}

export const SummaryPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    stats,
    summary,
    summaryList,
    userProfile,
    loading,
    generating,
    loadStats,
    loadSummary,
  } = useSummary();

  const [periodType, setPeriodType] = useState<PeriodType>("day");
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    getPeriodSelection("day"),
  );

  // Load data when selection changes
  useEffect(() => {
    loadSummary(selection);
  }, [selection, loadSummary]);

  const handlePeriodChange = useCallback((value: string) => {
    const type = value as PeriodType;
    setPeriodType(type);
    setSelection(getPeriodSelection(type));
  }, []);

  const handleSelectSummary = useCallback((summary: Summary) => {
    setSelection({
      type: summary.period_type as PeriodType,
      startTs: summary.period_start,
      endTs: summary.period_end,
      label: summary.period_type,
    });
  }, []);

  return (
    <Box className="w-full max-w-6xl mx-auto">
      <Flex gap="6">
        {/* Sidebar */}
        <Box className="w-56 shrink-0">
          {/* Period Selector */}
          <Box mb="6">
            <Text size="2" weight="medium" color="gray" mb="2" className="block">
              {t("summary.periodSelector.title")}
            </Text>
            <SegmentedControl.Root
              value={periodType}
              onValueChange={handlePeriodChange}
              size="1"
            >
              <SegmentedControl.Item value="day">
                {t("summary.periodSelector.day")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="week">
                {t("summary.periodSelector.week")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="month">
                {t("summary.periodSelector.month")}
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Box>

          {/* Timeline */}
          <SummaryTimeline
            summaryList={summaryList}
            currentSelection={selection}
            onSelectSummary={handleSelectSummary}
          />
        </Box>

        {/* Main Content */}
        <Box className="flex-1 space-y-6">
          {/* Header */}
          <Flex justify="between" align="center">
            <Heading size="5">{selection.label}</Heading>
            <Flex gap="2">
              <Button variant="soft" size="2">
                <IconDownload size={16} />
                {t("summary.actions.export")}
              </Button>
            </Flex>
          </Flex>

          {/* Stats Cards */}
          <SummaryStatsCards stats={stats} loading={loading} />

          {/* Charts Row */}
          <Flex gap="4">
            <Box className="flex-1">
              <SummaryAppDistribution stats={stats} loading={loading} />
            </Box>
            <Box className="flex-1">
              <SummaryHourlyChart stats={stats} loading={loading} />
            </Box>
          </Flex>

          {/* AI Analysis Section */}
          <Box className="bg-(--gray-2) rounded-lg p-6 border border-(--gray-4)">
            <Flex justify="between" align="center" mb="4">
              <Flex align="center" gap="2">
                <IconSparkles size={20} className="text-(--accent-9)" />
                <Text size="3" weight="medium">
                  {t("summary.aiAnalysis.title")}
                </Text>
              </Flex>
              <Button variant="soft" size="2" disabled={generating}>
                <IconSparkles size={16} />
                {generating
                  ? t("summary.aiAnalysis.generating")
                  : t("summary.aiAnalysis.generate")}
              </Button>
            </Flex>

            {summary?.ai_summary ? (
              <Box className="space-y-4">
                <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                  <Text size="2" weight="medium" mb="2" className="block">
                    {t("summary.aiAnalysis.communicationStyle")}
                  </Text>
                  <Text size="2" color="gray">
                    {summary.ai_summary}
                  </Text>
                </Box>

                {summary.ai_reflection && (
                  <Box className="bg-(--gray-1) rounded-md p-4 border border-(--gray-3)">
                    <Text size="2" weight="medium" mb="2" className="block">
                      {t("summary.aiAnalysis.reflection")}
                    </Text>
                    <Text size="2" color="gray">
                      {summary.ai_reflection}
                    </Text>
                  </Box>
                )}

                <Flex justify="end" gap="2">
                  <Button variant="ghost" size="1">
                    {t("summary.aiAnalysis.updateProfile")}
                  </Button>
                </Flex>
              </Box>
            ) : (
              <Text size="2" color="gray">
                {t("summary.aiAnalysis.empty")}
              </Text>
            )}
          </Box>

          {/* User Profile Quick View */}
          {userProfile?.style_prompt && (
            <Box className="bg-(--accent-a2) rounded-lg p-4 border border-(--accent-a4)">
              <Text size="2" weight="medium" mb="2" className="block">
                {t("summary.userProfile.currentStyle")}
              </Text>
              <Text size="2" className="italic">
                {userProfile.style_prompt}
              </Text>
            </Box>
          )}
        </Box>
      </Flex>
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/settings/summary/SummaryPage.tsx
git commit -m "feat(frontend): add main SummaryPage component"
```

---

### Task 3.6: Add Summary to Sidebar Navigation

**Files:**

- Modify: `src/components/Sidebar.tsx`
- Modify: `src/i18n/locales/en/translation.json`
- Modify: `src/i18n/locales/zh/translation.json`

**Step 1: Add lazy import in Sidebar.tsx**

After the existing lazy imports, add:

```typescript
const SummaryPage = lazy(() =>
  import("./settings/summary/SummaryPage").then((m) => ({
    default: m.SummaryPage,
  })),
);
```

**Step 2: Add icon import**

Add `IconChartBar` to the tabler icons import.

**Step 3: Add section config**

In `SECTIONS_CONFIG`, add after `dashboard`:

```typescript
summary: {
  labelKey: "sidebar.summary",
  icon: IconChartBar,
  component: SummaryPage,
  enabled: () => true,
  shortcutKey: "s",
},
```

**Step 4: Update SECTION_ORDER**

Add `"summary"` after `"dashboard"` in the array.

**Step 5: Add translations**

In `en/translation.json`, add:

```json
"sidebar": {
  "summary": "Summary"
},
"summary": {
  "periodSelector": {
    "title": "Time Range",
    "day": "Today",
    "week": "Week",
    "month": "Month"
  },
  "stats": {
    "entries": "Entries",
    "chars": "Characters",
    "duration": "Duration",
    "aiCalls": "AI Calls",
    "noApps": "No app data",
    "appDistribution": "App Distribution",
    "timeDistribution": "Time Distribution"
  },
  "timeline": {
    "title": "History",
    "days": "Days",
    "weeks": "Weeks",
    "months": "Months",
    "empty": "No summaries yet"
  },
  "actions": {
    "export": "Export"
  },
  "aiAnalysis": {
    "title": "AI Analysis",
    "generate": "Generate Analysis",
    "generating": "Generating...",
    "communicationStyle": "Communication Style",
    "reflection": "Reflection & Suggestions",
    "empty": "Click 'Generate Analysis' to get AI-powered insights about your communication patterns.",
    "updateProfile": "Update Profile"
  },
  "userProfile": {
    "currentStyle": "Current Style Profile"
  }
}
```

In `zh/translation.json`, add equivalent Chinese translations.

**Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/i18n/locales/en/translation.json src/i18n/locales/zh/translation.json
git commit -m "feat(frontend): integrate SummaryPage into sidebar navigation"
```

---

## Phase 4: AI Analysis Generation (P2)

### Task 4.1: Add AI Analysis Command

**Files:**

- Modify: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/managers/summary.rs`

**Step 1: Add LLM integration to summary manager**

In `summary.rs` manager, add method for generating AI analysis using existing post_process infrastructure.

**Step 2: Add command for generating analysis**

```rust
#[tauri::command]
pub async fn generate_summary_ai_analysis(
    app: AppHandle,
    summary_manager: State<'_, Arc<SummaryManager>>,
    summary_id: i64,
) -> Result<Summary, String> {
    // Implementation that calls LLM and updates summary
}
```

**Step 3: Commit**

```bash
git add src-tauri/src/commands/summary.rs src-tauri/src/managers/summary.rs
git commit -m "feat(backend): add AI analysis generation for summaries"
```

---

### Task 4.2: Integrate Style Prompt into Post-Process

**Files:**

- Modify: `src-tauri/src/actions/post_process.rs`

**Step 1: Load user profile at start of post_process**

**Step 2: Append style_prompt to system prompt if available**

**Step 3: Commit**

```bash
git add src-tauri/src/actions/post_process.rs
git commit -m "feat(backend): inject user profile style into polish prompts"
```

---

## Phase 5: Export Functionality (P3)

### Task 5.1: Add Export Commands

**Files:**

- Modify: `src-tauri/src/commands/summary.rs`

**Step 1: Add export_summary command**

```rust
#[tauri::command]
pub async fn export_summary(
    summary_manager: State<'_, Arc<SummaryManager>>,
    summary_id: i64,
    format: String, // "markdown" | "json"
) -> Result<String, String> {
    // Generate export content
}
```

**Step 2: Commit**

```bash
git add src-tauri/src/commands/summary.rs
git commit -m "feat(backend): add summary export functionality"
```

---

### Task 5.2: Add Frontend Export UI

**Files:**

- Modify: `src/components/settings/summary/SummaryPage.tsx`

**Step 1: Add export dropdown with Markdown/JSON options**

**Step 2: Call export command and trigger download**

**Step 3: Commit**

```bash
git add src/components/settings/summary/SummaryPage.tsx
git commit -m "feat(frontend): add export dropdown to summary page"
```

---

## Final Verification

### Verification Steps

1. Run `bun tauri dev`
2. Navigate to Summary page from sidebar
3. Verify stats load for Today/Week/Month
4. Check timeline shows cached summaries
5. Test export functionality
6. Verify AI analysis generates and caches
7. Check style_prompt injection in polish workflow

---

## Implementation Notes

- All database operations use existing rusqlite pattern from history.rs
- LLM calls reuse existing post_process infrastructure
- Frontend follows existing component patterns (Radix UI, Tailwind)
- i18n keys follow existing naming conventions
- State management uses React hooks (no Zustand needed)
