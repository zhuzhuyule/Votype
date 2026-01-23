use anyhow::Result;
use chrono::{DateTime, Local, TimeZone, Utc};
use log::{debug, error, info};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

use crate::audio_toolkit::save_wav_file;

/// Database migrations for transcription history.
/// Each migration is applied in order. The library tracks which migrations
/// have been applied using SQLite's user_version pragma.
///
/// Note: For users upgrading from tauri-plugin-sql, migrate_from_tauri_plugin_sql()
/// converts the old _sqlx_migrations table tracking to the user_version pragma,
/// ensuring migrations don't re-run on existing databases.
static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS transcription_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            saved BOOLEAN NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            transcription_text TEXT NOT NULL
        );",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_processed_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_prompt TEXT;"),
    M::up(
        "ALTER TABLE transcription_history ADD COLUMN duration_ms INTEGER;
         ALTER TABLE transcription_history ADD COLUMN char_count INTEGER;
         ALTER TABLE transcription_history ADD COLUMN corrected_char_count INTEGER;",
    ),
    M::up(
        "ALTER TABLE transcription_history ADD COLUMN transcription_ms INTEGER;
         ALTER TABLE transcription_history ADD COLUMN language TEXT;
         ALTER TABLE transcription_history ADD COLUMN asr_model TEXT;",
    ),
    M::up(
        "ALTER TABLE transcription_history ADD COLUMN app_name TEXT;
         ALTER TABLE transcription_history ADD COLUMN window_title TEXT;
         ALTER TABLE transcription_history ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT 0;",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN streaming_text TEXT;"),
    M::up(
        "ALTER TABLE transcription_history ADD COLUMN streaming_asr_model TEXT;
         ALTER TABLE transcription_history ADD COLUMN post_process_model TEXT;",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_prompt_id TEXT;"),
    // Migration 9: Add global_stats table for permanent statistics
    // This table stores cumulative statistics that persist even after history entries are deleted
    M::up(
        "CREATE TABLE IF NOT EXISTS global_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_entries INTEGER NOT NULL DEFAULT 0,
            total_duration_ms INTEGER NOT NULL DEFAULT 0,
            total_char_count INTEGER NOT NULL DEFAULT 0,
            total_corrected_char_count INTEGER NOT NULL DEFAULT 0,
            total_post_processed_entries INTEGER NOT NULL DEFAULT 0,
            first_entry_timestamp INTEGER,
            last_updated INTEGER NOT NULL
        );
         -- Initialize with existing data
         INSERT INTO global_stats (id, total_entries, total_duration_ms, total_char_count, total_corrected_char_count, total_post_processed_entries, first_entry_timestamp, last_updated)
         SELECT 1,
                COUNT(*),
                COALESCE(SUM(duration_ms), 0),
                COALESCE(SUM(char_count), 0),
                COALESCE(SUM(corrected_char_count), 0),
                COALESCE(SUM(CASE WHEN post_processed_text IS NOT NULL AND post_processed_text != '' THEN 1 ELSE 0 END), 0),
                MIN(timestamp),
                strftime('%s', 'now')
         FROM transcription_history;",
    ),
    // Migration 10: Add audio_deleted column to mark entries whose audio files have been cleaned up
    M::up("ALTER TABLE transcription_history ADD COLUMN audio_deleted BOOLEAN NOT NULL DEFAULT 0;"),
    // Migration 11: Revert global_stats and audio_deleted column
    M::up("DROP TABLE IF EXISTS global_stats;"),
    // Migration 12: Add post_process_history column for chained prompts
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_history TEXT;"),
    // Migration 13: Add vocabulary_corrections table for user edit learning
    // Records small vocabulary corrections made by users when editing history entries
    // Used to automatically inject correction hints into LLM prompts
    M::up(
        "CREATE TABLE IF NOT EXISTS vocabulary_corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_text TEXT NOT NULL,
            corrected_text TEXT NOT NULL,
            app_name TEXT,
            correction_count INTEGER DEFAULT 1,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            is_global BOOLEAN DEFAULT 0,
            UNIQUE(original_text, corrected_text, app_name)
        );
         CREATE INDEX IF NOT EXISTS idx_vc_app_name ON vocabulary_corrections(app_name);
         CREATE INDEX IF NOT EXISTS idx_vc_global ON vocabulary_corrections(is_global);",
    ),
    // Migration 14: Add target_apps column for multi-app scoping
    // Stores a JSON array of app names that this correction applies to (when is_global=0)
    M::up("ALTER TABLE vocabulary_corrections ADD COLUMN target_apps TEXT;"),
    // Migration 15: Refactor vocabulary_corrections to be app-agnostic (global only)
    // 1. Create new table without app-specific columns
    // 2. Aggregate existing data by (original_text, corrected_text)
    // 3. Replace old table
    M::up(
        "CREATE TABLE vocabulary_corrections_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_text TEXT NOT NULL,
            corrected_text TEXT NOT NULL,
            correction_count INTEGER DEFAULT 1,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            UNIQUE(original_text, corrected_text)
        );

        INSERT INTO vocabulary_corrections_new (original_text, corrected_text, correction_count, first_seen_at, last_seen_at)
        SELECT 
            original_text, 
            corrected_text, 
            SUM(correction_count), 
            MIN(first_seen_at), 
            MAX(last_seen_at)
        FROM vocabulary_corrections
        GROUP BY original_text, corrected_text;

        DROP TABLE vocabulary_corrections;
        ALTER TABLE vocabulary_corrections_new RENAME TO vocabulary_corrections;",
    ),
    // Migration 16: Restore scope columns (is_global, target_apps) but bound to corrected_text concept
    // 1. Add columns back
    // 2. Add index on corrected_text for efficient bulk updates/inheritance
    M::up(
        "ALTER TABLE vocabulary_corrections ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT 1;
         ALTER TABLE vocabulary_corrections ADD COLUMN target_apps TEXT;
         CREATE INDEX IF NOT EXISTS idx_vc_corrected ON vocabulary_corrections(corrected_text);",
    ),
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
];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PostProcessStep {
    pub prompt_id: Option<String>,
    pub prompt_name: String,
    pub model: Option<String>,
    pub result: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub file_name: String,
    pub timestamp: i64,
    pub saved: bool,
    pub title: String,
    pub transcription_text: String,
    pub streaming_text: Option<String>,
    pub streaming_asr_model: Option<String>,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
    pub post_process_prompt_id: Option<String>,
    pub post_process_model: Option<String>,
    pub duration_ms: Option<i64>,
    pub char_count: Option<i64>,
    pub corrected_char_count: Option<i64>,
    pub transcription_ms: Option<i64>,
    pub language: Option<String>,
    pub asr_model: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub post_process_history: Option<String>, // JSON array of PostProcessStep
    pub deleted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryTotals {
    pub entries: i64,
    pub saved_entries: i64,
    pub post_processed_entries: i64,
    pub duration_ms: i64,
    pub char_count: i64,
    pub corrected_char_count: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryDayBucket {
    /// Local calendar day in `YYYY-MM-DD` format.
    pub day: String,
    pub entries: i64,
    pub duration_ms: i64,
    pub char_count: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryDashboardStats {
    /// Metrics since the start of the user's local day.
    pub today: HistoryTotals,
    /// Metrics within the last N days (inclusive of today).
    pub recent: HistoryTotals,
    /// Per-day buckets within the last N days (local time).
    pub recent_buckets: Vec<HistoryDayBucket>,
    /// All-time totals.
    pub all_time: HistoryTotals,
    /// Number of days used for `recent`/`recent_buckets`.
    pub recent_days: u32,
}

/// Result structure for paginated history queries
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaginatedHistoryResult {
    pub entries: Vec<HistoryEntry>,
    pub total_count: usize,
    pub offset: usize,
    pub limit: usize,
}

pub struct HistoryManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    pub db_path: PathBuf,
}

impl HistoryManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create recordings directory in app data dir
        let app_data_dir = app_handle.path().app_data_dir()?;
        let recordings_dir = app_data_dir.join("recordings");
        let db_path = app_data_dir.join("history.db");

        // Ensure recordings directory exists
        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created recordings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            db_path,
        };

        // Initialize database and run migrations synchronously
        manager.init_database()?;

        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing database at {:?}", self.db_path);

        let mut conn = Connection::open(&self.db_path)?;

        // Handle migration from tauri-plugin-sql to rusqlite_migration
        // tauri-plugin-sql used _sqlx_migrations table, rusqlite_migration uses user_version pragma
        self.migrate_from_tauri_plugin_sql(&conn)?;

        // Create migrations object and run to latest version
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        // Validate migrations in debug builds
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid migrations");

        // Get current version before migration
        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!("Database version before migration: {}", version_before);

        // Apply any pending migrations
        migrations.to_latest(&mut conn)?;

        // Get version after migration
        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!("Database already at latest version {}", version_after);
        }

        Ok(())
    }

    /// Migrate from tauri-plugin-sql's migration tracking to rusqlite_migration's.
    /// tauri-plugin-sql used a _sqlx_migrations table, while rusqlite_migration uses
    /// SQLite's user_version pragma. This function checks if the old system was in use
    /// and sets the user_version accordingly so migrations don't re-run.
    fn migrate_from_tauri_plugin_sql(&self, conn: &Connection) -> Result<()> {
        // Check if the old _sqlx_migrations table exists
        let has_sqlx_migrations: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_sqlx_migrations {
            return Ok(());
        }

        // Check current user_version
        let current_version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if current_version > 0 {
            // Already migrated to rusqlite_migration system
            return Ok(());
        }

        // Get the highest version from the old migrations table
        let old_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if old_version > 0 {
            info!(
                "Migrating from tauri-plugin-sql (version {}) to rusqlite_migration",
                old_version
            );

            // Set user_version to match the old migration state
            conn.pragma_update(None, "user_version", old_version)?;

            // Optionally drop the old migrations table (keeping it doesn't hurt)
            // conn.execute("DROP TABLE IF EXISTS _sqlx_migrations", [])?;

            info!(
                "Migration tracking converted: user_version set to {}",
                old_version
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn query_totals_since(&self, conn: &Connection, start_timestamp: i64) -> Result<HistoryTotals> {
        let mut stmt = conn.prepare(
            "SELECT
                COUNT(*) AS entries,
                COALESCE(SUM(CASE WHEN saved = 1 THEN 1 ELSE 0 END), 0) AS saved_entries,
                COALESCE(SUM(CASE WHEN post_processed_text IS NOT NULL AND post_processed_text != '' THEN 1 ELSE 0 END), 0) AS post_processed_entries,
                COALESCE(SUM(duration_ms), 0) AS duration_ms,
                COALESCE(SUM(char_count), 0) AS char_count,
                COALESCE(SUM(corrected_char_count), 0) AS corrected_char_count
             FROM transcription_history
             WHERE timestamp >= ?1",
        )?;

        let totals = stmt.query_row(params![start_timestamp], |row| {
            Ok(HistoryTotals {
                entries: row.get("entries")?,
                saved_entries: row.get("saved_entries")?,
                post_processed_entries: row.get("post_processed_entries")?,
                duration_ms: row.get("duration_ms")?,
                char_count: row.get("char_count")?,
                corrected_char_count: row.get("corrected_char_count")?,
            })
        })?;

        Ok(totals)
    }

    /// Query all-time totals from the transcription_history table.
    fn query_all_time_totals(&self, conn: &Connection) -> Result<HistoryTotals> {
        let mut stmt = conn.prepare(
            "SELECT
                COUNT(*) AS entries,
                COALESCE(SUM(CASE WHEN saved = 1 THEN 1 ELSE 0 END), 0) AS saved_entries,
                COALESCE(SUM(CASE WHEN post_processed_text IS NOT NULL AND post_processed_text != '' THEN 1 ELSE 0 END), 0) AS post_processed_entries,
                COALESCE(SUM(duration_ms), 0) AS duration_ms,
                COALESCE(SUM(char_count), 0) AS char_count,
                COALESCE(SUM(corrected_char_count), 0) AS corrected_char_count
             FROM transcription_history",
        )?;

        let totals = stmt.query_row([], |row| {
            Ok(HistoryTotals {
                entries: row.get("entries")?,
                saved_entries: row.get("saved_entries")?,
                post_processed_entries: row.get("post_processed_entries")?,
                duration_ms: row.get("duration_ms")?,
                char_count: row.get("char_count")?,
                corrected_char_count: row.get("corrected_char_count")?,
            })
        })?;

        Ok(totals)
    }

    fn query_day_buckets_since(
        &self,
        conn: &Connection,
        start_timestamp: i64,
    ) -> Result<Vec<HistoryDayBucket>> {
        let mut stmt = conn.prepare(
            "SELECT
                strftime('%Y-%m-%d', timestamp, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS entries,
                COALESCE(SUM(duration_ms), 0) AS duration_ms,
                COALESCE(SUM(char_count), 0) AS char_count
             FROM transcription_history
             WHERE timestamp >= ?1
             GROUP BY day
             ORDER BY day ASC",
        )?;

        let rows = stmt.query_map(params![start_timestamp], |row| {
            Ok(HistoryDayBucket {
                day: row.get("day")?,
                entries: row.get("entries")?,
                duration_ms: row.get("duration_ms")?,
                char_count: row.get("char_count")?,
            })
        })?;

        let mut buckets = Vec::new();
        for row in rows {
            buckets.push(row?);
        }
        Ok(buckets)
    }

    pub async fn get_dashboard_stats(&self, recent_days: u32) -> Result<HistoryDashboardStats> {
        let recent_days = recent_days.clamp(1, 365);
        let conn = self.get_connection()?;

        let now_utc = Utc::now();
        let recent_start = now_utc
            .checked_sub_signed(chrono::Duration::days(recent_days as i64))
            .unwrap_or(now_utc)
            .timestamp();

        let now_local = Local::now();
        let today_start_local = now_local
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap_or_else(|| now_local.naive_local());
        let today_start = Local
            .from_local_datetime(&today_start_local)
            .single()
            .unwrap_or(now_local)
            .with_timezone(&Utc)
            .timestamp();

        let all_time = self.query_all_time_totals(&conn)?;
        let recent = self.query_totals_since(&conn, recent_start)?;
        let today = self.query_totals_since(&conn, today_start)?;
        let recent_buckets = self.query_day_buckets_since(&conn, recent_start)?;

        Ok(HistoryDashboardStats {
            today,
            recent,
            recent_buckets,
            all_time,
            recent_days,
        })
    }

    /// Save a transcription to history (both database and WAV file)
    pub async fn save_transcription(
        &self,
        audio_samples: Vec<f32>,
        transcription_text: String,
        streaming_text: Option<String>,
        streaming_asr_model: Option<String>,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
        post_process_prompt_id: Option<String>,
        post_process_model: Option<String>,
        duration_ms: Option<i64>,
        transcription_ms: Option<i64>,
        language: Option<String>,
        asr_model: Option<String>,
        app_name: Option<String>,
        window_title: Option<String>,
    ) -> Result<i64> {
        let timestamp = Utc::now().timestamp();
        let file_name = format!("votype-{}.wav", timestamp);
        let title = self.format_timestamp_title(timestamp);

        // Calculate char counts
        let char_count = Some(transcription_text.chars().count() as i64);
        let corrected_char_count = post_processed_text
            .as_ref()
            .map(|s| s.chars().count() as i64);

        // Save WAV file
        let file_path = self.recordings_dir.join(&file_name);
        save_wav_file(file_path, &audio_samples).await?;

        // Save to database
        let id = self.save_to_database(
            file_name,
            timestamp,
            title,
            transcription_text,
            streaming_text,
            streaming_asr_model,
            post_processed_text,
            post_process_prompt,
            post_process_prompt_id,
            post_process_model,
            duration_ms,
            transcription_ms,
            language,
            asr_model,
            app_name,
            window_title,
            None, // post_process_history initially null
            char_count,
            corrected_char_count,
        )?;

        // Clean up old entries
        self.cleanup_old_entries()?;

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(id)
    }

    fn save_to_database(
        &self,
        file_name: String,
        timestamp: i64,
        title: String,
        transcription_text: String,
        streaming_text: Option<String>,
        streaming_asr_model: Option<String>,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
        post_process_prompt_id: Option<String>,
        post_process_model: Option<String>,
        duration_ms: Option<i64>,
        transcription_ms: Option<i64>,
        language: Option<String>,
        asr_model: Option<String>,
        app_name: Option<String>,
        window_title: Option<String>,
        post_process_history: Option<String>,
        char_count: Option<i64>,
        corrected_char_count: Option<i64>,
    ) -> Result<i64> {
        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO transcription_history (file_name, timestamp, saved, title, transcription_text, streaming_text, streaming_asr_model, post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, duration_ms, transcription_ms, language, asr_model, app_name, window_title, post_process_history, char_count, corrected_char_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![file_name, timestamp, false, title, transcription_text, streaming_text, streaming_asr_model, post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, duration_ms, transcription_ms, language, asr_model, app_name, window_title, post_process_history, char_count, corrected_char_count],
        )?;

        let id = conn.last_insert_rowid();
        debug!("Saved transcription to database with id: {}", id);

        Ok(id)
    }

    pub async fn update_reviewed_text(&self, id: i64, post_processed_text: String) -> Result<()> {
        let conn = self.get_connection()?;
        let corrected_char_count = post_processed_text.chars().count() as i64;

        // Get the old corrected_char_count to calculate delta for global stats
        let old_corrected_char_count: i64 = conn
            .query_row(
                "SELECT COALESCE(corrected_char_count, 0) FROM transcription_history WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Fetch original text for diff analysis
        // We prioritize post_processed_text if it exists, otherwise transcription_text
        let original_text_opt: Option<String> = conn.query_row(
            "SELECT COALESCE(post_processed_text, transcription_text) FROM transcription_history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).ok();

        // Also fetch app_name for scoping corrections
        let app_name: Option<String> = conn
            .query_row(
                "SELECT app_name FROM transcription_history WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok();

        // Perform correction learning if we have original text
        if let Some(original) = original_text_opt {
            use crate::managers::vocabulary::VocabularyManager;
            let diffs = VocabularyManager::analyze_edit_diff(&original, &post_processed_text);
            if !diffs.is_empty() {
                let vocab_manager = VocabularyManager::new(self.db_path.clone());

                let is_global = app_name.is_none();
                let target_apps = app_name
                    .as_ref()
                    .map(|app| serde_json::to_string(&vec![app]).unwrap());

                for diff in &diffs {
                    if let Err(e) =
                        vocab_manager.record_correction(diff, is_global, target_apps.clone())
                    {
                        error!("Failed to record vocabulary correction: {}", e);
                    }
                }
                info!(
                    "[History] Recorded {} vocabulary corrections from review window for entry {}",
                    diffs.len(),
                    id
                );
            }
        }

        conn.execute(
            "UPDATE transcription_history SET 
                post_processed_text = ?1, 
                corrected_char_count = ?2 
             WHERE id = ?3",
            params![post_processed_text, corrected_char_count, id],
        )?;

        let _ = corrected_char_count - old_corrected_char_count;

        debug!("Updated reviewed text for transcription {}", id);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    /// Update a specific text field in a history entry (transcription_text, streaming_text, or post_processed_text)
    /// or update a specific step result in post_process_history.
    /// Used for user-initiated corrections to improve future transcription reference data.
    ///
    /// When field is "post_process_history_step", the step_index must be provided to identify which step to update.
    /// The app_name is used to scope vocabulary corrections to specific applications.
    pub async fn update_history_entry_text(
        &self,
        id: i64,
        field: &str,
        new_text: String,
        step_index: Option<usize>,
        app_name: Option<String>,
    ) -> Result<()> {
        use crate::managers::vocabulary::VocabularyManager;

        // Only allow updating specific fields
        let allowed_fields = [
            "transcription_text",
            "streaming_text",
            "post_processed_text",
            "post_process_history_step",
        ];
        if !allowed_fields.contains(&field) {
            return Err(anyhow::anyhow!(
                "Invalid field: {}. Allowed: {:?}",
                field,
                allowed_fields
            ));
        }

        let conn = self.get_connection()?;

        // Get original text for vocabulary correction analysis
        let original_text: Option<String> = if field == "post_process_history_step" {
            // For step updates, get the specific step's result
            if let Some(step_idx) = step_index {
                let existing_history_json: Option<String> = conn
                    .query_row(
                        "SELECT post_process_history FROM transcription_history WHERE id = ?1",
                        params![id],
                        |row| row.get(0),
                    )
                    .ok();

                existing_history_json.and_then(|s| {
                    serde_json::from_str::<Vec<PostProcessStep>>(&s)
                        .ok()
                        .and_then(|history| history.get(step_idx).map(|step| step.result.clone()))
                })
            } else {
                None
            }
        } else {
            // For regular field updates, get the field value directly
            let query = format!("SELECT {} FROM transcription_history WHERE id = ?1", field);
            conn.query_row(&query, params![id], |row| row.get(0)).ok()
        };

        // Analyze diff and record vocabulary corrections
        if let Some(original) = &original_text {
            let diffs = VocabularyManager::analyze_edit_diff(original, &new_text);
            if !diffs.is_empty() {
                let vocab_manager = VocabularyManager::new(self.db_path.clone());

                let is_global = app_name.is_none();
                let target_apps = app_name
                    .as_ref()
                    .map(|app| serde_json::to_string(&vec![app]).unwrap());

                for diff in &diffs {
                    if let Err(e) =
                        vocab_manager.record_correction(diff, is_global, target_apps.clone())
                    {
                        error!("Failed to record vocabulary correction: {}", e);
                    }
                }
                info!(
                    "[History] Recorded {} vocabulary corrections for entry {} field {}",
                    diffs.len(),
                    id,
                    field
                );
            }
        }

        // Handle each field with appropriate updates
        if field == "transcription_text" {
            // Update char_count along with transcription_text
            let char_count = new_text.chars().count() as i64;
            conn.execute(
                "UPDATE transcription_history SET transcription_text = ?1, char_count = ?2 WHERE id = ?3",
                params![new_text, char_count, id],
            )?;
        } else if field == "post_processed_text" {
            // Update corrected_char_count along with post_processed_text
            let corrected_char_count = new_text.chars().count() as i64;
            conn.execute(
                "UPDATE transcription_history SET post_processed_text = ?1, corrected_char_count = ?2 WHERE id = ?3",
                params![new_text, corrected_char_count, id],
            )?;
        } else if field == "streaming_text" {
            // For streaming_text, just update the field
            conn.execute(
                "UPDATE transcription_history SET streaming_text = ?1 WHERE id = ?2",
                params![new_text, id],
            )?;
        } else if field == "post_process_history_step" {
            // Update a specific step in the post_process_history JSON array
            let step_idx = step_index.ok_or_else(|| {
                anyhow::anyhow!("step_index is required when updating post_process_history_step")
            })?;

            // Get current history
            let existing_history_json: Option<String> = conn
                .query_row(
                    "SELECT post_process_history FROM transcription_history WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .ok();

            let mut history: Vec<PostProcessStep> = existing_history_json
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            if step_idx >= history.len() {
                return Err(anyhow::anyhow!(
                    "step_index {} out of bounds, history has {} steps",
                    step_idx,
                    history.len()
                ));
            }

            // Update the specific step's result
            history[step_idx].result = new_text.clone();

            // Also update post_processed_text if this is the last step (the final result)
            let is_last_step = step_idx == history.len() - 1;

            let history_json = serde_json::to_string(&history)?;

            if is_last_step {
                let corrected_char_count = new_text.chars().count() as i64;
                conn.execute(
                    "UPDATE transcription_history SET post_process_history = ?1, post_processed_text = ?2, corrected_char_count = ?3 WHERE id = ?4",
                    params![history_json, new_text, corrected_char_count, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE transcription_history SET post_process_history = ?1 WHERE id = ?2",
                    params![history_json, id],
                )?;
            }
        }

        debug!("Updated {} for history entry {}", field, id);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    pub async fn update_transcription_post_processing(
        &self,
        id: i64,
        post_processed_text: String,
        post_process_prompt: String,
        prompt_name: String,
        post_process_prompt_id: Option<String>,
        post_process_model: Option<String>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let corrected_char_count = post_processed_text.chars().count() as i64;

        // Check if this entry already had post-processing before
        let had_post_processing: bool = conn
            .query_row(
                "SELECT post_processed_text IS NOT NULL AND post_processed_text != '' FROM transcription_history WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        // Get the old corrected_char_count and existing history
        let (old_corrected_char_count, existing_history_json): (i64, Option<String>) = conn
            .query_row(
                "SELECT COALESCE(corrected_char_count, 0), post_process_history FROM transcription_history WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, None));

        // Update history array
        let mut history: Vec<PostProcessStep> = existing_history_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        history.push(PostProcessStep {
            prompt_id: post_process_prompt_id.clone(),
            prompt_name,
            model: post_process_model.clone(),
            result: post_processed_text.clone(),
        });

        let history_json = serde_json::to_string(&history)?;

        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2, post_process_prompt_id = ?3, post_process_model = ?4, corrected_char_count = ?5, post_process_history = ?6 WHERE id = ?7",
            params![post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, corrected_char_count, history_json, id],
        )?;

        let _ = if had_post_processing { 0 } else { 1 };
        let _ = corrected_char_count - old_corrected_char_count;

        debug!("Updated transcription {} with post-processing step", id);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    pub async fn update_transcription_content(
        &self,
        id: i64,
        transcription_text: String,
        asr_model: String,
        language: String,
        duration_ms: i64,
        transcription_ms: i64,
        char_count: i64,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE transcription_history SET 
                transcription_text = ?1, 
                asr_model = ?2, 
                language = ?3,
                duration_ms = ?4,
                transcription_ms = ?5,
                post_processed_text = NULL,
                post_process_prompt = NULL,
                corrected_char_count = NULL,
                char_count = ?6
             WHERE id = ?7",
            params![
                transcription_text,
                asr_model,
                language,
                duration_ms,
                transcription_ms,
                char_count,
                id
            ],
        )?;

        debug!("Updated transcription {} with re-transcription results", id);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    /// Main cleanup function that handles audio file cleanup.
    ///
    /// Strategy:
    /// - Audio files: Cleaned up based on user's recording_retention_period setting
    /// - Database records: Permanently retained
    pub fn cleanup_old_entries(&self) -> Result<()> {
        // Clean up audio files based on user's retention period setting
        // Database records are kept permanently for historical data
        self.cleanup_audio_files()
    }

    /// Clean up audio files based on user's recording retention period setting.
    /// This only deletes the WAV files.
    /// Database records are preserved permanently for historical statistics.
    fn cleanup_audio_files(&self) -> Result<()> {
        let retention_period = crate::settings::get_recording_retention_period(&self.app_handle);

        match retention_period {
            crate::settings::RecordingRetentionPeriod::Never => {
                // Don't delete any audio files
                return Ok(());
            }
            crate::settings::RecordingRetentionPeriod::PreserveLimit => {
                // Use count-based logic for audio files
                let limit = crate::settings::get_history_limit(&self.app_handle);
                return self.cleanup_audio_by_count(limit);
            }
            _ => {
                // Use time-based logic for audio files
                return self.cleanup_audio_by_time(retention_period);
            }
        }
    }

    /// Delete only the audio files.
    /// The database records are preserved for historical statistics.
    fn delete_audio_files_only(&self, entries: &[(i64, String)]) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        // Reverted: no longer needs DB connection here
        let mut deleted_count = 0;

        for (_id, file_name) in entries {
            // Delete WAV file
            let file_path = self.recordings_dir.join(file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete WAV file {}: {}", file_name, e);
                } else {
                    debug!("Deleted audio file: {}", file_name);
                    deleted_count += 1;
                }
            }

            // We no longer mark entry as audio_deleted in the DB as we've reverted the column
        }

        Ok(deleted_count)
    }

    /// Clean up audio files by count (preserve N most recent).
    fn cleanup_audio_by_count(&self, limit: usize) -> Result<()> {
        let conn = self.get_connection()?;

        // Reverted: no longer uses audio_deleted column
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        if entries.len() > limit {
            let entries_to_cleanup = &entries[limit..];
            let deleted_count = self.delete_audio_files_only(entries_to_cleanup)?;

            if deleted_count > 0 {
                debug!("Cleaned up {} audio files by count", deleted_count);
            }
        }

        Ok(())
    }

    /// Clean up audio files by time period.
    fn cleanup_audio_by_time(
        &self,
        retention_period: crate::settings::RecordingRetentionPeriod,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        // Calculate cutoff timestamp (current time minus retention period)
        let now = Utc::now().timestamp();
        let cutoff_timestamp = match retention_period {
            crate::settings::RecordingRetentionPeriod::Days3 => now - (3 * 24 * 60 * 60),
            crate::settings::RecordingRetentionPeriod::Weeks2 => now - (2 * 7 * 24 * 60 * 60),
            crate::settings::RecordingRetentionPeriod::Months3 => now - (3 * 30 * 24 * 60 * 60),
            _ => unreachable!("Should not reach here"),
        };

        // Get all unsaved entries older than the cutoff timestamp
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 AND timestamp < ?1",
        )?;

        let rows = stmt.query_map(params![cutoff_timestamp], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries_to_cleanup: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries_to_cleanup.push(row?);
        }

        let deleted_count = self.delete_audio_files_only(&entries_to_cleanup)?;

        if deleted_count > 0 {
            debug!(
                "Cleaned up {} audio files based on retention period",
                deleted_count
            );
        }

        Ok(())
    }

    pub async fn get_history_entries(&self) -> Result<Vec<HistoryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, streaming_text, streaming_asr_model, post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, duration_ms, char_count, corrected_char_count, transcription_ms, language, asr_model, app_name, window_title, post_process_history, deleted FROM transcription_history ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(HistoryEntry {
                id: row.get("id")?,
                file_name: row.get("file_name")?,
                timestamp: row.get("timestamp")?,
                saved: row.get("saved")?,
                title: row.get("title")?,
                transcription_text: row.get("transcription_text")?,
                streaming_text: row.get("streaming_text")?,
                streaming_asr_model: row.get("streaming_asr_model")?,
                post_processed_text: row.get("post_processed_text")?,
                post_process_prompt: row.get("post_process_prompt")?,
                post_process_prompt_id: row.get("post_process_prompt_id")?,
                post_process_model: row.get("post_process_model")?,
                duration_ms: row.get("duration_ms")?,
                char_count: row.get("char_count")?,
                corrected_char_count: row.get("corrected_char_count")?,
                transcription_ms: row.get("transcription_ms")?,
                language: row.get("language")?,
                asr_model: row.get("asr_model")?,
                app_name: row.get("app_name")?,
                window_title: row.get("window_title")?,
                post_process_history: row.get("post_process_history")?,
                deleted: row.get("deleted")?,
            })
        })?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        Ok(entries)
    }

    /// Get paginated history entries with total count
    /// Returns (entries, total_count)
    pub async fn get_history_entries_paginated(
        &self,
        offset: usize,
        limit: usize,
        start_timestamp: Option<i64>,
        end_timestamp: Option<i64>,
    ) -> Result<(Vec<HistoryEntry>, usize)> {
        let conn = self.get_connection()?;

        // Build WHERE clause based on optional timestamp filters
        let (where_clause, params_vec): (String, Vec<Box<dyn rusqlite::ToSql>>) =
            match (start_timestamp, end_timestamp) {
                (Some(start), Some(end)) => (
                    "WHERE timestamp >= ?1 AND timestamp <= ?2".to_string(),
                    vec![Box::new(start), Box::new(end)],
                ),
                (Some(start), None) => ("WHERE timestamp >= ?1".to_string(), vec![Box::new(start)]),
                (None, Some(end)) => ("WHERE timestamp <= ?1".to_string(), vec![Box::new(end)]),
                (None, None) => (String::new(), vec![]),
            };

        // Get total count
        let count_sql = format!(
            "SELECT COUNT(*) FROM transcription_history {}",
            where_clause
        );
        let total_count: usize = if params_vec.is_empty() {
            conn.query_row(&count_sql, [], |row| row.get(0))?
        } else {
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                params_vec.iter().map(|p| p.as_ref()).collect();
            conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))?
        };

        // Build paginated query
        let query_sql = format!(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, streaming_text, streaming_asr_model, post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, duration_ms, char_count, corrected_char_count, transcription_ms, language, asr_model, app_name, window_title, post_process_history, deleted FROM transcription_history {} ORDER BY timestamp DESC LIMIT {} OFFSET {}",
            where_clause, limit, offset
        );

        let mut stmt = conn.prepare(&query_sql)?;

        // Helper to extract entry from row
        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<HistoryEntry> {
            Ok(HistoryEntry {
                id: row.get("id")?,
                file_name: row.get("file_name")?,
                timestamp: row.get("timestamp")?,
                saved: row.get("saved")?,
                title: row.get("title")?,
                transcription_text: row.get("transcription_text")?,
                streaming_text: row.get("streaming_text")?,
                streaming_asr_model: row.get("streaming_asr_model")?,
                post_processed_text: row.get("post_processed_text")?,
                post_process_prompt: row.get("post_process_prompt")?,
                post_process_prompt_id: row.get("post_process_prompt_id")?,
                post_process_model: row.get("post_process_model")?,
                duration_ms: row.get("duration_ms")?,
                char_count: row.get("char_count")?,
                corrected_char_count: row.get("corrected_char_count")?,
                transcription_ms: row.get("transcription_ms")?,
                language: row.get("language")?,
                asr_model: row.get("asr_model")?,
                app_name: row.get("app_name")?,
                window_title: row.get("window_title")?,
                post_process_history: row.get("post_process_history")?,
                deleted: row.get("deleted")?,
            })
        };

        let entries: Vec<HistoryEntry> = if params_vec.is_empty() {
            stmt.query_map([], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                params_vec.iter().map(|p| p.as_ref()).collect();
            stmt.query_map(params_refs.as_slice(), map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };

        Ok((entries, total_count))
    }

    pub async fn toggle_saved_status(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get current saved status
        let current_saved: bool = conn.query_row(
            "SELECT saved FROM transcription_history WHERE id = ?1",
            params![id],
            |row| row.get("saved"),
        )?;

        let new_saved = !current_saved;

        conn.execute(
            "UPDATE transcription_history SET saved = ?1 WHERE id = ?2",
            params![new_saved, id],
        )?;

        debug!("Toggled saved status for entry {}: {}", id, new_saved);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    pub fn get_audio_file_path(&self, file_name: &str) -> PathBuf {
        self.recordings_dir.join(file_name)
    }

    pub async fn get_entry_by_id(&self, id: i64) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, streaming_text, streaming_asr_model, post_processed_text, post_process_prompt, post_process_prompt_id, post_process_model, duration_ms, char_count, corrected_char_count, transcription_ms, language, asr_model, app_name, window_title, post_process_history, deleted
             FROM transcription_history WHERE id = ?1",
        )?;

        let entry = stmt
            .query_row([id], |row| {
                Ok(HistoryEntry {
                    id: row.get("id")?,
                    file_name: row.get("file_name")?,
                    timestamp: row.get("timestamp")?,
                    saved: row.get("saved")?,
                    title: row.get("title")?,
                    transcription_text: row.get("transcription_text")?,
                    streaming_text: row.get("streaming_text")?,
                    streaming_asr_model: row.get("streaming_asr_model")?,
                    post_processed_text: row.get("post_processed_text")?,
                    post_process_prompt: row.get("post_process_prompt")?,
                    post_process_prompt_id: row.get("post_process_prompt_id")?,
                    post_process_model: row.get("post_process_model")?,
                    duration_ms: row.get("duration_ms")?,
                    char_count: row.get("char_count")?,
                    corrected_char_count: row.get("corrected_char_count")?,
                    transcription_ms: row.get("transcription_ms")?,
                    language: row.get("language")?,
                    asr_model: row.get("asr_model")?,
                    app_name: row.get("app_name")?,
                    window_title: row.get("window_title")?,
                    post_process_history: row.get("post_process_history")?,
                    deleted: row.get("deleted")?,
                })
            })
            .optional()?;

        Ok(entry)
    }

    pub async fn delete_entry(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get the entry to find the file name
        if let Some(entry) = self.get_entry_by_id(id).await? {
            // Delete the audio file first
            let file_path = self.get_audio_file_path(&entry.file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete audio file {}: {}", entry.file_name, e);
                    // Continue with database deletion even if file deletion fails
                }
            }
        }

        // Delete from database
        conn.execute(
            "DELETE FROM transcription_history WHERE id = ?1",
            params![id],
        )?;

        debug!("Deleted history entry with id: {}", id);

        // Emit history updated event
        if let Err(e) = self.app_handle.emit("history-updated", ()) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    pub fn get_recent_history_texts_for_app(
        &self,
        app_name: &str,
        window_title: Option<&str>,
        match_pattern: Option<&str>,
        match_type: Option<crate::settings::TitleMatchType>,
        limit: usize,
        exclude_id: Option<i64>,
    ) -> Result<Vec<String>> {
        let conn = self.get_connection()?;

        // Pull more entries than limit to allow for filtering in Rust
        let fetch_limit = limit * 4;

        let mut query = "SELECT id, COALESCE(post_processed_text, transcription_text) as text, window_title
             FROM transcription_history 
             WHERE app_name = ?1 AND (post_processed_text IS NOT NULL OR transcription_text IS NOT NULL)".to_string();

        if exclude_id.is_some() {
            query.push_str(" AND id != ?3");
        }

        query.push_str(" ORDER BY timestamp DESC LIMIT ?2");

        let mut stmt = conn.prepare(&query)?;

        let mut results = Vec::new();
        let exclude_val = exclude_id.unwrap_or(-1);

        let rows = stmt.query_map(params![app_name, fetch_limit, exclude_val], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
        })?;

        for row in rows {
            if let Ok((text, history_win_title)) = row {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let mut matched = false;
                if let (Some(pattern), Some(mtype)) = (match_pattern, match_type) {
                    // Pattern-based match (Rule-aware)
                    if let Some(h_title) = history_win_title.as_ref() {
                        matched = match mtype {
                            crate::settings::TitleMatchType::Text => {
                                h_title.to_lowercase().contains(&pattern.to_lowercase())
                            }
                            crate::settings::TitleMatchType::Regex => regex::Regex::new(pattern)
                                .map(|re| re.is_match(h_title))
                                .unwrap_or(false),
                        };
                    }
                } else if window_title.is_some() {
                    // Exact match fallback (Current window has no rule)
                    matched = history_win_title.as_deref() == window_title;
                } else {
                    // Overall app-level match (No title provided)
                    matched = true;
                }

                if matched {
                    results.push(trimmed.to_string());
                    if results.len() >= limit {
                        break;
                    }
                }
            }
        }

        // Reverse so it's in chronological order (oldest to newest)
        results.reverse();
        Ok(results)
    }

    fn format_timestamp_title(&self, timestamp: i64) -> String {
        if let Some(utc_datetime) = DateTime::from_timestamp(timestamp, 0) {
            // Convert UTC to local timezone
            let local_datetime = utc_datetime.with_timezone(&Local);
            local_datetime.format("%B %e, %Y - %l:%M%p").to_string()
        } else {
            format!("Recording {}", timestamp)
        }
    }
}
