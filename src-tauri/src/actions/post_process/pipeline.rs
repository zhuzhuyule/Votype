use crate::managers::history::HistoryManager;
use crate::managers::HotwordManager;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{AppSettings, HotwordScenario};
use log::{debug, error, info};
use std::borrow::Cow;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Detect usage scenario from app name
fn detect_scenario(app_name: &Option<String>) -> Option<HotwordScenario> {
    let work_apps = [
        "Code", "VSCode", "Cursor", "Terminal", "iTerm", "Slack", "Notion", "Figma", "Xcode",
        "IntelliJ",
    ];
    let casual_apps = ["WeChat", "Messages", "Telegram", "WhatsApp", "Discord"];

    if let Some(name) = app_name {
        for app in work_apps {
            if name.contains(app) {
                return Some(HotwordScenario::Work);
            }
        }
        for app in casual_apps {
            if name.contains(app) {
                return Some(HotwordScenario::Casual);
            }
        }
    }
    None // Both scenarios apply
}

pub async fn maybe_post_process_transcription(
    app_handle: &AppHandle,
    settings: &AppSettings,
    transcription: &str,
    streaming_transcription: Option<&str>,
    show_overlay: bool,
    override_prompt_id: Option<String>,
    app_name: Option<String>,
    window_title: Option<String>,
    match_pattern: Option<String>,
    match_type: Option<crate::settings::TitleMatchType>,
    history_id: Option<i64>,
    skill_mode: bool,
    selected_text: Option<String>,
) -> (Option<String>, Option<String>, Option<String>, bool) {
    if !settings.post_process_enabled {
        return (None, None, None, false);
    }

    // Length routing: override selected_prompt_model_id based on text length
    let settings = if settings.length_routing_enabled && !settings.multi_model_post_process_enabled
    {
        let char_count = transcription.chars().count() as u32;
        let routed_model_id = if char_count <= settings.length_routing_threshold {
            settings.length_routing_short_model_id.clone()
        } else {
            settings.length_routing_long_model_id.clone()
        };
        if routed_model_id.is_some() {
            let mut s = settings.clone();
            s.selected_prompt_model_id = routed_model_id;
            info!(
                "[PostProcess] Length routing: {} chars → model {:?}",
                char_count, s.selected_prompt_model_id
            );
            Cow::Owned(s)
        } else {
            Cow::Borrowed(settings)
        }
    } else {
        Cow::Borrowed(settings)
    };
    let settings = settings.as_ref();

    let fallback_provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false),
    };

    // Load external skills (Phase 9)
    let skill_manager = crate::managers::skill::SkillManager::new(app_handle);
    let external_skills = skill_manager.load_all_external_skills();

    // Merge skills with same logic as merge_external_skills:
    // - Builtin skills take priority over external skills with same ID
    // - Customized skills (customized=true) are not overwritten by file versions
    let mut all_prompts = settings.post_process_prompts.clone();

    for mut file_skill in external_skills {
        // Skip if ID conflicts with builtin skill
        if all_prompts
            .iter()
            .any(|p| p.id == file_skill.id && p.source == crate::settings::SkillSource::Builtin)
        {
            continue;
        }

        if let Some(existing) = all_prompts.iter().find(|p| p.id == file_skill.id) {
            // Keep user's customized version
            if existing.customized {
                continue;
            }

            // Update with file version while preserving customized state
            let pos = all_prompts
                .iter()
                .position(|p| p.id == file_skill.id)
                .unwrap();
            let was_customized = all_prompts[pos].customized;
            let old_file_path = all_prompts[pos].file_path.clone();

            all_prompts[pos] = file_skill;
            all_prompts[pos].customized = was_customized;
            all_prompts[pos].file_path = old_file_path;
        } else {
            // New skill, add it
            file_skill.customized = false;
            all_prompts.push(file_skill);
        }
    }

    // Resolve default prompt from the combined list
    let default_prompt = super::routing::get_default_prompt(
        &all_prompts,
        settings.post_process_selected_prompt_id.as_deref(),
        override_prompt_id.as_deref(),
    );

    let (mut initial_prompt_opt, mut initial_content, mut is_explicit) =
        super::routing::resolve_prompt_from_text(
            transcription,
            &all_prompts,
            default_prompt,
            override_prompt_id.as_deref(),
        );

    // Notify UI immediately about the specific prompt being used if it's an override (app/rule specific)
    if let (Some(p), true) = (&initial_prompt_opt, override_prompt_id.is_some()) {
        app_handle.emit("post-process-status", p.name.clone()).ok();
    }

    // --- Smart Routing Phase ---
    // Only perform LLM-based routing if skill_mode is enabled (dedicated shortcut pressed - Mode B)
    // For selected text (Mode C), we need user confirmation before executing skills
    let has_selected_text = selected_text
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    // Mode B: Skill shortcut pressed - do LLM routing and execute
    if skill_mode
        && !is_explicit
        && override_prompt_id.is_none()
        && !transcription.trim().is_empty()
    {
        if let Some(p) = &initial_prompt_opt {
            if let Some((route_provider, route_model, route_api_key)) =
                super::routing::resolve_intent_routing_model(settings, fallback_provider, p)
            {
                if let Some(route_response) = super::routing::perform_skill_routing(
                    app_handle,
                    route_api_key,
                    &all_prompts,
                    route_provider,
                    &route_model,
                    transcription,
                    selected_text.as_deref(),
                )
                .await
                {
                    let skill_id = &route_response.skill_id;
                    if let Some(routed_prompt) = all_prompts.iter().find(|p| &p.id == skill_id) {
                        // If routed to "default", we likely already have the default prompt selected in initial_prompt_opt
                        if skill_id != "default" {
                            initial_prompt_opt = Some(routed_prompt.clone());
                            is_explicit = true; // Mark as explicit so we don't treat it as default polish
                        }
                        info!(
                            "[PostProcess] Routed to skill \"{}\" via LLM (input_source: {:?})",
                            routed_prompt.name, route_response.input_source
                        );

                        // Use input_source to determine which content to use
                        initial_content = match route_response.input_source.as_deref() {
                            Some("select") => selected_text.clone().unwrap_or_default(),
                            Some("extract") => route_response
                                .extracted_content
                                .clone()
                                .unwrap_or_else(|| transcription.to_string()),
                            _ => transcription.to_string(), // "output" or unspecified
                        };

                        // Notify UI about the routed skill
                        app_handle
                            .emit("post-process-status", routed_prompt.name.clone())
                            .ok();
                    }
                }
            }
        }
    }

    // Intent Detection Mode: Only triggered when user has selected text
    // This prevents frequent popup triggers during normal transcription
    // When text is selected, the operation ALWAYS targets the selected content
    // User's speech is only used as intent/instruction hint
    // Note: Some LLM providers may not support concurrent requests, so we handle failures gracefully

    // DEBUG: Log condition checks
    info!(
        "[PostProcess] Intent detection conditions: skill_mode={}, is_explicit={}, override_prompt_id={:?}, transcription_empty={}, has_selected_text={}",
        skill_mode, is_explicit, override_prompt_id, transcription.trim().is_empty(), has_selected_text
    );

    if !skill_mode
        && !is_explicit
        && override_prompt_id.is_none()
        && !transcription.trim().is_empty()
        && has_selected_text
    // Only trigger intent detection when text is selected
    {
        info!("[PostProcess] Entering intent detection mode (has selected text)");

        // Switch overlay to LLM processing state and notify UI
        crate::overlay::show_llm_processing_overlay(app_handle);
        app_handle.emit("post-process-status", "正在润色中...").ok();

        if let Some(default_prompt) = &initial_prompt_opt {
            if let Some((route_provider, route_model, route_api_key)) =
                super::routing::resolve_intent_routing_model(
                    settings,
                    fallback_provider,
                    default_prompt,
                )
            {
                info!(
                    "[PostProcess] Starting parallel intent detection and polish - provider={}, model={}, selected_text={}",
                    route_provider.label, route_model, has_selected_text
                );

                // Execute both requests in parallel
                let (intent_result, polish_result) = tokio::join!(
                    // Intent detection
                    super::routing::perform_skill_routing(
                        app_handle,
                        route_api_key,
                        &all_prompts,
                        route_provider,
                        &route_model,
                        transcription,
                        selected_text.as_deref(),
                    ),
                    // Default polish
                    super::routing::execute_default_polish(
                        app_handle,
                        settings,
                        fallback_provider,
                        default_prompt,
                        transcription,
                    )
                );

                // Log results for debugging concurrency issues
                let intent_ok = intent_result.is_some();
                let polish_ok = polish_result.is_some();
                info!(
                    "[PostProcess] Parallel requests completed - Intent: {} (skill: {:?}), Polish: {} (len: {})",
                    if intent_ok { "OK" } else { "FAILED" },
                    intent_result.as_ref().map(|r| &r.skill_id),
                    if polish_ok { "OK" } else { "FAILED" },
                    polish_result.as_ref().map(|s| s.len()).unwrap_or(0)
                );

                // Handle different result combinations:
                // 1. Intent matched + Polish OK/Failed -> Show confirmation (polish_result may be None)
                // 2. Intent failed + Polish OK -> Use polish result directly
                // 3. Both failed -> Fall through to standard processing

                if let Some(route_response) = intent_result {
                    let skill_id = &route_response.skill_id;

                    info!(
                        "[PostProcess] Intent matched! skill_id={}, input_source={:?}, extracted_content={:?}",
                        skill_id, route_response.input_source, route_response.extracted_content
                    );

                    if let Some(routed_prompt) = all_prompts.iter().find(|p| &p.id == skill_id) {
                        info!(
                            "[PostProcess] Found matching prompt: name={}, output_mode={:?}, enabled={}",
                            routed_prompt.name, routed_prompt.output_mode, routed_prompt.enabled
                        );

                        // Check if this is the default skill - if so, skip confirmation and use polish result
                        // Compare with: 1) user-selected default prompt, 2) current default_prompt used for polish
                        let is_default_skill = settings
                            .post_process_selected_prompt_id
                            .as_ref()
                            .map(|default_id| default_id == skill_id)
                            .unwrap_or(false)
                            || default_prompt.id == *skill_id;

                        info!(
                            "[PostProcess] Default skill check: is_default={}, selected_prompt_id={:?}, skill_id={}, default_prompt_id={}",
                            is_default_skill, settings.post_process_selected_prompt_id, skill_id, default_prompt.id
                        );

                        if is_default_skill {
                            info!(
                                "[PostProcess] Matched skill is the default skill, skipping confirmation and using polish result"
                            );
                            // Use polish result directly without confirmation
                            if let Some(polished) = polish_result {
                                return (
                                    Some(polished),
                                    None,
                                    Some(routed_prompt.id.clone()),
                                    false,
                                );
                            }
                            // If polish failed, fall through to standard processing
                        }

                        // [DEBUG] Log selected text content before showing confirmation
                        match &selected_text {
                            Some(text) if !text.trim().is_empty() => {
                                let preview: String = text.chars().take(100).collect();
                                let suffix = if text.chars().count() > 100 {
                                    "..."
                                } else {
                                    ""
                                };
                                info!("[PostProcess] Before confirmation - selected text ({} chars): \"{}{}\"",
                                    text.len(), preview, suffix
                                );
                            }
                            Some(_) => {
                                info!("[PostProcess] Before confirmation - selected text is empty/whitespace");
                            }
                            None => {
                                info!(
                                    "[PostProcess] Before confirmation - no selected text (None)"
                                );
                            }
                        }

                        info!(
                            "[PostProcess] Skill matched: \"{}\" (id={}), polish_available={}, will emit skill-confirmation event",
                            routed_prompt.name, skill_id, polish_ok
                        );

                        // Save pending confirmation state with cached polish result (may be None if failed)
                        // Also capture current active window PID for focus restoration
                        use tauri::Manager;
                        let active_pid = crate::active_window::fetch_active_window()
                            .ok()
                            .map(|info| info.process_id);

                        if let Some(pending_state) =
                            app_handle.try_state::<crate::ManagedPendingSkillConfirmation>()
                        {
                            if let Ok(mut guard) = pending_state.lock() {
                                *guard = crate::PendingSkillConfirmation {
                                    skill_id: Some(skill_id.clone()),
                                    skill_name: Some(routed_prompt.name.clone()),
                                    transcription: Some(transcription.to_string()),
                                    selected_text: selected_text.clone(),
                                    override_prompt_id: override_prompt_id.clone(),
                                    app_name: app_name.clone(),
                                    window_title: window_title.clone(),
                                    history_id,
                                    process_id: active_pid,
                                    polish_result: polish_result.clone(), // May be None if parallel polish failed!
                                    is_ui_visible: false,
                                };
                            }
                        }

                        // Emit confirmation event to frontend
                        #[derive(serde::Serialize, Clone)]
                        struct SkillConfirmationPayload {
                            skill_id: String,
                            skill_name: String,
                            transcription: String,
                            polish_result: Option<String>,
                        }

                        app_handle
                            .emit(
                                "skill-confirmation",
                                SkillConfirmationPayload {
                                    skill_id: skill_id.clone(),
                                    skill_name: routed_prompt.name.clone(),
                                    transcription: transcription.to_string(),
                                    polish_result, // Frontend should handle None case (show loading or N/A)
                                },
                            )
                            .ok();

                        // Return early with special model marker to signal pending confirmation
                        // Caller should check for this and skip paste/hide operations
                        return (
                            None,
                            Some("__PENDING_SKILL_CONFIRMATION__".to_string()),
                            None,
                            false,
                        );
                    }
                }

                // No skill matched - use the polish result directly if available
                // IMPORTANT: Return the default_prompt.id so caller can get correct output_mode
                if let Some(polished) = polish_result {
                    info!(
                        "[PostProcess] No skill matched, using parallel polish result with default prompt: {} (id={})",
                        default_prompt.name, default_prompt.id
                    );
                    return (Some(polished), None, Some(default_prompt.id.clone()), false);
                }

                // Both failed or no match + polish failed - fall through to standard processing
                if !intent_ok && !polish_ok {
                    log::warn!("[PostProcess] Both parallel requests failed, falling back to standard processing");
                }
            }
        }

        // Fallback: continue with default polish
        info!("[PostProcess] Selected text mode - continuing with default polish");
    }

    let initial_prompt = match initial_prompt_opt {
        Some(p) => p,
        None => {
            log::warn!("[PostProcess] initial_prompt_opt is None! Cannot start post-processing chain. Aborting.");
            return (None, None, None, false);
        }
    };

    let mut current_prompt = initial_prompt;
    let mut current_input_content: String = initial_content;
    let mut current_transcription = transcription.to_string();
    let mut chain_depth = 0;
    const MAX_CHAIN_DEPTH: usize = 2;

    // Track if first iteration used default prompt (non-explicit match)
    // Chain calls should ONLY happen after default prompt processing
    let was_default_prompt = !is_explicit;

    let mut final_result = None;
    let mut last_model = None;
    let mut last_prompt_id = None;
    let mut last_err = false;

    while chain_depth < MAX_CHAIN_DEPTH {
        let prompt = current_prompt.clone();
        let transcription_content = &current_input_content;
        let transcription_original = &current_transcription;

        let (actual_provider, model) = match super::routing::resolve_effective_model(
            settings,
            fallback_provider,
            &prompt,
        ) {
            Some((p, m)) => {
                log::info!(
                    "[PostProcess] Resolved effective provider: {}, model: {}",
                    p.id,
                    m
                );
                (p, m)
            }
            None => {
                log::warn!("[PostProcess] resolve_effective_model returned None for fallback_provider={}, prompt={}. Aborting.", fallback_provider.id, prompt.id);
                return (final_result, last_model, Some(prompt.id.clone()), false);
            }
        };

        if show_overlay {
            show_llm_processing_overlay(app_handle);
        }

        // Keep prompt template as-is, only replace metadata variables
        let mut processed_prompt = prompt.instructions.replace("${prompt}", &prompt.name);

        // Check which variables are referenced in the prompt template
        let prompt_template = &prompt.instructions;
        let has_output_ref = prompt_template.contains("output");
        let has_select_ref = prompt_template.contains("select");
        let has_raw_input_ref = prompt_template.contains("raw_input");
        let has_streaming_ref = prompt_template.contains("streaming_output");
        let has_context_ref = prompt_template.contains("context");
        let has_app_name_ref = prompt_template.contains("app_name");
        let has_window_title_ref = prompt_template.contains("window_title");
        let has_time_ref = prompt_template.contains("time");

        // Build structured input data message - only include variables referenced in prompt
        let mut input_data_parts: Vec<String> = Vec::new();

        // Add output (transcription content) - only if referenced
        if has_output_ref && !transcription_content.is_empty() {
            input_data_parts.push(format!("```output\n{}\n```", transcription_content));
        }

        // Add raw_input (full original transcription) - only if referenced
        if has_raw_input_ref
            && !transcription_original.is_empty()
            && transcription_original != transcription_content
        {
            input_data_parts.push(format!("```raw_input\n{}\n```", transcription_original));
        }

        // Add streaming_output if available and referenced
        if has_streaming_ref {
            if let Some(streaming) = streaming_transcription {
                if !streaming.is_empty() {
                    input_data_parts.push(format!("```streaming_output\n{}\n```", streaming));
                }
            }
        }

        // Add selected text if referenced
        if has_select_ref {
            if let Some(text) = &selected_text {
                if !text.is_empty() {
                    input_data_parts.push(format!("```select\n{}\n```", text));
                }
            }
        }

        // Add app_name if referenced
        if has_app_name_ref {
            if let Some(name) = &app_name {
                if !name.is_empty() {
                    processed_prompt = processed_prompt.replace("${app_name}", name);
                }
            }
        }

        // Add window_title if referenced
        if has_window_title_ref {
            if let Some(title) = &window_title {
                if !title.is_empty() {
                    processed_prompt = processed_prompt.replace("${window_title}", title);
                }
            }
        }

        // Add current time if referenced
        if has_time_ref {
            let now = chrono::Local::now();
            let time_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
            processed_prompt = processed_prompt.replace("${time}", &time_str);
        }

        // Inject hot words and skills - only for non-explicit (fallback) matches
        if !is_explicit {
            // Case B: Fallback (unrecognized intent). Inject skills info to guide the LLM.
            let mut hot_words: Vec<String> = Vec::new();
            let mut skills_info = Vec::new();

            for p in &settings.post_process_prompts {
                // For hot_words variable: add names for fuzzy matching
                hot_words.push(p.name.clone());
                skills_info.push(format!("- **{}**", p.name));
            }

            hot_words.sort();
            hot_words.dedup();

            // 1. Inject into ${hot_words} if referenced
            if !hot_words.is_empty() {
                let hot_words_text = hot_words
                    .iter()
                    .map(|w| format!("- {}", w))
                    .collect::<Vec<_>>()
                    .join("\n");

                if processed_prompt.contains("${hot_words}") {
                    processed_prompt = processed_prompt.replace("${hot_words}", &hot_words_text);
                } else {
                    input_data_parts.push(format!("```hot_words\n{}\n```", hot_words_text));
                }
            }

            // 2. Inject vocabulary corrections as separate context block (lower priority than hot_words)
            if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                use crate::managers::vocabulary::VocabularyManager;

                // Determine active scopes (App Name + Matching Rules)
                let mut active_scopes = Vec::new();
                if let Some(app) = &app_name {
                    active_scopes.push(app.clone());

                    // Check against App Profiles for rule matches
                    if let Some(window) = &window_title {
                        if let Some(profile) = settings.app_profiles.iter().find(|p| p.name == *app)
                        {
                            for rule in &profile.rules {
                                let is_match = match rule.match_type {
                                    crate::settings::TitleMatchType::Text => {
                                        window.contains(&rule.pattern)
                                    }
                                    crate::settings::TitleMatchType::Regex => {
                                        if let Ok(re) = regex::Regex::new(&rule.pattern) {
                                            re.is_match(window)
                                        } else {
                                            false
                                        }
                                    }
                                };

                                if is_match {
                                    // Use convention: "AppName##RuleID"
                                    active_scopes.push(format!("{}##{}", app, rule.id));
                                    debug!("[PostProcess] Active Rule Match: {}##{}", app, rule.id);
                                }
                            }
                        }
                    }
                }

                // If app is not in App Profiles (not a "known app"), it counts as "Other"
                if let Some(app) = &app_name {
                    if !settings.app_profiles.iter().any(|p| p.name == *app) {
                        active_scopes.push("__OTHER__".to_string());
                    }
                }

                let vocab_manager = VocabularyManager::new(hm.db_path.clone());
                if let Ok(corrections) = vocab_manager.get_active_corrections(Some(&active_scopes))
                {
                    if !corrections.is_empty() {
                        let corrections_text = corrections
                            .iter()
                            .take(20)
                            .map(|c| {
                                format!("- \"{}\" → \"{}\"", c.original_text, c.corrected_text)
                            })
                            .collect::<Vec<_>>()
                            .join("\n");

                        input_data_parts.push(format!(
                            "以下是用户的高频词汇修正，请在适当时参考：\n{}",
                            corrections_text
                        ));

                        debug!(
                            "[PostProcess] Injected {} vocabulary corrections",
                            corrections.len().min(20)
                        );
                    }
                }
            }

            // 3. Inject structured hotwords from new system
            if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                let hotword_manager = HotwordManager::new(hm.db_path.clone());

                // Determine scenario from app context
                let scenario = detect_scenario(&app_name);

                // Use Work as default if no specific scenario detected
                let effective_scenario = scenario.unwrap_or(HotwordScenario::Work);

                if let Ok(injection) = hotword_manager.build_llm_injection(effective_scenario, 25) {
                    if !injection.is_empty() {
                        input_data_parts.push(injection);
                        debug!(
                            "[PostProcess] Injected structured hotwords for scenario {:?}",
                            effective_scenario
                        );
                    }
                }
            }

            // 4. Inject Semantic Skills block
            if !skills_info.is_empty() {
                let skills_block = format!(
                    "## 可用技能\n\n用户可能正在尝试执行以下某种操作（技能）。请分析用户输入（raw_input）的意图，并根据最匹配的技能进行处理：\n\n{}",
                    skills_info.join("\n")
                );
                input_data_parts.push(skills_block);
            }
        }

        let mut history_entries = Vec::new();
        if settings.post_process_context_enabled {
            if let Some(app) = &app_name {
                if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                    match hm.get_recent_history_texts_for_app(
                        app,
                        window_title.as_deref(),
                        match_pattern.as_deref(),
                        match_type,
                        settings.post_process_context_limit as usize,
                        history_id,
                    ) {
                        Ok(history) => {
                            history_entries = history;
                        }
                        Err(e) => {
                            error!("Failed to fetch history for context: {}", e);
                        }
                    }
                }
            }
        }

        // Handle context
        if !history_entries.is_empty() && has_context_ref {
            let context_content = history_entries
                .iter()
                .map(|s| format!("- {}", s))
                .collect::<Vec<_>>()
                .join("\n");

            if processed_prompt.contains("${context}") {
                let context_block = format!(
                    "\n\nRecent context for application \"{}\" (Window: \"{}\"):\n{}\n\n",
                    app_name.clone().unwrap_or_default(),
                    window_title.clone().unwrap_or_default(),
                    context_content
                );
                processed_prompt = processed_prompt.replace("${context}", &context_block);
            } else {
                input_data_parts.push(format!("```context\n{}\n```", context_content));
            }
            history_entries.clear();
        }

        // Build final input data message
        let input_data_message = if input_data_parts.is_empty() {
            None
        } else {
            Some(format!("## 输入数据\n\n{}", input_data_parts.join("\n\n")))
        };

        // Build fallback message
        let fallback_message = if !has_output_ref
            && !has_select_ref
            && !has_raw_input_ref
            && !transcription_content.is_empty()
        {
            Some(transcription_content.clone())
        } else {
            None
        };

        let cached_model_id = prompt
            .model_id
            .as_deref()
            .or(settings.selected_prompt_model_id.as_deref());
        let (result, err) = super::core::execute_llm_request(
            app_handle,
            settings,
            actual_provider,
            &model,
            cached_model_id,
            &processed_prompt,
            input_data_message.as_deref(),
            fallback_message.as_deref(),
            history_entries,
            app_name.clone(),
            window_title.clone(),
            match_pattern.clone(),
            match_type,
        )
        .await;

        final_result = result;
        last_model = Some(model);
        last_prompt_id = Some(prompt.id.clone());
        last_err = err;

        if err || final_result.is_none() {
            break;
        }

        // result_text is the result of LLM processing (fully parsed/extracted if JSON was used)
        let result_text = final_result.as_ref().unwrap();
        chain_depth += 1;

        if chain_depth < MAX_CHAIN_DEPTH {
            // Try to match the result against prompts again for the NEXT step in the chain
            let (next_prompt_opt, next_content, is_explicit_match) =
                super::routing::resolve_prompt_from_text(
                    result_text,
                    &all_prompts,
                    default_prompt,
                    None,
                );

            if let Some(next_prompt) = next_prompt_opt {
                // Only chain if:
                // 1. We matched a DIFFERENT prompt through an EXPLICIT override
                // 2. The first prompt was the DEFAULT prompt (non-explicit match)
                if is_explicit_match
                    && was_default_prompt
                    && chain_depth == 1
                    && next_prompt.id != current_prompt.id
                    && !next_prompt.id.is_empty()
                {
                    info!(
                        "[PostProcess] Chaining detected via explicit match: \"{}\" -> \"{}\". Using extracted text for next call.",
                        current_prompt.name, next_prompt.name
                    );

                    // Notify UI about the second step
                    app_handle
                        .emit("post-process-status", next_prompt.name.clone())
                        .ok();

                    // Persist intermediate result to history if we have an ID
                    if let Some(hid) = history_id {
                        if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                            let _ = hm
                                .update_transcription_post_processing(
                                    hid,
                                    result_text.clone(),
                                    current_prompt.instructions.clone(),
                                    current_prompt.name.clone(),
                                    Some(current_prompt.id.clone()),
                                    last_model.clone(),
                                )
                                .await;
                        }
                    }

                    // For the next iteration, the intermediate result text becomes
                    // the new transcription content.
                    current_prompt = next_prompt;
                    current_input_content = next_content;
                    // The full intermediate text becomes the new raw input for referencing.
                    current_transcription = result_text.clone();
                    continue;
                }
            }
        }

        break;
    }

    (final_result, last_model, last_prompt_id, last_err)
}
