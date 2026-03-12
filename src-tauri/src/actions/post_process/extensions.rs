use crate::managers::history::HistoryManager;
use crate::settings::{AppSettings, MultiModelPostProcessItem};
use async_openai::types::{
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use futures_util::stream::{FuturesUnordered, StreamExt};
use log::{error, info};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep_until, Instant as TokioInstant};

pub async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        return None;
    }

    let config = if is_simplified {
        BuiltinConfig::Tw2sp
    } else {
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => Some(converter.convert(transcription)),
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}", e);
            None
        }
    }
}

#[allow(dead_code)]
/// Execute multi-model parallel post-processing
/// Returns all results when all models complete, or partial results if cancelled
pub async fn multi_post_process_transcription(
    _app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    _history_id: Option<i64>,
    app_name: Option<String>,
    window_title: Option<String>,
    override_prompt_id: Option<String>,
) -> Vec<super::MultiModelPostProcessResult> {
    // Check if multi-model post-processing is enabled

    if !settings.multi_model_post_process_enabled {
        info!("[MultiModel] Multi-model post-processing is disabled");
        return Vec::new();
    }

    // Prefer checkbox-based selection; fall back to legacy items
    let built_items = settings.build_multi_model_items_from_selection();
    let mut items_owned: Vec<MultiModelPostProcessItem>;
    let items: Vec<&MultiModelPostProcessItem>;
    if !built_items.is_empty() {
        items_owned = built_items;
    } else {
        items_owned = settings
            .enabled_multi_model_items()
            .into_iter()
            .cloned()
            .collect();
    }

    // Override prompt_id when app-specific prompt is configured
    if let Some(ref oid) = override_prompt_id {
        info!("[MultiModel] Overriding prompt_id to: {}", oid);
        for item in &mut items_owned {
            item.prompt_id = oid.clone();
        }
    } else {
        info!(
            "[MultiModel] No override_prompt_id, using default: {:?}",
            items_owned.first().map(|i| &i.prompt_id)
        );
    }

    items = items_owned.iter().collect();
    if items.is_empty() {
        info!("[MultiModel] No enabled multi-model items configured");
        return Vec::new();
    }

    info!(
        "[MultiModel] Starting multi-model post-processing with {} models, prompt_id: {:?}",
        items.len(),
        items.first().map(|i| &i.prompt_id)
    );

    // Emit start event
    let _ = _app_handle.emit(
        "multi-post-process-start",
        serde_json::json!({
            "total": items.len(),
            "transcription_length": transcription.len()
        }),
    );

    // Input data is now built per-model inside execute_single_model_post_process
    // using PromptBuilder, which respects each skill's variable declarations.

    // Build history context (shared across all models)
    let shared_history_entries: Vec<String> = if settings.post_process_context_enabled {
        if let Some(app) = &app_name {
            if let Some(hm) = _app_handle.try_state::<Arc<HistoryManager>>() {
                match hm.get_recent_history_texts_for_app(
                    app,
                    window_title.as_deref(),
                    None,
                    None,
                    settings.post_process_context_limit as usize,
                    _history_id,
                ) {
                    Ok(history) if !history.is_empty() => {
                        info!(
                            "[MultiModel] Fetched {} history entries as context",
                            history.len()
                        );
                        history
                    }
                    Ok(_) => Vec::new(),
                    Err(e) => {
                        error!("[MultiModel] Failed to fetch history context: {}", e);
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // Measure "speed" from the user's perspective: from batch start until the
    // full result for each model is available.
    let batch_start_time = Instant::now();

    // Create futures for each model
    let mut futures: FuturesUnordered<_> = items
        .iter()
        .map(|item| {
            let settings = settings.clone();
            let app_handle = _app_handle.clone();
            let transcription = transcription.to_string();
            let streaming = streaming_transcription.map(|s| s.to_string());
            let history = shared_history_entries.clone();
            let batch_start_time = batch_start_time;

            async move {
                let result = execute_single_model_post_process(
                    &app_handle,
                    &settings,
                    item,
                    &transcription,
                    streaming.as_deref(),
                    history.clone(),
                )
                .await;

                let elapsed = batch_start_time.elapsed().as_millis() as u64;

                let text = result.0.clone().unwrap_or_default();
                let ready = result.0.is_some();

                super::MultiModelPostProcessResult {
                    id: item.id.clone(),
                    label: get_item_label(&settings, item),
                    text,
                    confidence: None,
                    processing_time_ms: elapsed,
                    error: result.1,
                    ready,
                }
            }
        })
        .collect();

    let mut all_results: Vec<super::MultiModelPostProcessResult> = Vec::new();
    let total = items.len();

    let strategy = settings.multi_model_strategy.as_str();
    let preferred_model_id = if strategy == "lazy" {
        settings
            .selected_prompt_model_id
            .clone()
            .filter(|id| items.iter().any(|item| item.id == *id))
    } else {
        None
    };
    let timeout_deadline = TokioInstant::now() + Duration::from_secs(3);
    let mut timeout_elapsed = false;

    // Collect results as they complete
    while !futures.is_empty() {
        let next_result = if strategy == "lazy" {
            tokio::select! {
                result = futures.next() => result,
                _ = sleep_until(timeout_deadline), if !timeout_elapsed => {
                    timeout_elapsed = true;
                    if let Some(preferred) = preferred_model_id
                        .as_ref()
                        .and_then(|id| find_ready_result(&all_results, id))
                    {
                        info!("[MultiModel] Lazy mode selected preferred model at timeout: {}", preferred.id);
                        emit_multi_complete(_app_handle, total, all_results.len(), vec![preferred.clone()]);
                        return vec![preferred.clone()];
                    }
                    if let Some(best) = find_latest_ready_result(&all_results) {
                        info!("[MultiModel] Lazy mode selected latest ready result at timeout: {}", best.id);
                        emit_multi_complete(_app_handle, total, all_results.len(), vec![best.clone()]);
                        return vec![best.clone()];
                    }
                    continue;
                }
            }
        } else {
            futures.next().await
        };

        let Some(result) = next_result else {
            break;
        };

        all_results.push(result.clone());
        let completed = all_results.len();

        info!(
            "[MultiModel] Progress: {}/{} completed (id: {})",
            completed, total, result.id
        );

        // Emit progress event
        let _ = _app_handle.emit(
            "multi-post-process-progress",
            super::MultiModelProgressEvent {
                total,
                completed,
                results: all_results.clone(),
                done: completed >= total,
            },
        );

        if strategy == "race" && result.ready && result.error.is_none() {
            info!(
                "[MultiModel] Race mode winner: id={}, completed={}/{}",
                result.id, completed, total
            );
            emit_multi_complete(_app_handle, total, completed, vec![result.clone()]);
            return vec![result];
        }

        if strategy == "lazy" {
            if !timeout_elapsed {
                if let Some(preferred_id) = preferred_model_id.as_ref() {
                    if result.ready && result.error.is_none() && &result.id == preferred_id {
                        info!(
                            "[MultiModel] Lazy mode preferred model arrived within timeout: {}",
                            result.id
                        );
                        emit_multi_complete(_app_handle, total, completed, vec![result.clone()]);
                        return vec![result];
                    }
                }
            } else if result.ready && result.error.is_none() {
                info!(
                    "[MultiModel] Lazy mode selected first result after timeout: {}",
                    result.id
                );
                emit_multi_complete(_app_handle, total, completed, vec![result.clone()]);
                return vec![result];
            } else if let Some(best) = find_latest_ready_result(&all_results) {
                info!(
                    "[MultiModel] Lazy mode selected latest ready result after timeout progress: {}",
                    best.id
                );
                emit_multi_complete(_app_handle, total, completed, vec![best.clone()]);
                return vec![best];
            }
        }
    }

    if strategy == "lazy" {
        if let Some(preferred) = preferred_model_id
            .as_ref()
            .and_then(|id| find_ready_result(&all_results, id))
        {
            info!(
                "[MultiModel] Lazy mode selected preferred model at completion: {}",
                preferred.id
            );
            emit_multi_complete(
                _app_handle,
                total,
                all_results.len(),
                vec![preferred.clone()],
            );
            return vec![preferred.clone()];
        }
        if let Some(best) = find_latest_ready_result(&all_results) {
            info!(
                "[MultiModel] Lazy mode selected latest ready result at completion: {}",
                best.id
            );
            emit_multi_complete(_app_handle, total, all_results.len(), vec![best.clone()]);
            return vec![best];
        }
    }

    info!("[MultiModel] All {} models completed", total);

    // Emit complete event
    let _ = _app_handle.emit(
        "multi-post-process-complete",
        super::MultiModelProgressEvent {
            total,
            completed: total,
            results: all_results.clone(),
            done: true,
        },
    );

    all_results
}

fn find_ready_result<'a>(
    results: &'a [super::MultiModelPostProcessResult],
    id: &str,
) -> Option<&'a super::MultiModelPostProcessResult> {
    results
        .iter()
        .find(|r| r.id == id && r.ready && r.error.is_none())
}

fn find_latest_ready_result(
    results: &[super::MultiModelPostProcessResult],
) -> Option<super::MultiModelPostProcessResult> {
    results
        .iter()
        .rev()
        .find(|r| r.ready && r.error.is_none())
        .cloned()
}

fn emit_multi_complete(
    app_handle: &AppHandle,
    total: usize,
    completed: usize,
    results: Vec<super::MultiModelPostProcessResult>,
) {
    let _ = app_handle.emit(
        "multi-post-process-complete",
        super::MultiModelProgressEvent {
            total,
            completed,
            results,
            done: true,
        },
    );
}

#[allow(dead_code)]
/// Execute post-processing for a single model using PromptBuilder
async fn execute_single_model_post_process(
    _app_handle: &AppHandle,
    settings: &AppSettings,
    item: &MultiModelPostProcessItem,
    transcription: &str,
    streaming_transcription: Option<&str>,
    history_entries: Vec<String>,
) -> (Option<String>, Option<String>) {
    // Get provider
    let provider = match settings.post_process_provider(&item.provider_id) {
        Some(p) => p,
        None => {
            error!("[MultiModel] Provider not found: {}", item.provider_id);
            return (None, Some("Provider not found".to_string()));
        }
    };

    // Use the model_id from the item directly (each item specifies its own model)
    let model = item.model_id.clone();

    // Get prompt — merge external skills so we can find prompts from filesystem too
    let skill_manager = crate::managers::skill::SkillManager::new(_app_handle);
    let external_skills = skill_manager.load_all_external_skills();
    let mut all_prompts = settings.post_process_prompts.clone();
    for file_skill in external_skills {
        if !all_prompts.iter().any(|p| p.id == file_skill.id) {
            all_prompts.push(file_skill);
        }
    }
    let prompt = match all_prompts.iter().find(|p| p.id == item.prompt_id) {
        Some(p) => {
            info!(
                "[MultiModel] Resolved prompt: id={}, name=\"{}\", instructions_len={}",
                p.id,
                p.name,
                p.instructions.len()
            );
            p
        }
        None => {
            error!(
                "[MultiModel] Prompt not found: {}, available: {:?}",
                item.prompt_id,
                all_prompts.iter().map(|p| &p.id).collect::<Vec<_>>()
            );
            return (None, Some("Prompt not found".to_string()));
        }
    };

    // Get API key
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Use PromptBuilder for unified variable processing
    let built = super::prompt_builder::PromptBuilder::new(prompt, transcription)
        .streaming_transcription(streaming_transcription)
        .history_entries(history_entries)
        .injection_policy(super::prompt_builder::InjectionPolicy::for_post_process(
            settings,
        ))
        .build();

    // Build messages
    let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();

    // 1. Single system message
    if !built.system_prompt.is_empty() {
        if let Ok(sys_msg) = ChatCompletionRequestSystemMessageArgs::default()
            .content(built.system_prompt)
            .build()
        {
            messages.push(ChatCompletionRequestMessage::System(sys_msg));
        }
    }

    // 2. Single user message
    if let Some(user_content) = built.user_message {
        if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
            .content(user_content)
            .build()
        {
            messages.push(ChatCompletionRequestMessage::User(user_msg));
        }
    }

    if messages.is_empty() {
        return (None, Some("Failed to build messages".to_string()));
    }

    // Build request
    let model_id = model.clone();
    let req = match CreateChatCompletionRequestArgs::default()
        .model(model_id.clone())
        .messages(messages)
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            error!("[MultiModel] Failed to build request: {:?}", e);
            return (None, Some(format!("Request build failed: {:?}", e)));
        }
    };

    // Create client and execute
    let client = match crate::llm_client::create_client(provider, api_key) {
        Ok(c) => c,
        Err(e) => {
            error!("[MultiModel] Failed to create LLM client: {:?}", e);
            return (None, Some(format!("Client creation failed: {:?}", e)));
        }
    };

    let response = match client.chat().create(req).await {
        Ok(r) => r,
        Err(e) => {
            error!("[MultiModel] LLM request failed: {:?}", e);
            return (None, Some(format!("LLM request failed: {:?}", e)));
        }
    };

    let content = match response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
    {
        Some(c) => c,
        None => {
            return (None, Some("Empty response".to_string()));
        }
    };

    let text = super::core::extract_llm_text(&content);

    info!(
        "[MultiModel] Model {} completed, text length: {}",
        item.id,
        text.len(),
    );

    (Some(text), None)
}

#[allow(dead_code)]
/// Get display label for a multi-model item
fn get_item_label(settings: &AppSettings, item: &MultiModelPostProcessItem) -> String {
    if let Some(custom) = &item.custom_label {
        return custom.clone();
    }

    let provider_label = settings
        .post_process_provider(&item.provider_id)
        .map(|p| p.label.clone())
        .unwrap_or_else(|| item.provider_id.clone());

    let model_name = settings
        .post_process_models
        .get(&item.provider_id)
        .cloned()
        .unwrap_or_else(|| item.model_id.clone());

    let prompt_name = settings
        .get_prompt(&item.prompt_id)
        .map(|p| p.name.clone())
        .unwrap_or_else(|| item.prompt_id.clone());

    format!("{} {} + {}", provider_label, model_name, prompt_name)
}
