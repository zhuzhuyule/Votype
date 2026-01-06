use crate::managers::history::{
    HistoryDashboardStats, HistoryEntry, HistoryManager, PaginatedHistoryResult,
};
use crate::managers::transcription::TranscriptionManager;
use log::{debug, info};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_history_entries(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Vec<HistoryEntry>, String> {
    history_manager
        .get_history_entries()
        .await
        .map_err(|e| e.to_string())
}

/// Get paginated history entries with optional timestamp filtering
#[tauri::command]
pub async fn get_history_entries_paginated(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    offset: usize,
    limit: usize,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<PaginatedHistoryResult, String> {
    let (entries, total_count) = history_manager
        .get_history_entries_paginated(offset, limit, start_timestamp, end_timestamp)
        .await
        .map_err(|e| e.to_string())?;

    Ok(PaginatedHistoryResult {
        entries,
        total_count,
        offset,
        limit,
    })
}

#[tauri::command]
pub async fn toggle_history_entry_saved(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .toggle_saved_status(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_audio_file_path(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    file_name: String,
) -> Result<String, String> {
    let path = history_manager.get_audio_file_path(&file_name);
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
pub async fn delete_history_entry(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .delete_entry(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_history_dashboard_stats(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    days: Option<u32>,
) -> Result<HistoryDashboardStats, String> {
    history_manager
        .get_dashboard_stats(days.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_history_limit(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    limit: usize,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_limit = limit;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn update_recording_retention_period(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    period: String,
) -> Result<(), String> {
    use crate::settings::RecordingRetentionPeriod;

    let retention_period = match period.as_str() {
        "never" => RecordingRetentionPeriod::Never,
        "preserve_limit" => RecordingRetentionPeriod::PreserveLimit,
        "days3" => RecordingRetentionPeriod::Days3,
        "weeks2" => RecordingRetentionPeriod::Weeks2,
        "months3" => RecordingRetentionPeriod::Months3,
        _ => return Err(format!("Invalid retention period: {}", period)),
    };

    let mut settings = crate::settings::get_settings(&app);
    settings.recording_retention_period = retention_period;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn retranscribe_history_entry(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    id: i64,
) -> Result<(), String> {
    use crate::audio_toolkit::read_wav_file;
    use crate::settings::get_settings;

    let entries = history_manager
        .get_history_entries()
        .await
        .map_err(|e| e.to_string())?;

    let entry = entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("History entry not found: {}", id))?;

    let file_path = history_manager.get_audio_file_path(&entry.file_name);
    let samples = read_wav_file(&file_path).map_err(|e| e.to_string())?;

    // Ensure we have a valid duration even if missing in original entry
    let duration_ms = (samples.len() as f64 / 16000.0 * 1000.0) as i64;

    let settings = get_settings(&app);
    let model_id = if settings.online_asr_enabled {
        settings
            .selected_asr_model_id
            .clone()
            .unwrap_or_else(|| "online".to_string())
    } else {
        settings.selected_model.clone()
    };

    // If using local model, ensure it's loaded
    if !settings.online_asr_enabled {
        transcription_manager
            .load_model(&model_id)
            .map_err(|e| e.to_string())?;
    }

    let start_time = std::time::Instant::now();
    let transcription_text = transcription_manager
        .transcribe(samples)
        .map_err(|e| e.to_string())?;
    let elapsed = start_time.elapsed().as_millis() as i64;

    let char_count = transcription_text.chars().count() as i64;

    // Update the existing entry using the manager method
    history_manager
        .update_transcription_content(
            id,
            transcription_text.clone(),
            model_id,
            settings.selected_language.clone(),
            duration_ms,
            elapsed,
            char_count,
        )
        .await
        .map_err(|e| e.to_string())?;

    // Emit event to refresh UI for the raw transcription
    let _ = app.emit("history-updated", ());

    // --- Post-processing ---
    if settings.post_process_enabled {
        use crate::actions::post_process::{
            maybe_convert_chinese_variant, maybe_post_process_transcription,
        };

        // 1. Try Chinese variant conversion first
        if let Some(converted) = maybe_convert_chinese_variant(&settings, &transcription_text).await
        {
            history_manager
                .update_transcription_post_processing(
                    id,
                    converted,
                    String::new(),
                    "OpenCC".to_string(),
                    None,
                    Some("OpenCC".to_string()),
                )
                .await
                .map_err(|e| e.to_string())?;
        } else {
            // 2. Try LLM post-processing
            // For re-transcription, we don't have a separate streaming result, so we pass None.
            let (llm_result, used_model, prompt_id, _, _, _) = maybe_post_process_transcription(
                &app,
                &settings,
                &transcription_text,
                None,
                false,
                None,
                entry.app_name,
                entry.window_title,
                None,
                None,
                Some(id),
            )
            .await;

            if let Some(processed) = llm_result {
                let mut post_process_prompt_text = String::new();
                let mut post_process_prompt_name = String::new();

                // Find the prompt text to save
                if let Some(pid) = &prompt_id {
                    if let Some(prompt) =
                        settings.post_process_prompts.iter().find(|p| &p.id == pid)
                    {
                        post_process_prompt_text = prompt.instructions.clone();
                        post_process_prompt_name = prompt.name.clone();
                    }
                }

                history_manager
                    .update_transcription_post_processing(
                        id,
                        processed,
                        post_process_prompt_text,
                        post_process_prompt_name,
                        prompt_id,
                        used_model,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn reprocess_history_entry(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    prompt_id: String,
    input_text: Option<String>,
) -> Result<(), String> {
    use crate::actions::post_process::post_process_text_with_prompt;
    use crate::settings::get_settings;

    debug!(
        "Command reprocess_history_entry called for ID: {}, Prompt: {}",
        id, prompt_id
    );

    let entry = history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry not found: {}", id))?;

    let settings = get_settings(&app);

    // Find the specified prompt
    let prompt = settings
        .post_process_prompts
        .iter()
        .find(|p| p.id == prompt_id)
        .ok_or_else(|| format!("Prompt not found: {}", prompt_id))?;

    // Use provided input_text or fallback to the original transcription
    let text_to_process = input_text
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| entry.transcription_text.clone());

    let (llm_result, used_model, used_prompt_id, _, _, _) = post_process_text_with_prompt(
        &app,
        &settings,
        &text_to_process,
        entry.streaming_text.as_deref(),
        prompt,
        false,
    )
    .await;

    if let Some(text) = llm_result {
        history_manager
            .update_transcription_post_processing(
                id,
                text,
                prompt.instructions.clone(),
                prompt.name.clone(),
                used_prompt_id,
                used_model,
            )
            .await
            .map_err(|e| e.to_string())?;

        // CRITICAL: Emit event to refresh the UI
        let _ = app.emit("history-updated", ());
        info!(
            "History entry {} successfully reprocessed and UI updated",
            id
        );
    } else {
        return Err(
            "Post-processing failed to return a result. Check logs for API errors.".to_string(),
        );
    }

    Ok(())
}
