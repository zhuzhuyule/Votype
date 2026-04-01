use anyhow::Result;
use log::{debug, info};
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

    /// Insert a single LLM call record.
    pub fn log_call(&self, record: &LlmCallRecord) -> Result<()> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
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
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
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
        for (model_id, provider, call_type, batch_avg, batch_count, batch_tokens, batch_errors) in
            &batches
        {
            // Upsert into llm_call_stats with weighted average
            let existing: Option<(f64, f64, i64, i64, i64)> = conn
                .query_row(
                    "SELECT avg_speed, avg_tokens, total_tokens, total_calls, total_errors FROM llm_call_stats WHERE model_id = ?1 AND provider = ?2 AND call_type = ?3",
                    params![model_id, provider, call_type],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )
                .ok();

            match existing {
                Some((
                    old_avg_speed,
                    old_avg_tokens,
                    old_total_tokens,
                    old_total_calls,
                    old_total_errors,
                )) => {
                    let new_total_calls = old_total_calls + batch_count;
                    let new_avg_speed = (old_avg_speed * old_total_calls as f64
                        + batch_avg * *batch_count as f64)
                        / new_total_calls as f64;
                    let batch_avg_tokens = if *batch_count > 0 {
                        *batch_tokens as f64 / *batch_count as f64
                    } else {
                        0.0
                    };
                    let new_avg_tokens = (old_avg_tokens * old_total_calls as f64
                        + batch_avg_tokens * *batch_count as f64)
                        / new_total_calls as f64;
                    conn.execute(
                        "UPDATE llm_call_stats SET avg_speed = ?1, avg_tokens = ?2, total_tokens = ?3, total_calls = ?4, total_errors = ?5, last_updated = ?6 WHERE model_id = ?7 AND provider = ?8 AND call_type = ?9",
                        params![new_avg_speed, new_avg_tokens, old_total_tokens + batch_tokens, new_total_calls, old_total_errors + batch_errors, now, model_id, provider, call_type],
                    )?;
                }
                None => {
                    let batch_avg_tokens = if *batch_count > 0 {
                        *batch_tokens as f64 / *batch_count as f64
                    } else {
                        0.0
                    };
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

    /// Get aggregated LLM usage stats for a time range.
    /// - Both None: all-time (detail + compacted stats)
    /// - since only: from timestamp to now
    /// - since + until: exact range
    pub fn get_usage_stats(
        &self,
        since_timestamp: Option<i64>,
        until_timestamp: Option<i64>,
    ) -> Result<LlmUsageStats> {
        let conn = self.get_connection()?;

        let since_str = since_timestamp
            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
            .map(|dt| dt.to_rfc3339());
        let until_str = until_timestamp
            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
            .map(|dt| dt.to_rfc3339());

        let (detail_calls, detail_tokens): (i64, i64) = match (&since_str, &until_str) {
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
            _ => conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0) FROM llm_call_log",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?,
        };

        // Compacted stats only included for all-time (no range filter)
        let (stats_calls, stats_tokens): (i64, i64) = if since_timestamp.is_none()
            && until_timestamp.is_none()
        {
            conn.query_row(
                    "SELECT COALESCE(SUM(total_calls), 0), COALESCE(SUM(total_tokens), 0) FROM llm_call_stats",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?
        } else {
            (0, 0)
        };

        Ok(LlmUsageStats {
            total_calls: detail_calls + stats_calls,
            total_tokens: detail_tokens + stats_tokens,
        })
    }
}
