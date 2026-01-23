use crate::llm_client;
use crate::managers::summary::{Summary, SummaryManager, SummaryStats, UserProfile};
use crate::settings;
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
use chrono::TimeZone;
use log::{error, info};
use std::sync::Arc;
use tauri::{AppHandle, State};

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

#[tauri::command]
pub async fn generate_summary_ai_analysis(
    app: AppHandle,
    summary_manager: State<'_, Arc<SummaryManager>>,
    summary_id: i64,
    feedback_style: String,
) -> Result<Summary, String> {
    // Get settings to access LLM configuration
    let app_settings = settings::get_settings(&app);

    // Get the active provider
    let provider = app_settings
        .active_post_process_provider()
        .ok_or_else(|| "No active post-process provider configured".to_string())?
        .clone();

    // Get API key for the provider
    let api_key = app_settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if api_key.is_empty() {
        return Err(format!(
            "No API key configured for provider: {}",
            provider.label
        ));
    }

    // Get the model to use (prefer selected model, fall back to provider default)
    let model = app_settings
        .selected_prompt_model_id
        .as_ref()
        .and_then(|id| {
            app_settings
                .cached_models
                .iter()
                .find(|m| m.id == *id && m.provider_id == provider.id)
        })
        .map(|m| m.model_id.clone())
        .or_else(|| app_settings.post_process_models.get(&provider.id).cloned())
        .ok_or_else(|| "No model configured for AI analysis".to_string())?;

    // Prepare the analysis content
    let (prompt, _summary, _entries) = summary_manager
        .prepare_analysis_content(summary_id, &feedback_style)
        .map_err(|e| e.to_string())?;

    info!(
        "Generating AI analysis for summary {} using model {} on provider {}",
        summary_id, model, provider.id
    );

    // Create the LLM client
    let client = llm_client::create_client(&provider, api_key)?;

    // Build the request
    let user_msg = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()
        .map_err(|e| format!("Failed to build user message: {}", e))?;

    let messages: Vec<ChatCompletionRequestMessage> =
        vec![ChatCompletionRequestMessage::User(user_msg)];

    let request = CreateChatCompletionRequestArgs::default()
        .model(model.clone())
        .messages(messages)
        .build()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    // Make the LLM call
    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    let ai_summary = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| "No response content from LLM".to_string())?;

    info!(
        "AI analysis generated for summary {}: {}...",
        summary_id,
        ai_summary.chars().take(50).collect::<String>()
    );

    // Update the summary with AI content
    summary_manager
        .update_summary_ai_content(summary_id, Some(ai_summary), None, Some(model))
        .map_err(|e| {
            error!("Failed to update summary AI content: {}", e);
            e.to_string()
        })?;

    // Return updated summary
    summary_manager
        .get_summary_by_id(summary_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_summary(
    summary_manager: State<'_, Arc<SummaryManager>>,
    summary_id: i64,
    format: String, // "markdown" or "json"
) -> Result<String, String> {
    // Get the summary
    let summary = summary_manager
        .get_summary_by_id(summary_id)
        .map_err(|e| e.to_string())?;

    match format.as_str() {
        "json" => serde_json::to_string_pretty(&summary).map_err(|e| e.to_string()),
        "markdown" | _ => Ok(format_summary_as_markdown(&summary)),
    }
}

fn format_summary_as_markdown(summary: &Summary) -> String {
    let start_date = chrono::Utc
        .timestamp_opt(summary.period_start, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let end_date = chrono::Utc
        .timestamp_opt(summary.period_end, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let mut md = format!(
        "# Summary Report\n\n**Period:** {} to {}\n**Type:** {}\n\n",
        start_date, end_date, summary.period_type
    );

    md.push_str("## Statistics\n\n");
    md.push_str(&format!("- **Entries:** {}\n", summary.stats.entry_count));
    md.push_str(&format!(
        "- **Total Characters:** {}\n",
        summary.stats.total_chars
    ));
    md.push_str(&format!(
        "- **Total Duration:** {} minutes\n",
        summary.stats.total_duration_ms / 60000
    ));
    md.push_str(&format!(
        "- **AI Polish Calls:** {}\n\n",
        summary.stats.llm_calls
    ));

    if !summary.stats.by_app.is_empty() {
        md.push_str("### App Distribution\n\n");
        for (app, stats) in &summary.stats.by_app {
            md.push_str(&format!(
                "- **{}:** {} entries, {} chars\n",
                app, stats.count, stats.chars
            ));
        }
        md.push_str("\n");
    }

    if !summary.stats.top_skills.is_empty() {
        md.push_str("### Top Skills Used\n\n");
        for skill in &summary.stats.top_skills {
            md.push_str(&format!("- {}\n", skill));
        }
        md.push_str("\n");
    }

    if let Some(ref ai_summary) = summary.ai_summary {
        md.push_str("## AI Analysis\n\n");
        md.push_str(ai_summary);
        md.push_str("\n\n");
    }

    if let Some(ref reflection) = summary.ai_reflection {
        md.push_str("## Reflection\n\n");
        md.push_str(reflection);
        md.push_str("\n");
    }

    md
}
