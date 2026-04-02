use anyhow::Result;
use log::{debug, info};
use rusqlite::{params, Connection, OptionalExtension};
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
    pub is_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedStats {
    pub model_id: String,
    pub provider: String,
    pub call_type: String,
    pub avg_speed: f64,
    pub total_calls: i64,
}

/// Aggregated LLM usage stats for dashboard display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmUsageStats {
    pub total_calls: i64,
    pub total_tokens: i64,
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

    /// Insert a single LLM call record and incrementally update aggregated stats.
    pub fn log_call(&self, record: &LlmCallRecord) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();

        let tx = conn.unchecked_transaction()?;

        // 1. Insert detail record
        tx.execute(
            "INSERT INTO llm_call_log (history_id, model_id, provider, call_type, input_tokens, output_tokens, total_tokens, token_estimate, duration_ms, tokens_per_sec, error, is_fallback, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                record.is_fallback,
                now,
            ],
        )?;

        // 2. Incrementally update aggregated stats
        let total_tokens_val = record.total_tokens.unwrap_or(0);
        let has_error = record.error.is_some();

        let existing: Option<(f64, i64, f64, i64, i64, i64)> = tx
            .query_row(
                "SELECT avg_speed, speed_count, avg_tokens, total_tokens, total_calls, total_errors
                 FROM llm_call_stats WHERE model_id = ?1 AND provider = ?2 AND call_type = ?3",
                params![record.model_id, record.provider, record.call_type],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()?;

        match existing {
            Some((
                old_avg_speed,
                old_speed_count,
                old_avg_tokens,
                old_total_tokens,
                old_total_calls,
                old_total_errors,
            )) => {
                let new_total_calls = old_total_calls + 1;
                let new_total_tokens = old_total_tokens + total_tokens_val;
                let new_total_errors = old_total_errors + if has_error { 1 } else { 0 };
                let new_avg_tokens = (old_avg_tokens * old_total_calls as f64
                    + total_tokens_val as f64)
                    / new_total_calls as f64;

                let (new_avg_speed, new_speed_count) = if let Some(speed) = record.tokens_per_sec {
                    let sc = old_speed_count + 1;
                    let avg = (old_avg_speed * old_speed_count as f64 + speed) / sc as f64;
                    (avg, sc)
                } else {
                    (old_avg_speed, old_speed_count)
                };

                tx.execute(
                    "UPDATE llm_call_stats SET avg_speed = ?1, speed_count = ?2, avg_tokens = ?3, total_tokens = ?4, total_calls = ?5, total_errors = ?6, last_updated = ?7
                     WHERE model_id = ?8 AND provider = ?9 AND call_type = ?10",
                    params![
                        new_avg_speed,
                        new_speed_count,
                        new_avg_tokens,
                        new_total_tokens,
                        new_total_calls,
                        new_total_errors,
                        now,
                        record.model_id,
                        record.provider,
                        record.call_type,
                    ],
                )?;
            }
            None => {
                let speed = record.tokens_per_sec.unwrap_or(0.0);
                let speed_count: i64 = if record.tokens_per_sec.is_some() {
                    1
                } else {
                    0
                };
                let avg_tokens = total_tokens_val as f64;
                let errors: i64 = if has_error { 1 } else { 0 };

                tx.execute(
                    "INSERT INTO llm_call_stats (model_id, provider, call_type, avg_speed, speed_count, avg_tokens, total_tokens, total_calls, total_errors, last_updated)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        record.model_id,
                        record.provider,
                        record.call_type,
                        speed,
                        speed_count,
                        avg_tokens,
                        total_tokens_val,
                        1i64,
                        errors,
                        now,
                    ],
                )?;
            }
        }

        tx.commit()?;

        debug!(
            "[LlmMetrics] Logged call: model={} provider={} type={} speed={:?} tokens={:?}",
            record.model_id,
            record.provider,
            record.call_type,
            record.tokens_per_sec,
            record.total_tokens
        );
        Ok(())
    }

    /// Get speed stats for all models from llm_call_stats (single query).
    pub fn get_all_model_speed_stats(&self) -> Result<Vec<ModelSpeedStats>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT model_id, provider, call_type, avg_speed, total_calls FROM llm_call_stats WHERE total_calls > 0",
        )?;
        let results = stmt
            .query_map([], |row| {
                Ok(ModelSpeedStats {
                    model_id: row.get(0)?,
                    provider: row.get(1)?,
                    call_type: row.get(2)?,
                    avg_speed: row.get(3)?,
                    total_calls: row.get(4)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }

    /// Delete detail records older than `retention_days`.
    /// Stats are already up-to-date via write-time aggregation, so no re-aggregation needed.
    pub fn compact_old_entries(&self, retention_days: u32) -> Result<u64> {
        let conn = self.get_connection()?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let deleted = conn.execute(
            "DELETE FROM llm_call_log WHERE created_at < ?1",
            params![cutoff_str],
        )? as u64;

        if deleted > 0 {
            info!("[LlmMetrics] Deleted {} old detail records", deleted);
        }
        Ok(deleted)
    }

    /// Get aggregated LLM usage stats for a time range.
    /// - Both None: all-time from llm_call_stats (single source of truth)
    /// - since only: from timestamp to now (detail records)
    /// - since + until: exact range (detail records)
    pub fn get_usage_stats(
        &self,
        since_timestamp: Option<i64>,
        until_timestamp: Option<i64>,
    ) -> Result<LlmUsageStats> {
        let conn = self.get_connection()?;

        // All-time: read directly from llm_call_stats
        if since_timestamp.is_none() && until_timestamp.is_none() {
            return conn
                .query_row(
                    "SELECT COALESCE(SUM(total_calls), 0), COALESCE(SUM(total_tokens), 0) FROM llm_call_stats",
                    [],
                    |row| {
                        Ok(LlmUsageStats {
                            total_calls: row.get(0)?,
                            total_tokens: row.get(1)?,
                        })
                    },
                )
                .map_err(Into::into);
        }

        // Date-range queries use detail records
        let since_str = since_timestamp
            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
            .map(|dt| dt.to_rfc3339());
        let until_str = until_timestamp
            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
            .map(|dt| dt.to_rfc3339());

        let (calls, tokens): (i64, i64) = match (&since_str, &until_str) {
            (Some(s), Some(u)) => conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0) FROM llm_call_log WHERE created_at >= ?1 AND created_at < ?2",
                params![s, u],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?,
            (Some(s), None) => conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0) FROM llm_call_log WHERE created_at >= ?1",
                params![s],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?,
            // Both None handled above
            _ => unreachable!(),
        };

        Ok(LlmUsageStats {
            total_calls: calls,
            total_tokens: tokens,
        })
    }
}
