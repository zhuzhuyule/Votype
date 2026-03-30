# LLM Call Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every LLM call's performance data (speed, tokens, duration) to SQLite, with 40-day detail retention and long-term aggregated stats, and show historical average speed on hover in the candidate panel.

**Architecture:** Two new tables (`llm_call_log` detail, `llm_call_stats` aggregate) in the existing `history.db`. A new `llm_metrics.rs` manager handles all DB operations. Each LLM call site (intent, single polish, multi-model, rewrite) writes a record via this manager. Frontend adds a tooltip comparing current speed to historical average.

**Tech Stack:** Rust (rusqlite, serde), TypeScript/React (Radix Tooltip), Tauri commands

---

## File Structure

| File                                               | Action | Responsibility                                                                                                              |
| -------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/managers/llm_metrics.rs`            | Create | DB operations: migration SQL, `log_call()`, `get_model_avg_speed()`, `get_all_model_speed_stats()`, `compact_old_entries()` |
| `src-tauri/src/managers/mod.rs`                    | Modify | Add `pub mod llm_metrics;`                                                                                                  |
| `src-tauri/src/managers/history.rs`                | Modify | Add migration for new tables; call `compact_old_entries()` in cleanup                                                       |
| `src-tauri/src/actions/post_process/extensions.rs` | Modify | Log multi-model calls after each candidate completes                                                                        |
| `src-tauri/src/actions/post_process/pipeline.rs`   | Modify | Log intent, single-model, and rewrite calls; propagate model/provider info                                                  |
| `src-tauri/src/actions/post_process/mod.rs`        | Modify | Add model/provider fields to `IntentDecision` and `PipelineResult::SingleModel`                                             |
| `src-tauri/src/actions/transcribe.rs`              | Modify | Stop writing `token_count`/`llm_call_count` to history                                                                      |
| `src-tauri/src/commands/mod.rs`                    | Modify | Register new command                                                                                                        |
| `src-tauri/src/commands/history.rs`                | Modify | Add `get_model_speed_stats` command                                                                                         |
| `src-tauri/src/lib.rs`                             | Modify | Register `LlmMetricsManager` state + new command                                                                            |
| `src/review/CandidatePanel.tsx`                    | Modify | Add speed tooltip with historical comparison                                                                                |

---

### Task 1: Create `llm_metrics.rs` — Database Schema and Core Operations

**Files:**

- Create: `src-tauri/src/managers/llm_metrics.rs`
- Modify: `src-tauri/src/managers/mod.rs`

- [ ] **Step 1: Create the module file with struct and migration SQL**

```rust
// src-tauri/src/managers/llm_metrics.rs
use anyhow::Result;
use log::{debug, error, info};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// SQL statements for creating the llm_call_log and llm_call_stats tables.
/// These are applied as a single migration in history.rs MIGRATIONS array.
pub const MIGRATION_SQL: &str = "
CREATE TABLE IF NOT EXISTS llm_call_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    history_id INTEGER,
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    call_type TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    token_estimate REAL,
    duration_ms INTEGER NOT NULL,
    tokens_per_sec REAL,
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lcl_history ON llm_call_log(history_id);
CREATE INDEX IF NOT EXISTS idx_lcl_model ON llm_call_log(model_id, provider);
CREATE INDEX IF NOT EXISTS idx_lcl_created ON llm_call_log(created_at);
CREATE INDEX IF NOT EXISTS idx_lcl_type ON llm_call_log(call_type);

CREATE TABLE IF NOT EXISTS llm_call_stats (
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    call_type TEXT NOT NULL,
    avg_speed REAL NOT NULL DEFAULT 0,
    avg_tokens REAL NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_calls INTEGER NOT NULL DEFAULT 0,
    total_errors INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL,
    PRIMARY KEY (model_id, provider, call_type)
);
";

#[derive(Debug, Clone)]
pub struct LlmCallRecord {
    pub history_id: Option<i64>,
    pub model_id: String,
    pub provider: String,
    pub call_type: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub token_estimate: Option<f64>,
    pub duration_ms: i64,
    pub tokens_per_sec: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedStats {
    pub model_id: String,
    pub provider: String,
    pub call_type: String,
    pub avg_speed: f64,
    pub total_calls: i64,
}

pub struct LlmMetricsManager {
    db_path: PathBuf,
}

impl LlmMetricsManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        Ok(conn)
    }
}
```

- [ ] **Step 2: Add `pub mod llm_metrics;` to managers/mod.rs**

Open `src-tauri/src/managers/mod.rs` and add:

```rust
pub mod llm_metrics;
```

- [ ] **Step 3: Implement `log_call()`**

Add to `impl LlmMetricsManager` in `llm_metrics.rs`:

```rust
    /// Insert a single LLM call record.
    pub fn log_call(&self, record: &LlmCallRecord) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO llm_call_log (history_id, model_id, provider, call_type, input_tokens, output_tokens, total_tokens, token_estimate, duration_ms, tokens_per_sec, error, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                record.history_id,
                record.model_id,
                record.provider,
                record.call_type,
                record.input_tokens,
                record.output_tokens,
                record.total_tokens,
                record.token_estimate,
                record.duration_ms,
                record.tokens_per_sec,
                record.error,
                now,
            ],
        )?;
        debug!(
            "[LlmMetrics] Logged call: model={} provider={} type={} speed={:?} tokens={:?}",
            record.model_id, record.provider, record.call_type, record.tokens_per_sec, record.total_tokens
        );
        Ok(())
    }
```

- [ ] **Step 4: Implement `get_model_avg_speed()`**

Add to `impl LlmMetricsManager`:

```rust
    /// Get the historical average speed for a specific model+provider+call_type.
    /// Combines aggregated stats with recent detail records using weighted average.
    pub fn get_model_avg_speed(
        &self,
        model_id: &str,
        provider: &str,
        call_type: &str,
    ) -> Result<Option<ModelSpeedStats>> {
        let conn = self.get_connection()?;

        // Get aggregated stats
        let stats_row: Option<(f64, i64)> = conn
            .query_row(
                "SELECT avg_speed, total_calls FROM llm_call_stats WHERE model_id = ?1 AND provider = ?2 AND call_type = ?3",
                params![model_id, provider, call_type],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        // Get recent detail stats
        let recent_row: Option<(f64, i64)> = conn
            .query_row(
                "SELECT AVG(tokens_per_sec), COUNT(*) FROM llm_call_log WHERE model_id = ?1 AND provider = ?2 AND call_type = ?3 AND tokens_per_sec IS NOT NULL",
                params![model_id, provider, call_type],
                |row| {
                    let avg: Option<f64> = row.get(0)?;
                    let count: i64 = row.get(1)?;
                    Ok(avg.map(|a| (a, count)))
                },
            )
            .ok()
            .flatten();

        // Weighted average
        let (avg_speed, total_calls) = match (stats_row, recent_row) {
            (Some((s_avg, s_count)), Some((r_avg, r_count))) if s_count > 0 && r_count > 0 => {
                let total = s_count + r_count;
                let avg = (s_avg * s_count as f64 + r_avg * r_count as f64) / total as f64;
                (avg, total)
            }
            (Some((s_avg, s_count)), _) if s_count > 0 => (s_avg, s_count),
            (_, Some((r_avg, r_count))) if r_count > 0 => (r_avg, r_count),
            _ => return Ok(None),
        };

        Ok(Some(ModelSpeedStats {
            model_id: model_id.to_string(),
            provider: provider.to_string(),
            call_type: call_type.to_string(),
            avg_speed,
            total_calls,
        }))
    }
```

- [ ] **Step 5: Implement `get_all_model_speed_stats()`**

Add to `impl LlmMetricsManager`:

```rust
    /// Get speed stats for all models. Returns combined stats from both tables.
    pub fn get_all_model_speed_stats(&self) -> Result<Vec<ModelSpeedStats>> {
        let conn = self.get_connection()?;

        // Get all unique (model_id, provider, call_type) combinations from both tables
        let mut stmt = conn.prepare(
            "SELECT model_id, provider, call_type FROM llm_call_stats
             UNION
             SELECT DISTINCT model_id, provider, call_type FROM llm_call_log WHERE tokens_per_sec IS NOT NULL"
        )?;

        let keys: Vec<(String, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        drop(stmt);
        drop(conn);

        let mut results = Vec::new();
        for (model_id, provider, call_type) in keys {
            if let Ok(Some(stats)) = self.get_model_avg_speed(&model_id, &provider, &call_type) {
                results.push(stats);
            }
        }
        Ok(results)
    }
```

- [ ] **Step 6: Implement `compact_old_entries()`**

Add to `impl LlmMetricsManager`:

```rust
    /// Compact detail records older than `retention_days` into aggregated stats, then delete them.
    pub fn compact_old_entries(&self, retention_days: u32) -> Result<u64> {
        let conn = self.get_connection()?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();

        // Aggregate old records by (model_id, provider, call_type)
        let mut stmt = conn.prepare(
            "SELECT model_id, provider, call_type, AVG(tokens_per_sec), COUNT(*), COALESCE(SUM(total_tokens), 0), SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)
             FROM llm_call_log
             WHERE created_at < ?1 AND tokens_per_sec IS NOT NULL
             GROUP BY model_id, provider, call_type"
        )?;

        let batches: Vec<(String, String, String, f64, i64, i64, i64)> = stmt
            .query_map(params![cutoff_str], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, f64>(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        drop(stmt);

        let now = chrono::Utc::now().to_rfc3339();
        for (model_id, provider, call_type, batch_avg, batch_count, batch_tokens, batch_errors) in &batches {
            // Upsert into llm_call_stats with weighted average
            let existing: Option<(f64, f64, i64, i64, i64)> = conn
                .query_row(
                    "SELECT avg_speed, avg_tokens, total_tokens, total_calls, total_errors FROM llm_call_stats WHERE model_id = ?1 AND provider = ?2 AND call_type = ?3",
                    params![model_id, provider, call_type],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )
                .ok();

            match existing {
                Some((old_avg_speed, old_avg_tokens, old_total_tokens, old_total_calls, old_total_errors)) => {
                    let new_total_calls = old_total_calls + batch_count;
                    let new_avg_speed = (old_avg_speed * old_total_calls as f64 + batch_avg * *batch_count as f64) / new_total_calls as f64;
                    let batch_avg_tokens = if *batch_count > 0 { *batch_tokens as f64 / *batch_count as f64 } else { 0.0 };
                    let new_avg_tokens = (old_avg_tokens * old_total_calls as f64 + batch_avg_tokens * *batch_count as f64) / new_total_calls as f64;
                    conn.execute(
                        "UPDATE llm_call_stats SET avg_speed = ?1, avg_tokens = ?2, total_tokens = ?3, total_calls = ?4, total_errors = ?5, last_updated = ?6 WHERE model_id = ?7 AND provider = ?8 AND call_type = ?9",
                        params![new_avg_speed, new_avg_tokens, old_total_tokens + batch_tokens, new_total_calls, old_total_errors + batch_errors, now, model_id, provider, call_type],
                    )?;
                }
                None => {
                    let batch_avg_tokens = if *batch_count > 0 { *batch_tokens as f64 / *batch_count as f64 } else { 0.0 };
                    conn.execute(
                        "INSERT INTO llm_call_stats (model_id, provider, call_type, avg_speed, avg_tokens, total_tokens, total_calls, total_errors, last_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![model_id, provider, call_type, batch_avg, batch_avg_tokens, batch_tokens, batch_count, batch_errors, now],
                    )?;
                }
            }
        }

        // Delete compacted detail records
        let deleted = conn.execute(
            "DELETE FROM llm_call_log WHERE created_at < ?1",
            params![cutoff_str],
        )? as u64;

        if deleted > 0 {
            info!("[LlmMetrics] Compacted {} old records into stats", deleted);
        }
        Ok(deleted)
    }
```

- [ ] **Step 7: Verify the module compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | head -20`

Expected: Compiles without errors (tables won't exist yet until migration is added).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/managers/llm_metrics.rs src-tauri/src/managers/mod.rs
git commit -m "Add llm_metrics manager with call logging and compaction"
```

---

### Task 2: Add Database Migration and Register Manager

**Files:**

- Modify: `src-tauri/src/managers/history.rs` (migrations array + cleanup)
- Modify: `src-tauri/src/lib.rs` (register `LlmMetricsManager` state)

- [ ] **Step 1: Add migration to history.rs MIGRATIONS array**

In `src-tauri/src/managers/history.rs`, after the last migration (migration 32, `post_process_rejected`), add:

```rust
    // Migration 33: Add llm_call_log and llm_call_stats tables for model performance tracking
    M::up(crate::managers::llm_metrics::MIGRATION_SQL),
```

- [ ] **Step 2: Call compaction in cleanup_old_entries()**

In `src-tauri/src/managers/history.rs`, modify `cleanup_old_entries()`:

```rust
    pub fn cleanup_old_entries(&self) -> Result<()> {
        // Compact LLM call detail records older than 40 days
        let metrics = crate::managers::llm_metrics::LlmMetricsManager::new(self.db_path.clone());
        if let Err(e) = metrics.compact_old_entries(40) {
            error!("Failed to compact LLM metrics: {}", e);
        }
        // Clean up audio files based on user's retention period setting
        // Database records are kept permanently for historical data
        self.cleanup_audio_files()
    }
```

- [ ] **Step 3: Register `LlmMetricsManager` in lib.rs**

In `src-tauri/src/lib.rs`, inside `initialize_core_logic()`, after HistoryManager is created (around line 155-171), add:

```rust
    let llm_metrics_manager = Arc::new(
        crate::managers::llm_metrics::LlmMetricsManager::new(history_manager.db_path.clone())
    );
    app_handle.manage(llm_metrics_manager);
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | head -20`

Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/managers/history.rs src-tauri/src/lib.rs
git commit -m "Register llm_metrics manager and add migration for call tracking tables"
```

---

### Task 3: Add Model/Provider Info to Pipeline Result Types

**Files:**

- Modify: `src-tauri/src/actions/post_process/mod.rs`
- Modify: `src-tauri/src/actions/post_process/routing.rs`
- Modify: `src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `src-tauri/src/actions/transcribe.rs`

The `IntentDecision` and `PipelineResult::SingleModel` currently don't carry `model_id` and `provider` info needed for logging. We need to thread this data through.

- [ ] **Step 1: Add model/provider to `IntentDecision`**

In `src-tauri/src/actions/post_process/mod.rs`, add fields to `IntentDecision`:

```rust
pub struct IntentDecision {
    pub action: routing::SmartAction,
    pub needs_hotword: bool,
    pub language: Option<String>,
    pub token_count: Option<i64>,
    /// Model ID used for intent analysis
    pub model_id: String,
    /// Provider ID used for intent analysis
    pub provider_id: String,
    /// Duration of the intent LLM call in milliseconds
    pub duration_ms: u64,
}
```

- [ ] **Step 2: Update `execute_smart_action_routing()` to populate new fields**

In `src-tauri/src/actions/post_process/routing.rs`, the function at line 22. Add timing and capture model/provider:

```rust
pub(super) async fn execute_smart_action_routing(
    app_handle: &AppHandle,
    settings: &AppSettings,
    fallback_provider: &PostProcessProvider,
    transcription: &str,
) -> Option<super::IntentDecision> {
    let default_prompt = settings.post_process_prompts.first()?;
    let (provider, model, _api_key) =
        resolve_intent_routing_model(settings, fallback_provider, default_prompt)?;

    let provider_id = provider.id.clone();
    let model_id_for_log = model.clone();

    let prompt_manager = app_handle.state::<Arc<PromptManager>>();
    let system_prompt = prompt_manager
        .get_prompt(app_handle, "system_smart_routing")
        .unwrap_or_else(|_| {
            "You are a text router. Output JSON: {\"action\": \"pass_through|lite_polish|full_polish\", \"needs_hotword\": true|false}".to_string()
        });

    let start = std::time::Instant::now();

    let (result, _err, _error_msg, token_count) = super::core::execute_llm_request(
        app_handle,
        settings,
        provider,
        &model,
        None,
        &system_prompt,
        Some(transcription),
        None,
        None,
        None,
        None,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    let response_text = result?;

    // ... (existing JSON parsing unchanged) ...

    Some(super::IntentDecision {
        action,
        needs_hotword,
        language,
        token_count,
        model_id: model_id_for_log,
        provider_id,
        duration_ms,
    })
}
```

- [ ] **Step 3: Add model_id/provider_id to `PipelineResult::SingleModel`**

In `src-tauri/src/actions/post_process/mod.rs`, update the `SingleModel` variant:

```rust
    SingleModel {
        text: Option<String>,
        model: Option<String>,
        prompt_id: Option<String>,
        token_count: Option<i64>,
        llm_call_count: Option<i64>,
        error: bool,
        error_message: Option<String>,
        /// Model ID used for the polish/rewrite call (for metrics logging)
        metrics_model_id: Option<String>,
        /// Provider ID used for the polish/rewrite call (for metrics logging)
        metrics_provider_id: Option<String>,
        /// Duration of the polish/rewrite LLM call in milliseconds
        metrics_duration_ms: Option<u64>,
        /// Estimated output tokens per second
        metrics_tokens_per_sec: Option<f64>,
    },
```

- [ ] **Step 4: Update `DefaultPolishResult` to carry provider/model info**

In `src-tauri/src/actions/post_process/routing.rs`, update `DefaultPolishResult`:

```rust
pub(super) struct DefaultPolishResult {
    pub text: String,
    pub token_count: Option<i64>,
    pub model_id: String,
    pub provider_id: String,
    pub duration_ms: u64,
}
```

Update `execute_default_polish()` (line 335) to capture and return these fields. The function already has `actual_provider` and `model` variables. Add timing:

Before the `execute_llm_request_with_messages` call (around line 496), add:

```rust
    let polish_start = std::time::Instant::now();
```

Update the return (around line 519):

```rust
    let polish_duration = polish_start.elapsed().as_millis() as u64;
    result.map(|text| DefaultPolishResult {
        text,
        token_count: api_token_count,
        model_id: model.clone(),
        provider_id: actual_provider.id.clone(),
        duration_ms: polish_duration,
    })
```

- [ ] **Step 5: Thread metrics through pipeline.rs to `PipelineResult::SingleModel`**

In `src-tauri/src/actions/post_process/pipeline.rs`, the `maybe_post_process_transcription()` function returns a tuple. We need to also return model_id, provider_id, and duration. This function is complex, so instead of modifying its return type, add the metrics fields when constructing `PipelineResult::SingleModel` at the end of `unified_post_process()` (around line 442).

The simplest approach: after `maybe_post_process_transcription` returns, the `model` field already contains the model name. For single-model cases, we can derive the provider from settings. However, a cleaner approach is to expand the return tuple from `maybe_post_process_transcription`.

Add three more return values to `maybe_post_process_transcription`: `metrics_model_id: Option<String>`, `metrics_provider_id: Option<String>`, `metrics_duration_ms: Option<u64>`.

At line 416 in pipeline.rs, update the destructuring:

```rust
    let (text, model, prompt_id, err, error_message, api_token_count, api_call_count, metrics_model_id, metrics_provider_id, metrics_duration_ms) =
        maybe_post_process_transcription(
            // ... same args ...
        )
        .await;
```

At line 442, update the return:

```rust
    let metrics_tokens_per_sec = match (&text, metrics_duration_ms) {
        (Some(ref t), Some(d)) if d > 0 => {
            let estimate = super::extensions::estimate_tokens(t);
            Some(estimate / d as f64 * 1000.0)
        }
        _ => None,
    };

    super::PipelineResult::SingleModel {
        text,
        model,
        prompt_id,
        token_count: sum_tokens(intent_tokens, api_token_count),
        llm_call_count: sum_counts(
            if intent_tokens.is_some() { Some(1) } else { None },
            api_call_count,
        ),
        error: err,
        error_message,
        metrics_model_id,
        metrics_provider_id,
        metrics_duration_ms,
        metrics_tokens_per_sec,
    }
```

The `maybe_post_process_transcription` function needs to be updated to return these extra fields. Inside it, when calling `execute_votype_rewrite_prompt` or `execute_default_polish`, capture the model/provider/timing info and return it. For the rewrite path, the `resolve_effective_model` call already provides `actual_provider` and `model`. For the default polish path, `DefaultPolishResult` now carries this data.

- [ ] **Step 6: Update `transcribe.rs` to handle new fields**

In `src-tauri/src/actions/transcribe.rs`, update the `PipelineResult::SingleModel` match arm (around line 1346) to destructure the new fields (ignore them for now, they'll be used in Task 4):

```rust
    crate::actions::post_process::PipelineResult::SingleModel {
        text: processed_text,
        model,
        prompt_id,
        token_count: tc,
        llm_call_count: lc,
        error: err,
        error_message,
        metrics_model_id: _,
        metrics_provider_id: _,
        metrics_duration_ms: _,
        metrics_tokens_per_sec: _,
    } => {
        // ... existing logic unchanged ...
    }
```

- [ ] **Step 7: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | head -30`

Expected: Compiles successfully.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/actions/post_process/mod.rs src-tauri/src/actions/post_process/routing.rs src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/actions/transcribe.rs
git commit -m "Thread model/provider/timing info through pipeline result types"
```

---

### Task 4: Log LLM Calls at Each Call Site

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `src-tauri/src/actions/post_process/extensions.rs`
- Modify: `src-tauri/src/actions/transcribe.rs`

- [ ] **Step 1: Log intent analysis calls in pipeline.rs**

In `src-tauri/src/actions/post_process/pipeline.rs`, after the intent analysis call (around line 93-105 in `unified_post_process()`), when `IntentDecision` is returned, log it:

```rust
    // After getting intent_decision
    if let Some(ref decision) = intent_decision {
        if let Some(metrics) = app_handle.try_state::<std::sync::Arc<crate::managers::llm_metrics::LlmMetricsManager>>() {
            let token_estimate = decision.token_count.map(|t| t as f64);
            let tokens_per_sec = match (token_estimate, decision.duration_ms) {
                (Some(est), d) if d > 0 => Some(est / d as f64 * 1000.0),
                _ => None,
            };
            if let Err(e) = metrics.log_call(&crate::managers::llm_metrics::LlmCallRecord {
                history_id,
                model_id: decision.model_id.clone(),
                provider: decision.provider_id.clone(),
                call_type: "intent".to_string(),
                input_tokens: None,
                output_tokens: None,
                total_tokens: decision.token_count,
                token_estimate,
                duration_ms: decision.duration_ms as i64,
                tokens_per_sec,
                error: None,
            }) {
                error!("[LlmMetrics] Failed to log intent call: {}", e);
            }
        }
    }
```

Note: `history_id` may not be available in `unified_post_process`. Check the function signature — if it doesn't have `history_id`, pass `None`.

- [ ] **Step 2: Log single-model polish/rewrite calls in transcribe.rs**

In `src-tauri/src/actions/transcribe.rs`, in the `PipelineResult::SingleModel` match arm, after the existing logic:

```rust
    crate::actions::post_process::PipelineResult::SingleModel {
        text: processed_text,
        model,
        prompt_id,
        token_count: tc,
        llm_call_count: lc,
        error: err,
        error_message,
        metrics_model_id,
        metrics_provider_id,
        metrics_duration_ms,
        metrics_tokens_per_sec,
    } => {
        token_count = tc;
        llm_call_count = lc;
        // ... existing logic ...

        // Log metrics
        if let (Some(m_id), Some(p_id)) = (metrics_model_id, metrics_provider_id) {
            if let Some(metrics) = ah_clone.try_state::<std::sync::Arc<crate::managers::llm_metrics::LlmMetricsManager>>() {
                let call_type = if review_document_text.is_some() { "rewrite" } else { "single_polish" };
                if let Err(e) = metrics.log_call(&crate::managers::llm_metrics::LlmCallRecord {
                    history_id,
                    model_id: m_id,
                    provider: p_id,
                    call_type: call_type.to_string(),
                    input_tokens: None,
                    output_tokens: None,
                    total_tokens: tc,
                    token_estimate: None,
                    duration_ms: metrics_duration_ms.unwrap_or(0) as i64,
                    tokens_per_sec: metrics_tokens_per_sec,
                    error: if err { error_message.clone() } else { None },
                }) {
                    error!("[LlmMetrics] Failed to log single model call: {}", e);
                }
            }
        }
    }
```

- [ ] **Step 3: Log multi-model calls in extensions.rs**

In `src-tauri/src/actions/post_process/extensions.rs`, after each candidate result is built (around line 296-307), log the call. The `item` variable has `provider_id` and `model_id`:

Inside the async block that creates `MultiModelPostProcessResult` (around line 270-308), after building the result struct, add:

```rust
                let result_struct = super::MultiModelPostProcessResult {
                    id: item.id.clone(),
                    label: model_label,
                    provider_label,
                    text,
                    confidence: None,
                    processing_time_ms: elapsed,
                    error: result.1,
                    ready,
                    token_count: result.2,
                    output_speed,
                };

                // Log to metrics
                if let Some(metrics) = app_handle.try_state::<std::sync::Arc<crate::managers::llm_metrics::LlmMetricsManager>>() {
                    if let Err(e) = metrics.log_call(&crate::managers::llm_metrics::LlmCallRecord {
                        history_id,
                        model_id: item.model_id.clone(),
                        provider: item.provider_id.clone(),
                        call_type: "multi_model".to_string(),
                        input_tokens: None,
                        output_tokens: None,
                        total_tokens: result_struct.token_count,
                        token_estimate: output_speed.map(|s| s * elapsed as f64 / 1000.0),
                        duration_ms: elapsed as i64,
                        tokens_per_sec: output_speed,
                        error: result_struct.error.clone(),
                    }) {
                        log::error!("[LlmMetrics] Failed to log multi-model call: {}", e);
                    }
                }

                result_struct
```

Note: `history_id` needs to be passed into `multi_post_process_transcription()`. Check if it's already available — looking at the function signature, it takes `history_id: Option<i64>` (confirmed from transcribe.rs line 1268). Thread it into the async block via clone.

- [ ] **Step 4: Stop writing token_count/llm_call_count to history**

In `src-tauri/src/actions/transcribe.rs`, at the history save calls:

For `update_transcription_with_post_process` (around line 1444), change `token_count` and `llm_call_count` args to `None`:

```rust
    hm_clone.update_transcription_with_post_process(
        history_id,
        final_text.clone(),
        // ... other args unchanged ...
        None, // token_count - now tracked in llm_call_log
        None, // llm_call_count - now tracked in llm_call_log
    )
```

Similarly for `save_post_processed_text` (around line 1298-1306) in the MultiModelManual path:

```rust
    hm_clone.save_post_processed_text(
        hid,
        best.text.clone(),
        Some(model_name),
        settings_clone.post_process_selected_prompt_id.clone(),
        None, // token_count - now tracked in llm_call_log
        None, // llm_call_count - now tracked in llm_call_log
    )
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | head -30`

Expected: Compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/actions/post_process/extensions.rs src-tauri/src/actions/transcribe.rs
git commit -m "Log LLM calls to llm_call_log and stop writing token_count to history"
```

---

### Task 5: Add Tauri Command for Model Speed Stats

**Files:**

- Modify: `src-tauri/src/commands/history.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add command in commands/history.rs**

```rust
#[tauri::command]
pub async fn get_model_speed_stats(
    _app: AppHandle,
    llm_metrics: State<'_, Arc<crate::managers::llm_metrics::LlmMetricsManager>>,
) -> Result<Vec<crate::managers::llm_metrics::ModelSpeedStats>, String> {
    llm_metrics
        .get_all_model_speed_stats()
        .map_err(|e| e.to_string())
}
```

Add the import at the top of the file:

```rust
use crate::managers::llm_metrics::LlmMetricsManager;
```

- [ ] **Step 2: Export command in commands/mod.rs**

Ensure `get_model_speed_stats` is pub-accessible from `commands::history`.

- [ ] **Step 3: Register command in lib.rs**

In `src-tauri/src/lib.rs`, find the command registration block (the large `invoke_handler` call) and add `commands::history::get_model_speed_stats` to the list.

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | head -20`

Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/history.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "Add get_model_speed_stats Tauri command"
```

---

### Task 6: Frontend — Speed Tooltip with Historical Comparison

**Files:**

- Modify: `src/review/CandidatePanel.tsx`

- [ ] **Step 1: Add invoke call to fetch model speed stats**

At the top of `CandidatePanel.tsx`, add the import and type:

```typescript
import { invoke } from "@tauri-apps/api/core";

interface ModelSpeedStats {
  model_id: string;
  provider: string;
  call_type: string;
  avg_speed: number;
  total_calls: number;
}
```

- [ ] **Step 2: Add state and fetch logic in the component**

Inside the `CandidatePanel` component (or the parent that renders candidates), add:

```typescript
const [speedStats, setSpeedStats] = useState<ModelSpeedStats[]>([]);

useEffect(() => {
  invoke<ModelSpeedStats[]>("get_model_speed_stats")
    .then(setSpeedStats)
    .catch((err) => console.warn("Failed to fetch speed stats:", err));
}, []);
```

- [ ] **Step 3: Create helper to find matching historical speed**

```typescript
function findHistoricalSpeed(
  stats: ModelSpeedStats[],
  candidateLabel: string,
  providerLabel: string,
): ModelSpeedStats | undefined {
  // Match by model_id containing the candidate label, for multi_model call type
  return stats.find(
    (s) =>
      s.call_type === "multi_model" &&
      (s.model_id === candidateLabel ||
        candidateLabel.includes(s.model_id) ||
        s.model_id.includes(candidateLabel)),
  );
}
```

- [ ] **Step 4: Add tooltip to speed display**

Replace the current speed display (around line 251-259) with a tooltip version:

```tsx
{
  candidate.output_speed != null && candidate.output_speed > 0 && (
    <>
      <span className="stat-separator">|</span>
      <SpeedWithTooltip
        currentSpeed={candidate.output_speed}
        historicalStats={findHistoricalSpeed(
          speedStats,
          candidate.label,
          candidate.provider_label,
        )}
      />
    </>
  );
}
```

- [ ] **Step 5: Create `SpeedWithTooltip` component**

Add within the same file (or extract if preferred):

```tsx
function SpeedWithTooltip({
  currentSpeed,
  historicalStats,
}: {
  currentSpeed: number;
  historicalStats?: ModelSpeedStats;
}) {
  if (!historicalStats || historicalStats.total_calls < 2) {
    // Not enough history — show plain speed
    return <span className="candidate-speed">{formatSpeed(currentSpeed)}</span>;
  }

  const diff =
    ((currentSpeed - historicalStats.avg_speed) / historicalStats.avg_speed) *
    100;
  const diffLabel =
    diff > 0
      ? `\u2191${Math.abs(diff).toFixed(0)}%`
      : `\u2193${Math.abs(diff).toFixed(0)}%`;

  return (
    <span
      className="candidate-speed"
      title={`历史平均: ${formatSpeed(historicalStats.avg_speed)} (${historicalStats.total_calls} 次)\n本次: ${formatSpeed(currentSpeed)} (${diffLabel})`}
    >
      {formatSpeed(currentSpeed)}
    </span>
  );
}
```

This uses the native `title` attribute for the tooltip, keeping it simple and consistent. If the project already uses a Radix Tooltip elsewhere in this component, match that pattern instead.

- [ ] **Step 6: Verify frontend compiles**

Run: `cd /Users/zac/code/github/asr/Handy && bun build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/review/CandidatePanel.tsx
git commit -m "Add speed tooltip showing historical average comparison"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Build and run the full app**

Run: `cd /Users/zac/code/github/asr/Handy && bun tauri dev`

- [ ] **Step 2: Verify database tables were created**

After the app starts, check the database:

```bash
sqlite3 ~/Library/Application\ Support/com.handy.app/history.db ".tables" | grep llm
```

Expected output should include `llm_call_log` and `llm_call_stats`.

- [ ] **Step 3: Perform a transcription and verify call logging**

Speak a test phrase, then check:

```bash
sqlite3 ~/Library/Application\ Support/com.handy.app/history.db "SELECT * FROM llm_call_log ORDER BY id DESC LIMIT 5;"
```

Expected: At least one row with model_id, provider, call_type, duration_ms, and tokens_per_sec populated.

- [ ] **Step 4: Verify speed tooltip in multi-model mode**

If multi-model is configured, do a second transcription. Hover over the speed value in the candidate panel — after enough calls, the tooltip should show historical average.

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "Fix issues found during end-to-end verification"
```
