use crate::managers::summary::{Summary, SummaryManager, SummaryStats, UserProfile};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_summary_stats(
    summary_manager: State<'_, Arc<SummaryManager>>,
    _period_type: String,
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
