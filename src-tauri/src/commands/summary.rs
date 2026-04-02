use crate::llm_client;
use crate::managers::prompt::PromptManager;
use crate::managers::summary::{Summary, SummaryManager, SummaryStats, UserProfile};
use crate::settings;
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
pub async fn delete_summary_ai_history_entry(
    summary_manager: State<'_, Arc<SummaryManager>>,
    summary_id: i64,
    timestamp: i64,
) -> Result<Summary, String> {
    summary_manager
        .delete_summary_ai_history_entry(summary_id, timestamp)
        .map_err(|e| e.to_string())?;
    summary_manager
        .get_summary_by_id(summary_id)
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
    split_requests: Option<bool>,
    parallel_requests: Option<bool>,
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
        .first_key(&provider.id)
        .unwrap_or("")
        .to_string();

    // Get the model to use: user-selected > settings default > provider default
    let model = selected_model
        .filter(|m| !m.is_empty())
        .or_else(|| {
            app_settings
                .selected_prompt_model
                .as_ref()
                .map(|c| &c.primary_id)
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

    let split_requests = split_requests.unwrap_or(false);
    let parallel_requests = parallel_requests.unwrap_or(false);

    let prompt_id = match summary_for_period.period_type.as_str() {
        "day" => "system_summary_day",
        "week" => "system_summary_week",
        "month" => "system_summary_month",
        _ => "system_summary_analysis", // fallback to generic
    };

    // Clone Arcs for the background task
    let summary_manager_clone = (*summary_manager).clone();
    let prompt_template = if split_requests {
        None
    } else {
        Some(
            prompt_manager
                .get_prompt(&app, prompt_id)
                .map_err(|e| format!("Failed to load summary analysis prompt: {}", e))?,
        )
    };

    let prompt_manager_clone = (*prompt_manager).clone();
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

        let call_llm = |prompt: String,
                        provider: settings::PostProcessProvider,
                        api_key: String,
                        model: String| async move {
            let client = llm_client::create_client(&provider, api_key, None)?;
            let user_msg = ChatCompletionRequestUserMessageArgs::default()
                .content(prompt)
                .build()
                .map_err(|e| format!("Failed to build user message: {}", e))?;

            let messages: Vec<ChatCompletionRequestMessage> =
                vec![ChatCompletionRequestMessage::User(user_msg)];

            let request = CreateChatCompletionRequestArgs::default()
                .model(model)
                .messages(messages)
                .build()
                .map_err(|e| format!("Failed to build request: {}", e))?;

            let response = client
                .chat()
                .create(request)
                .await
                .map_err(|e| format!("LLM request failed: {}", e))?;

            response
                .choices
                .first()
                .and_then(|c| c.message.content.clone())
                .ok_or_else(|| "No response content from LLM".to_string())
        };

        let ai_summary = if split_requests {
            let parts: Vec<(&str, &str)> = match summary_for_period.period_type.as_str() {
                "day" => vec![
                    ("summary", "system_summary_day_summary"),
                    ("activities", "system_summary_day_activities"),
                    ("highlights", "system_summary_day_highlights"),
                    ("work_focus", "system_summary_day_work_themes"),
                    ("focus_assessment", "system_summary_day_focus"),
                    ("vocabulary_extracted", "system_summary_day_vocab"),
                    ("patterns_insights", "system_summary_day_patterns_insights"),
                    (
                        "comparison_analysis",
                        "system_summary_day_comparison_analysis",
                    ),
                    ("profile_update", "system_summary_day_profile_update"),
                ],
                "week" => vec![
                    ("summary", "system_summary_week_summary"),
                    ("work_focus", "system_summary_week_work_focus"),
                    ("activities", "system_summary_week_activities"),
                    ("patterns", "system_summary_week_patterns"),
                    ("highlights", "system_summary_week_highlights"),
                    ("vocabulary_extracted", "system_summary_week_vocab"),
                    ("next_week", "system_summary_week_next_week"),
                ],
                "month" => vec![
                    ("summary", "system_summary_month_summary"),
                    ("work_focus", "system_summary_month_work_focus"),
                    ("trends", "system_summary_month_trends"),
                    ("highlights", "system_summary_month_highlights"),
                    (
                        "communication_patterns",
                        "system_summary_month_communication",
                    ),
                    ("insights", "system_summary_month_insights"),
                    ("vocabulary_extracted", "system_summary_month_vocab"),
                ],
                _ => vec![("summary", prompt_id)],
            };

            let mut combined = serde_json::Map::new();
            let mut errors: Vec<String> = Vec::new();

            fn extract_json_block(content: &str) -> &str {
                if let Some(start) = content.find("```json") {
                    let rest = &content[start + 7..];
                    if let Some(end) = rest.find("```") {
                        return rest[..end].trim();
                    }
                }
                if let Some(start) = content.find("```") {
                    let rest = &content[start + 3..];
                    if let Some(end) = rest.find("```") {
                        return rest[..end].trim();
                    }
                }
                content.trim()
            }

            if parallel_requests {
                use futures_util::future::join_all;
                let futures = parts.into_iter().map(|(key, pid)| {
                    let prompt_manager_clone = prompt_manager_clone.clone();
                    let app = app.clone();
                    let analysis_data = analysis_data.clone();
                    let provider = provider.clone();
                    let api_key = api_key.clone();
                    let model = model.clone();
                    async move {
                        let template = prompt_manager_clone
                            .get_prompt(&app, pid)
                            .map_err(|e| {
                                format!("Failed to load summary analysis prompt: {}", e)
                            })?;
                        let prompt = analysis_data.fill_prompt(&template);
                        info!(
                            "Generating AI analysis part '{}' for summary {} using model {} on provider {}",
                            key, summary_id, model, provider.id
                        );
                        let content = call_llm(prompt, provider, api_key, model).await?;
                        Ok::<(String, String), String>((key.to_string(), content))
                    }
                });

                let results = join_all(futures).await;
                for result in results {
                    match result {
                        Ok((key, content)) => {
                            info!(
                                "[AI分析] 维度 '{}' 返回内容长度: {} bytes",
                                key,
                                content.len()
                            );
                            let cleaned = extract_json_block(&content);
                            match serde_json::from_str::<serde_json::Value>(cleaned) {
                                Ok(value) => {
                                    if let Some(obj) = value.as_object() {
                                        info!(
                                            "[AI分析] 维度 '{}' 解析为对象，包含字段: {:?}",
                                            key,
                                            obj.keys().collect::<Vec<_>>()
                                        );
                                        for (k, v) in obj {
                                            combined.insert(k.clone(), v.clone());
                                            info!(
                                                "[AI分析] 合并字段: {} (类型: {})",
                                                k,
                                                if v.is_object() {
                                                    "object"
                                                } else if v.is_array() {
                                                    "array"
                                                } else {
                                                    "other"
                                                }
                                            );
                                        }
                                    } else {
                                        info!(
                                            "[AI分析] 维度 '{}' 解析为非对象，作为字符串保存",
                                            key
                                        );
                                        combined.insert(
                                            key.to_string(),
                                            serde_json::Value::String(content),
                                        );
                                    }
                                }
                                Err(e) => {
                                    error!("[AI分析] 维度 '{}' JSON解析失败: {}", key, e);
                                    combined.insert(
                                        key.to_string(),
                                        serde_json::Value::String(content),
                                    );
                                    errors.push(format!("{}: invalid json", key));
                                }
                            }
                        }
                        Err(e) => {
                            error!("[AI分析] 维度生成失败: {}", e);
                            errors.push(e);
                        }
                    }
                }
            } else {
                for (key, pid) in parts {
                    let template = prompt_manager_clone
                        .get_prompt(&app, pid)
                        .map_err(|e| format!("Failed to load summary analysis prompt: {}", e))?;
                    let prompt = analysis_data.fill_prompt(&template);
                    info!(
                        "Generating AI analysis part '{}' for summary {} using model {} on provider {}",
                        key, summary_id, model, provider.id
                    );

                    match call_llm(prompt, provider.clone(), api_key.clone(), model.clone()).await {
                        Ok(content) => {
                            info!(
                                "[AI分析] 维度 '{}' 返回内容长度: {} bytes",
                                key,
                                content.len()
                            );
                            let cleaned = extract_json_block(&content);
                            match serde_json::from_str::<serde_json::Value>(cleaned) {
                                Ok(value) => {
                                    if let Some(obj) = value.as_object() {
                                        info!(
                                            "[AI分析] 维度 '{}' 解析为对象，包含字段: {:?}",
                                            key,
                                            obj.keys().collect::<Vec<_>>()
                                        );
                                        for (k, v) in obj {
                                            combined.insert(k.clone(), v.clone());
                                            info!(
                                                "[AI分析] 合并字段: {} (类型: {})",
                                                k,
                                                if v.is_object() {
                                                    "object"
                                                } else if v.is_array() {
                                                    "array"
                                                } else {
                                                    "other"
                                                }
                                            );
                                        }
                                    } else {
                                        info!(
                                            "[AI分析] 维度 '{}' 解析为非对象，作为字符串保存",
                                            key
                                        );
                                        combined.insert(
                                            key.to_string(),
                                            serde_json::Value::String(content),
                                        );
                                    }
                                }
                                Err(e) => {
                                    error!("[AI分析] 维度 '{}' JSON解析失败: {}", key, e);
                                    combined.insert(
                                        key.to_string(),
                                        serde_json::Value::String(content),
                                    );
                                    errors.push(format!("{}: invalid json", key));
                                }
                            }
                        }
                        Err(e) => {
                            error!("[AI分析] 维度 '{}' 生成失败: {}", key, e);
                            errors.push(format!("{}: {}", key, e));
                        }
                    }
                }
            }

            if !errors.is_empty() {
                combined.insert(
                    "__errors".to_string(),
                    serde_json::Value::Array(
                        errors.into_iter().map(serde_json::Value::String).collect(),
                    ),
                );
            }

            info!(
                "[AI分析] 拆分模式完成，最终合并的字段: {:?}",
                combined.keys().collect::<Vec<_>>()
            );
            serde_json::Value::Object(combined).to_string()
        } else {
            let prompt_template = prompt_template
                .ok_or_else(|| "Prompt template missing for combined analysis".to_string())?;
            let prompt = analysis_data.fill_prompt(&prompt_template);
            info!(
                "Generating AI analysis for summary {} using model {} on provider {}",
                summary_id, model, provider.id
            );
            call_llm(prompt, provider, api_key, model.clone()).await?
        };

        info!(
            "AI analysis generated for summary {}: {}...",
            summary_id,
            ai_summary.chars().take(50).collect::<String>()
        );

        // Parse and extract vocabulary → write to hotwords as suggested
        let hotword_manager_clone = app
            .try_state::<Arc<crate::managers::HotwordManager>>()
            .map(|s| s.inner().clone());

        extract_and_save_vocabulary(&ai_summary, hotword_manager_clone.as_deref()).await;

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
#[allow(dead_code)]
struct VocabularyItem {
    word: String,
    category: Option<String>,
    originals: Option<Vec<String>>,
    // Legacy fields (still accepted for backward compat)
    frequency_count: Option<i32>,
    frequency_type: Option<String>,
    possible_typo: Option<bool>,
    similar_suggestions: Option<Vec<String>>,
    context_sample: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum VocabularyItems {
    Strings(Vec<String>),
    Objects(Vec<VocabularyItem>),
}

#[derive(Deserialize)]
struct VocabularySection {
    #[allow(dead_code)]
    title: Option<String>,
    items: Option<VocabularyItems>,
}

#[derive(Deserialize)]
struct AiAnalysisResponse {
    vocabulary_extracted: Option<VocabularySection>,
}

/// Map AI category string to hotword category id
fn map_ai_category_to_hotword(cat: &str) -> String {
    match cat {
        "Person" | "person" => "person".to_string(),
        "Brand" | "brand" | "Project" => "brand".to_string(),
        "Abbreviation" | "abbreviation" => "abbreviation".to_string(),
        _ => "term".to_string(),
    }
}

async fn extract_and_save_vocabulary(
    json_text: &str,
    hotword_manager: Option<&crate::managers::HotwordManager>,
) {
    let Some(hotword_manager) = hotword_manager else {
        log::warn!("HotwordManager not available for vocabulary extraction");
        return;
    };

    info!(
        "[词汇提取] JSON 文本前 200 字符: {}",
        &json_text.chars().take(200).collect::<String>()
    );

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
                // Collect items as (target, originals, category) for hotword suggestion
                let mut suggested: Vec<(String, Vec<String>, String)> = Vec::new();

                match items {
                    VocabularyItems::Strings(strings) => {
                        info!("[词汇提取] 字符串数组格式，{} 个词汇", strings.len());
                        for word_str in &strings {
                            let trimmed = word_str.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            // Parse "Word (类型)" format
                            let (word, cat_hint) = if let Some(open_paren) = trimmed.rfind('(') {
                                if let Some(close_paren) = trimmed.rfind(')') {
                                    if open_paren < close_paren && close_paren == trimmed.len() - 1
                                    {
                                        let w = trimmed[..open_paren].trim();
                                        let hint = trimmed[open_paren + 1..close_paren].trim();
                                        (w.to_string(), Some(hint.to_string()))
                                    } else {
                                        (trimmed.to_string(), None)
                                    }
                                } else {
                                    (trimmed.to_string(), None)
                                }
                            } else {
                                (trimmed.to_string(), None)
                            };

                            if !word.is_empty() {
                                let inferred_cat =
                                    crate::managers::HotwordManager::infer_category(&word);
                                let category = cat_hint
                                    .as_deref()
                                    .map(|h| match h {
                                        "人名" | "同事" => "person".to_string(),
                                        "品牌" | "产品" | "项目" | "模块" => {
                                            "brand".to_string()
                                        }
                                        _ => inferred_cat.clone(),
                                    })
                                    .unwrap_or(inferred_cat);
                                suggested.push((word, vec![], category));
                            }
                        }
                    }
                    VocabularyItems::Objects(objects) => {
                        info!("[词汇提取] 对象数组格式，{} 个词汇", objects.len());
                        for item in &objects {
                            let word = item.word.trim();
                            if word.is_empty() {
                                continue;
                            }

                            let category = item
                                .category
                                .as_deref()
                                .map(map_ai_category_to_hotword)
                                .unwrap_or_else(|| {
                                    crate::managers::HotwordManager::infer_category(word)
                                });

                            let originals = item.originals.clone().unwrap_or_default();

                            suggested.push((word.to_string(), originals, category));
                        }
                    }
                }

                if !suggested.is_empty() {
                    match hotword_manager.add_suggested(suggested.clone()) {
                        Ok(added) => {
                            info!("[词汇提取] 写入 {} 条建议热词", added.len());
                        }
                        Err(e) => {
                            log::error!("[词汇提取] 写入建议热词失败: {}", e);
                        }
                    }
                } else {
                    info!("[词汇提取] 无可保存的词汇");
                }
            }
        }
    } else {
        log::error!("[词汇提取] JSON 解析失败: {:?}", response.err());
    }
}
