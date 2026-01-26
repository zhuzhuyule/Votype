use crate::llm_client;
use crate::managers::prompt::PromptManager;
use crate::managers::summary::{Summary, SummaryManager, SummaryStats, UserProfile};
use crate::settings::{self, HotwordCategory, HotwordScenario};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
};
use chrono::TimeZone;
use log::{error, info};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

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
    prompt_manager: State<'_, Arc<PromptManager>>,
    summary_id: i64,
    feedback_style: String,
    selected_model: Option<String>,
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

    // Get the model to use: user-selected > settings default > provider default
    let model = selected_model
        .filter(|m| !m.is_empty())
        .or_else(|| {
            app_settings
                .selected_prompt_model_id
                .as_ref()
                .and_then(|id| {
                    app_settings
                        .cached_models
                        .iter()
                        .find(|m| m.id == *id && m.provider_id == provider.id)
                })
                .map(|m| m.model_id.clone())
        })
        .or_else(|| app_settings.post_process_models.get(&provider.id).cloned())
        .ok_or_else(|| "No model configured for AI analysis".to_string())?;

    // Load the prompt template based on period type
    // First get the summary to determine period_type
    let summary_for_period = summary_manager
        .get_summary_by_id(summary_id)
        .map_err(|e| e.to_string())?;

    let prompt_id = match summary_for_period.period_type.as_str() {
        "day" => "system_summary_day",
        "week" => "system_summary_week",
        "month" => "system_summary_month",
        _ => "system_summary_analysis", // fallback to generic
    };

    let prompt_template = prompt_manager
        .get_prompt(&app, prompt_id)
        .map_err(|e| format!("Failed to load summary analysis prompt: {}", e))?;

    info!(
        "Loaded prompt template '{}' for period_type '{}' ({} chars)",
        prompt_id,
        summary_for_period.period_type,
        prompt_template.len()
    );

    // Clone Arcs for the background task
    let summary_manager_clone = (*summary_manager).clone();
    let hotword_manager_clone = app
        .try_state::<Arc<crate::managers::HotwordManager>>()
        .map(|s| s.inner().clone());
    let prompt_template = prompt_template.clone();
    let model = model.clone();
    let provider = provider.clone();
    let api_key = api_key.clone();

    // Spawn a detached task to ensure completion even if frontend disconnects
    let handle = tauri::async_runtime::spawn(async move {
        // Fill the prompt template with data
        // We prepare data inside the task to keeping it self-contained,
        // though we could also pass it in if prepared outside.
        // Re-fetching summary inside to ensure fresh state isn't strictly necessary
        // if we trust the passed args, but safe.
        // Actually, we need to prepare analysis data here or pass it in.
        // Currently prepare_analysis_data_enhanced is on summary_manager.

        // Let's prepare data here to avoid passing huge strings across task boundary if possible,
        // though passing AnalysisData is fine.
        // For simplicity, let's call prepare again or move the logic here.
        // Wait, 'analysis_data' was prepared OUTSIDE in current code.
        // To avoid double calculation, let's move prepare logic inside
        // OR pass analysis_data (which is cloneable).

        let analysis_data = summary_manager_clone
            .prepare_analysis_data_enhanced(summary_id, &feedback_style)
            .map_err(|e| e.to_string())?;

        let prompt = analysis_data.fill_prompt(&prompt_template);

        info!(
            "Generating AI analysis for summary {} using model {} on provider {}",
            summary_id, model, provider.id
        );

        // Create the LLM client
        let client = llm_client::create_client(&provider, api_key)?;

        // Build the request
        let user_msg = ChatCompletionRequestUserMessageArgs::default()
            .content(prompt.clone())
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

        // Parse and extract vocabulary
        if let Some(hotword_manager) = hotword_manager_clone {
            extract_and_save_vocabulary(&ai_summary, &hotword_manager).await;
        } else {
            log::warn!("HotwordManager not available for vocabulary extraction");
        }

        // Update the summary with AI content
        summary_manager_clone
            .update_summary_ai_content(summary_id, Some(ai_summary.clone()), None, Some(model))
            .map_err(|e| {
                error!("Failed to update summary AI content: {}", e);
                e.to_string()
            })?;

        // Return updated summary
        summary_manager_clone
            .get_summary_by_id(summary_id)
            .map_err(|e| e.to_string())
    });

    // Wait for the background task
    // If the frontend cancels (drops) this future, 'handle' is dropped,
    // but tokio tasks are detached by default so it will continue running.
    handle
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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
        "markdown" => Ok(format_summary_as_markdown(&summary)),
        _ => Ok(format_summary_as_markdown(&summary)),
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
        md.push('\n');
    }

    if !summary.stats.top_skills.is_empty() {
        md.push_str("### Top Skills Used\n\n");
        for skill in &summary.stats.top_skills {
            md.push_str(&format!("- {}\n", skill));
        }
        md.push('\n');
    }

    if let Some(ref ai_summary) = summary.ai_summary {
        md.push_str("## AI Analysis\n\n");
        md.push_str(ai_summary);
        md.push_str("\n\n");
    }

    if let Some(ref reflection) = summary.ai_reflection {
        md.push_str("## Reflection\n\n");
        md.push_str(reflection);
        md.push('\n');
    }

    md
}

#[derive(Deserialize)]
struct VocabularySection {
    items: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct AiAnalysisResponse {
    vocabulary_extracted: Option<VocabularySection>,
}

async fn extract_and_save_vocabulary(
    json_text: &str,
    hotword_manager: &crate::managers::HotwordManager,
) {
    // 1. Extract JSON from markdown code block
    let json_str = if let Some(start) = json_text.find("```json") {
        if let Some(end_offset) = json_text[start + 7..].find("```") {
            &json_text[start + 7..start + 7 + end_offset]
        } else {
            json_text
        }
    } else {
        json_text
    };

    // 2. Parse JSON
    let response: Result<AiAnalysisResponse, _> = serde_json::from_str(json_str);

    if let Ok(response) = response {
        if let Some(vocab_section) = response.vocabulary_extracted {
            if let Some(items) = vocab_section.items {
                if items.is_empty() {
                    return;
                }

                info!("Found {} extracted vocabulary items", items.len());
                let mut added_count = 0;

                for item in items {
                    // Item format expected: "Term (Category)" or just "Term"
                    let (target, category_str) = if let Some(start_paren) = item.find('(') {
                        if let Some(end_paren) = item.find(')') {
                            let term = item[..start_paren].trim().to_string();
                            let cat = item[start_paren + 1..end_paren].trim();
                            (term, Some(cat))
                        } else {
                            (item.trim().to_string(), None)
                        }
                    } else {
                        (item.trim().to_string(), None)
                    };

                    if target.is_empty() {
                        continue;
                    }

                    // Map string category to enum
                    let category = match category_str {
                        Some(s)
                            if s.eq_ignore_ascii_case("Project")
                                || s.contains("项目")
                                || s.eq_ignore_ascii_case("Product")
                                || s.contains("产品") =>
                        {
                            Some(HotwordCategory::Term) // Map projects to Term for now
                        }
                        Some(s) if s.eq_ignore_ascii_case("Person") || s.contains("人名") => {
                            Some(HotwordCategory::Person)
                        }
                        Some(s) if s.eq_ignore_ascii_case("Organization") || s.contains("组织") =>
                        {
                            Some(HotwordCategory::Term) // Map orgs to Term
                        }
                        Some(s) if s.eq_ignore_ascii_case("Term") || s.contains("术语") => {
                            Some(HotwordCategory::Term)
                        }
                        Some(s) if s.eq_ignore_ascii_case("Abbreviation") || s.contains("缩写") => {
                            Some(HotwordCategory::Abbreviation)
                        }
                        Some(s) if s.eq_ignore_ascii_case("Brand") || s.contains("品牌") => {
                            Some(HotwordCategory::Brand)
                        }
                        _ => None, // Let manager infer or default
                    };

                    // Add to manager (automatically handles duplicates)
                    match hotword_manager.add(
                        target.clone(),
                        vec![], // originals
                        category,
                        Some(vec![HotwordScenario::Work]), // Default to work scenario
                    ) {
                        Ok(_) => added_count += 1,
                        Err(e) => {
                            // Ignore unique constraint errors
                            if !e.to_string().contains("UNIQUE constraint") {
                                log::warn!("Failed to add extracted hotword '{}': {}", target, e);
                            }
                        }
                    }
                }

                if added_count > 0 {
                    info!(
                        "Successfully added {} new hotwords from AI analysis",
                        added_count
                    );
                }
            }
        }
    } else {
        log::warn!("Failed to parse vocabulary JSON from AI response");
    }
}
