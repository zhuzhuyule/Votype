use anyhow::Result;
use log::info;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
            WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0",
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
            ORDER BY count DESC",
        )?;
        let app_rows = app_stmt.query_map(params![start_ts, end_ts], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
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
            GROUP BY hour",
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
            LIMIT 5",
        )?;
        let skill_rows =
            skill_stmt.query_map(
                params![start_ts, end_ts],
                |row| Ok(row.get::<_, String>(0)?),
            )?;
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
    pub fn get_or_create_summary(
        &self,
        period_type: &str,
        start_ts: i64,
        end_ts: i64,
    ) -> Result<Summary> {
        let conn = self.get_connection()?;

        // Try to get existing summary
        let existing: Option<Summary> = conn
            .query_row(
                "SELECT id, period_type, period_start, period_end, stats, ai_summary, ai_reflection,
                    ai_generated_at, ai_model_used, created_at, updated_at
             FROM summaries WHERE period_type = ?1 AND period_start = ?2 AND period_end = ?3",
                params![period_type, start_ts, end_ts],
                |row| {
                    let stats_json: String = row.get(4)?;
                    let stats: SummaryStats =
                        serde_json::from_str(&stats_json).unwrap_or_else(|_| SummaryStats {
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
                },
            )
            .ok();

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

        info!(
            "Updated AI content for summary {}: model={:?}",
            summary_id, model_used
        );

        Ok(())
    }

    /// Get list of cached summaries for sidebar
    pub fn get_summary_list(&self) -> Result<Vec<Summary>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, period_type, period_start, period_end, stats, ai_summary, ai_reflection,
                    ai_generated_at, ai_model_used, created_at, updated_at
             FROM summaries ORDER BY period_start DESC LIMIT 50",
        )?;

        let rows = stmt.query_map([], |row| {
            let stats_json: String = row.get(4)?;
            let stats: SummaryStats =
                serde_json::from_str(&stats_json).unwrap_or_else(|_| SummaryStats {
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
                    feedback_style: row
                        .get::<_, Option<String>>(7)?
                        .unwrap_or_else(|| "encouraging".to_string()),
                    last_analyzed_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .map_err(|e| anyhow::anyhow!("Failed to get user profile: {}", e))
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

        info!("Updated user profile");

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

        info!("Updated style prompt");

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

        info!("Updated feedback style to: {}", feedback_style);

        Ok(())
    }

    /// Get entries for a time range (for LLM analysis)
    pub fn get_entries_for_analysis(
        &self,
        start_ts: i64,
        end_ts: i64,
        limit: usize,
    ) -> Result<Vec<AnalysisEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, transcription_text, post_processed_text, app_name, char_count
             FROM transcription_history
             WHERE timestamp >= ?1 AND timestamp <= ?2 AND deleted = 0
             ORDER BY timestamp DESC
             LIMIT ?3",
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
