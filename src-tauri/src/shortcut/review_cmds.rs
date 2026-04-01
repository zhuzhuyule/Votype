use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings;

#[tauri::command]
#[specta::specta]
pub fn confirm_reviewed_transcription(
    app: AppHandle,
    text: String,
    history_id: Option<i64>,
    cached_model_id: Option<String>,
    learn_from_edit: bool,
    original_text_for_learning: Option<String>,
) -> Result<(), String> {
    use std::time::Duration;

    log::info!(
        "confirm_reviewed_transcription: inserting {} chars, history_id={:?}, cached_model_id={:?}, learn_from_edit={}, has_original_text_for_learning={}",
        text.len(),
        history_id,
        cached_model_id,
        learn_from_edit,
        original_text_for_learning.is_some()
    );

    if let Some(ppm) =
        app.try_state::<std::sync::Arc<crate::managers::post_processing::PostProcessingManager>>()
    {
        ppm.cancel_pipeline();
        log::info!("confirm_reviewed_transcription: cancelled remaining post-processing tasks");
    }
    if let Some(coordinator) =
        app.try_state::<crate::transcription_coordinator::TranscriptionCoordinator>()
    {
        coordinator.notify_processing_finished();
        log::info!("confirm_reviewed_transcription: reset transcription coordinator to idle");
    }

    // Resolve the actual model_id from cached_model_id
    let cached_model_id_for_stats = cached_model_id.clone();
    let model_id = cached_model_id.and_then(|cm_id| {
        let settings = settings::get_settings(&app);
        settings
            .get_cached_model(&cm_id)
            .map(|cm| cm.model_id.clone())
    });

    if let Some(cached_model_id) = cached_model_id_for_stats {
        let mut settings = settings::get_settings(&app);
        let entry = settings
            .multi_model_manual_pick_counts
            .entry(cached_model_id)
            .or_insert(0);
        *entry += 1;
        settings::write_settings(&app, settings);
    }

    // Update history with the selected/inserted text
    if let Some(hid) = history_id {
        let app_for_history = app.clone();
        let text_for_history = text.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(hm) = app_for_history
                .try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
            {
                if let Err(e) = hm
                    .update_reviewed_text(
                        hid,
                        text_for_history,
                        learn_from_edit,
                        original_text_for_learning.clone(),
                    )
                    .await
                {
                    log::error!("Failed to update history with reviewed text: {}", e);
                }
                // Update model name if the user selected a specific candidate
                if let Some(model_name) = model_id {
                    if let Err(e) = hm.update_post_process_model(hid, &model_name) {
                        log::error!("Failed to update model in history: {}", e);
                    }
                }
            }
        });
    }

    // Hide the review window
    crate::review_window::hide_review_window(&app, history_id);

    // Focus the previously active window and paste
    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app: {}", e);
        } else {
            std::thread::sleep(Duration::from_millis(120));
        }
    }

    crate::clipboard::paste(text, app)
}

#[tauri::command]
#[specta::specta]
pub fn cancel_transcription_review(
    app: AppHandle,
    text: Option<String>,
    history_id: Option<i64>,
) -> Result<(), String> {
    log::info!(
        "cancel_transcription_review: history_id={:?}, has_text={}",
        history_id,
        text.is_some()
    );

    if let Some(ppm) =
        app.try_state::<std::sync::Arc<crate::managers::post_processing::PostProcessingManager>>()
    {
        ppm.cancel_pipeline();
        log::info!("cancel_transcription_review: cancelled remaining post-processing tasks");
    }
    if let Some(coordinator) =
        app.try_state::<crate::transcription_coordinator::TranscriptionCoordinator>()
    {
        coordinator.notify_processing_finished();
        log::info!("cancel_transcription_review: reset transcription coordinator to idle");
    }

    // Hide the review window
    crate::review_window::hide_review_window(&app, history_id);

    // Restore focus to previous window
    if let Some(info) = crate::review_window::get_last_active_window() {
        if let Err(e) = crate::active_window::focus_app_by_pid(info.process_id) {
            log::warn!("Failed to focus previous app on cancel: {}", e);
        }
    }

    // Mark the post-process result as rejected for smart routing feedback
    if let Some(hid) = history_id {
        let app_for_reject = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(hm) = app_for_reject
                .try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
            {
                if let Err(e) = hm.reject_post_process_result(hid).await {
                    log::error!("Failed to mark post-process result as rejected: {}", e);
                }
            }
        });
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_review_editor_active_state(active: bool) {
    crate::review_window::set_review_editor_active(active);
}

#[tauri::command]
#[specta::specta]
pub fn set_review_editor_content_state(text: String) {
    crate::review_window::set_review_editor_content(text);
}

// Group: Single-Model Rerun with Prompt

#[derive(Serialize, Clone, Type)]
pub struct RerunSingleResult {
    pub text: Option<String>,
    pub error: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn rerun_single_with_prompt(
    app: AppHandle,
    prompt_id: String,
    source_text: String,
    history_id: Option<i64>,
    model_id: Option<String>,
) -> Result<RerunSingleResult, String> {
    let settings = settings::get_settings(&app);

    // Handle built-in "pass through" — return source text as-is
    if prompt_id == "__PASS_THROUGH__" {
        return Ok(RerunSingleResult {
            text: Some(source_text),
            error: None,
            model: Some("无模型".to_string()),
        });
    }

    // Find the prompt by id (handle built-in lite polish)
    let mut prompt = if prompt_id == "__LITE_POLISH__" {
        let prompt_manager = app.state::<std::sync::Arc<crate::managers::prompt::PromptManager>>();
        let lite_instructions = prompt_manager
            .get_prompt(&app, "system_lite_polish")
            .unwrap_or_else(|_| "Fix minor ASR errors. Output corrected text only.".to_string());
        let mut p = crate::settings::LLMPrompt::default();
        p.id = "__LITE_POLISH__".to_string();
        p.name = "轻量润色".to_string();
        p.instructions = lite_instructions;
        p
    } else {
        let skill_manager = crate::managers::skill::SkillManager::new(&app);
        skill_manager
            .get_all_skills()
            .into_iter()
            .find(|p| p.id == prompt_id)
            .ok_or_else(|| format!("Prompt not found: {}", prompt_id))?
    };

    // Override prompt's model_id if caller specified one
    if model_id.is_some() {
        prompt.model_id = model_id;
    }

    // Get active window info for context
    let active_window = crate::review_window::get_last_active_window();
    let ctx_app_name = active_window.as_ref().map(|w| w.app_name.clone());
    let ctx_window_title = active_window.as_ref().map(|w| w.title.clone());

    // Call post_process_text_with_prompt to reprocess
    let (result, model_used, _prompt_id, err, error_message) =
        crate::actions::post_process::post_process_text_with_prompt(
            &app,
            &settings,
            &source_text,
            None,
            &prompt,
            false,
            ctx_app_name,
            ctx_window_title,
            history_id,
        )
        .await;

    if err {
        Ok(RerunSingleResult {
            text: None,
            error: Some(error_message.unwrap_or_else(|| "LLM request failed".to_string())),
            model: model_used,
        })
    } else {
        Ok(RerunSingleResult {
            text: result,
            error: None,
            model: model_used,
        })
    }
}

// Group: Multi-Model Post-Process Review Commands

#[derive(Serialize, Clone, Type)]
pub struct PromptInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Type)]
pub struct PromptListResponse {
    pub prompts: Vec<PromptInfo>,
    pub selected_id: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn get_post_process_prompts(app: AppHandle) -> PromptListResponse {
    let settings = settings::get_settings(&app);
    let skill_manager = crate::managers::skill::SkillManager::new(&app);

    // Only user-owned prompts are available for actual use.
    let mut all_prompts: Vec<PromptInfo> = skill_manager
        .get_all_skills()
        .into_iter()
        .filter(|p| p.enabled)
        .map(|p| PromptInfo {
            id: p.id.clone(),
            name: p.name.clone(),
        })
        .collect();

    // Apply saved drag-and-drop ordering (same logic as SkillManager::apply_ordering)
    let order = skill_manager.load_order();
    if !order.is_empty() {
        let order_map: std::collections::HashMap<&str, usize> = order
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();
        all_prompts.sort_by(|a, b| {
            let pos_a = order_map.get(a.id.as_str());
            let pos_b = order_map.get(b.id.as_str());
            match (pos_a, pos_b) {
                (Some(pa), Some(pb)) => pa.cmp(pb),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.name.cmp(&b.name),
            }
        });
    }

    // Prepend built-in prompts
    all_prompts.insert(
        0,
        PromptInfo {
            id: "__LITE_POLISH__".to_string(),
            name: "轻量润色".to_string(),
        },
    );
    all_prompts.insert(
        0,
        PromptInfo {
            id: "__PASS_THROUGH__".to_string(),
            name: "无需润色".to_string(),
        },
    );

    PromptListResponse {
        prompts: all_prompts,
        selected_id: settings.post_process_selected_prompt_id.clone(),
    }
}

#[derive(Serialize, Clone, Type)]
pub struct ReviewModelOption {
    pub id: String,
    pub label: String,
    pub model_id: String,
    pub provider_id: String,
}

#[derive(Serialize, Clone, Type)]
pub struct ReviewModelOptionsResponse {
    pub models: Vec<ReviewModelOption>,
    /// The cached_model.id of the current default model (resolved from settings)
    pub default_model_id: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn get_review_model_options(app: AppHandle) -> ReviewModelOptionsResponse {
    let settings = settings::get_settings(&app);

    // Resolve default model: selected_prompt_model takes priority
    let default_model_id = settings
        .selected_prompt_model
        .as_ref()
        .map(|c| &c.primary_id)
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| {
            settings
                .cached_models
                .iter()
                .find(|m| m.id == *id)
                .map(|_| id.clone())
        });

    let mut models: Vec<ReviewModelOption> = settings
        .cached_models
        .iter()
        .filter(|m| m.model_type == settings::ModelType::Text)
        .map(|m| {
            let label = m
                .custom_label
                .as_deref()
                .filter(|l| !l.trim().is_empty())
                .unwrap_or(&m.name)
                .to_string();
            ReviewModelOption {
                id: m.id.clone(),
                label,
                model_id: m.model_id.clone(),
                provider_id: m.provider_id.clone(),
            }
        })
        .collect();

    // Sort alphabetically by label
    models.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));

    ReviewModelOptionsResponse {
        models,
        default_model_id,
    }
}

#[tauri::command]
#[specta::specta]
pub fn rerun_multi_model_with_prompt(
    app: AppHandle,
    prompt_id: String,
    source_text: String,
    history_id: Option<i64>,
) -> Result<(), String> {
    let settings = settings::get_settings(&app);

    // Build multi-model items with the specified prompt_id
    let items: Vec<settings::MultiModelPostProcessItem> = settings
        .multi_model_selected_ids
        .iter()
        .filter_map(|id| {
            let cm = settings.get_cached_model(id)?;
            if cm.model_type != settings::ModelType::Text {
                return None;
            }
            Some(settings::MultiModelPostProcessItem {
                id: cm.id.clone(),
                provider_id: cm.provider_id.clone(),
                model_id: cm.model_id.clone(),
                prompt_id: prompt_id.clone(),
                custom_label: cm.custom_label.clone(),
                enabled: true,
            })
        })
        .collect();

    if items.is_empty() {
        return Err("No models selected".to_string());
    }

    // Build initial loading candidates
    let initial_candidates: Vec<crate::review_window::MultiModelCandidate> = items
        .iter()
        .map(|item| {
            let provider_label = settings
                .post_process_provider(&item.provider_id)
                .map(|p| p.label.clone())
                .unwrap_or_else(|| item.provider_id.clone());
            let label = item
                .custom_label
                .clone()
                .unwrap_or_else(|| item.model_id.clone());
            crate::review_window::MultiModelCandidate {
                id: item.id.clone(),
                label,
                provider_label,
                text: String::new(),
                confidence: None,
                processing_time_ms: 0,
                error: None,
                ready: false,
            }
        })
        .collect();

    // Emit loading candidates to reset the review window
    let _ = app.emit(
        "multi-model-rerun-reset",
        serde_json::json!({
            "candidates": initial_candidates,
        }),
    );

    // Spawn async task for re-processing
    let app_clone = app.clone();
    let source_clone = source_text.clone();
    // Get active window info for history context
    let active_window = crate::review_window::get_last_active_window();
    let ctx_app_name = active_window.as_ref().map(|w| w.app_name.clone());
    let ctx_window_title = active_window.as_ref().map(|w| w.title.clone());

    let prompt_id_clone = prompt_id.clone();
    tauri::async_runtime::spawn(async move {
        // Build a modified settings with the overridden prompt for item lookup
        let mut rerun_settings = settings.clone();
        rerun_settings.multi_model_post_process_enabled = true;
        // Clear selected_ids so the function falls back to multi_model_post_process_items
        rerun_settings.multi_model_selected_ids = vec![];
        rerun_settings.multi_model_post_process_items = items;

        // Use the raw multi-model pipeline (it will use items directly)
        let _results = crate::actions::post_process::multi_post_process_transcription(
            &app_clone,
            &rerun_settings,
            &source_clone,
            None,
            history_id,
            ctx_app_name,
            ctx_window_title,
            Some(prompt_id_clone),
        )
        .await;
    });

    Ok(())
}
