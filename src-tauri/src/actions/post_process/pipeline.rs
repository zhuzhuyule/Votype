use crate::managers::history::HistoryManager;
use crate::managers::HotwordManager;
use crate::overlay::show_llm_processing_overlay;
use crate::settings::{AppSettings, HotwordScenario, LLMPrompt, PostProcessProvider};
use log::{error, info};
use std::borrow::Cow;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Detect usage scenario from app name
pub(super) fn detect_scenario(app_name: &Option<String>) -> Option<HotwordScenario> {
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

async fn execute_votype_rewrite_prompt(
    app_handle: &AppHandle,
    settings: &AppSettings,
    fallback_provider: &PostProcessProvider,
    prompt: &LLMPrompt,
    input_text: &str,
    target_text: &str,
    app_name: Option<String>,
    window_title: Option<String>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<String>,
    Option<i64>,
    Option<i64>, // llm_call_count
) {
    info!(
        "[VotypeRewrite] app={:?} title={:?} prompt_id={} target_len={} instruction_len={}",
        app_name,
        window_title,
        prompt.id,
        target_text.chars().count(),
        input_text.chars().count()
    );
    info!("[VotypeRewrite] TargetText:\n{}", target_text);
    info!("[VotypeRewrite] SpokenInstruction:\n{}", input_text);

    let Some((actual_provider, model)) =
        super::routing::resolve_effective_model(settings, fallback_provider, prompt)
    else {
        return (
            None,
            None,
            None,
            true,
            Some("未找到可用的后处理模型".to_string()),
            None,
            None,
        );
    };

    let system_prompts = vec![
        "You are a high-fidelity document editor.\n\n\
        Task: interpret the user's spoken_instruction and edit current_document accordingly.\n\n\
        Inputs:\n\
        - current_document: the frozen latest document at recording start -- edit this directly\n\
        - spoken_instruction: ASR-transcribed voice command -- may contain speech errors, homophones, abbreviation errors\n\
        - term_reference: filtered terminology for error correction\n\n\
        Rules:\n\
        1. First normalize spoken_instruction: fix ASR noise, produce a clear edit intent\n\
        2. Apply normalized intent to current_document\n\
        3. current_document is the authoritative text -- its terminology, casing, style override spoken_instruction\n\
        4. Match approximate terms in spoken_instruction to current_document entries using term_reference\n\
        5. term_reference is a correction aid, not a forced replacement table\n\
        6. Determine operation type: rewrite, expand, format, translate, or polish\n\
        7. Preserve document language unless explicit translation is requested\n\
        8. Make only intent-related changes; preserve unaffected content, structure, and tone\n\
        9. When ambiguous, choose the minimal edit that matches literal intent\n\
        10. Output only valid JSON, no explanation or markdown\n\n\
        Output JSON:\n\
        - normalized_instruction: corrected edit intent\n\
        - operation: rewrite|expand|format|translate|polish\n\
        - rewritten_text: the fully edited document\n\
        - changes: [{from, to, reason}]".to_string(),
    ];
    let term_reference = build_rewrite_term_reference(
        app_handle,
        settings,
        target_text,
        input_text,
        app_name.as_deref(),
    );
    let user_message = build_rewrite_user_message(target_text, input_text, &term_reference);
    let cached_model_id = prompt
        .model_id
        .as_deref()
        .or(settings.selected_prompt_model_id.as_deref());

    let (result, err, error_message, api_token_count) =
        super::core::execute_llm_request_with_messages(
            app_handle,
            settings,
            actual_provider,
            &model,
            cached_model_id,
            &system_prompts,
            Some(&user_message),
            app_name,
            window_title,
            None,
            None,
            None,
        )
        .await;

    let prompt_text = format!("{}\n{}", system_prompts.join("\n"), user_message);
    let token_count: i64 = api_token_count.unwrap_or_else(|| match tiktoken_rs::cl100k_base() {
        Ok(bpe) => {
            let prompt_tokens = bpe.encode_with_special_tokens(&prompt_text).len() as i64;
            let response_tokens = result
                .as_ref()
                .map(|r| bpe.encode_with_special_tokens(r).len() as i64)
                .unwrap_or(0);
            prompt_tokens + response_tokens
        }
        Err(_) => 0,
    });

    if let Some(raw) = result.as_deref() {
        if let Some(parsed) = super::core::extract_rewrite_response(raw) {
            info!(
                "[VotypeRewrite] ParsedResponse operation={} normalized_instruction={}",
                parsed.operation, parsed.normalized_instruction
            );
            for change in &parsed.changes {
                info!(
                    "[VotypeRewrite] Change from='{}' to='{}' reason='{}'",
                    change.from, change.to, change.reason
                );
            }
            return (
                Some(parsed.rewritten_text),
                Some(model),
                Some(prompt.id.clone()),
                false,
                None,
                Some(token_count),
                Some(1),
            );
        }
    }

    (
        result,
        Some(model),
        Some(prompt.id.clone()),
        err,
        error_message,
        Some(token_count),
        Some(1),
    )
}

fn build_rewrite_user_message(target_text: &str, input_text: &str, term_reference: &str) -> String {
    format!(
        "[current_document]\n{}\n\n[spoken_instruction]\n{}\n\n[term_reference]\n{}",
        target_text.trim(),
        input_text.trim(),
        term_reference
    )
}

fn build_rewrite_term_reference(
    app_handle: &AppHandle,
    settings: &AppSettings,
    target_text: &str,
    input_text: &str,
    app_name: Option<&str>,
) -> String {
    if !settings.post_process_hotword_injection_enabled {
        return "(none)".to_string();
    }

    if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
        let hotword_manager = HotwordManager::new(hm.db_path.clone());
        let scenario = detect_scenario(&app_name.map(|s| s.to_string()));
        let effective_scenario = scenario.unwrap_or(HotwordScenario::Work);
        match hotword_manager.build_ranked_term_reference(
            effective_scenario,
            target_text,
            input_text,
            app_name,
        ) {
            Ok(reference) if !reference.trim().is_empty() => return reference,
            Ok(_) => {}
            Err(e) => {
                error!(
                    "[VotypeRewrite] Failed to build term_reference hotwords: {}",
                    e
                );
            }
        }
    }

    "(none)".to_string()
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
    review_editor_active: bool,
    selected_text: Option<String>,
    review_document_text: Option<String>,
) -> (
    Option<String>, // processed text
    Option<String>, // model name
    Option<String>, // prompt id
    bool,           // error
    Option<String>, // error message
    Option<i64>,    // token count (total across all LLM calls)
    Option<i64>,    // llm call count
) {
    if !settings.post_process_enabled {
        return (None, None, None, false, None, None, None);
    }

    // Check for skip post-process marker
    if override_prompt_id.as_deref() == Some("__SKIP_POST_PROCESS__") {
        info!("[PostProcess] Skipping post-processing due to app rule override");
        return (None, None, None, false, None, None, None);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Level 1: Smart Routing (activated by 智能模型 mode / length_routing_enabled)
    // Handles history reuse and action routing BEFORE model selection.
    // ═══════════════════════════════════════════════════════════════════════
    let mut smart_routing_tokens: Option<i64> = None;

    if settings.length_routing_enabled {
        let char_count = transcription.chars().count() as u32;

        // Layer 0: History exact-match reuse
        if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
            match hm.find_cached_post_process_result(transcription) {
                Ok(Some((cached_text, cached_model, cached_prompt_id))) => {
                    info!(
                        "[SmartRouting] HistoryHit: reusing cached result (len={}, model={:?})",
                        cached_text.chars().count(),
                        cached_model
                    );
                    return (
                        Some(cached_text),
                        cached_model,
                        cached_prompt_id,
                        false,
                        None,
                        Some(0),
                        Some(0),
                    );
                }
                Ok(None) => {
                    info!(
                        "[SmartRouting] HistoryMiss: no cached result for input (len={})",
                        char_count
                    );
                }
                Err(e) => {
                    error!("[SmartRouting] History lookup failed: {}", e);
                }
            }
        }

        // Layer 1: Action routing for short text (only when intent model is configured)
        if char_count <= settings.length_routing_threshold
            && settings.post_process_intent_model_id.is_some()
        {
            let fallback_provider = match settings.active_post_process_provider() {
                Some(p) => p,
                None => return (None, None, None, false, None, None, None),
            };

            let action_result = super::routing::execute_smart_action_routing(
                app_handle,
                settings,
                fallback_provider,
                transcription,
            )
            .await;

            match &action_result {
                Some((super::routing::SmartAction::PassThrough, token_count)) => {
                    info!("[SmartRouting] Action: pass_through ({} chars)", char_count);
                    return (
                        Some(transcription.to_string()),
                        Some("__smart_pass_through__".to_string()),
                        None,
                        false,
                        None,
                        *token_count,
                        Some(1),
                    );
                }
                Some((super::routing::SmartAction::LitePolish { result }, token_count)) => {
                    info!("[SmartRouting] Action: lite_polish ({} chars)", char_count);
                    return (
                        Some(result.clone()),
                        Some("__smart_lite_polish__".to_string()),
                        None,
                        false,
                        None,
                        *token_count,
                        Some(1),
                    );
                }
                Some((super::routing::SmartAction::FullPolish, _)) => {
                    info!(
                        "[SmartRouting] Action: full_polish ({} chars), delegating to model selection",
                        char_count
                    );
                    smart_routing_tokens = action_result.as_ref().and_then(|(_, tc)| *tc);
                }
                None => {
                    info!(
                        "[SmartRouting] Action routing unavailable ({} chars), delegating to model selection",
                        char_count
                    );
                }
            }
        } else if char_count > settings.length_routing_threshold {
            info!(
                "[SmartRouting] Long text ({} chars > {}), skipping action routing",
                char_count, settings.length_routing_threshold
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Level 2: Model Selection (existing logic, unchanged)
    // Single model / Length routing / Multi-model
    // ═══════════════════════════════════════════════════════════════════════

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

    // Track token usage from auxiliary LLM calls
    let mut routing_token_count: i64 = smart_routing_tokens.unwrap_or(0);
    let mut routing_call_count: i64 = if smart_routing_tokens.is_some() { 1 } else { 0 };

    let fallback_provider = match settings.active_post_process_provider() {
        Some(p) => p,
        None => return (None, None, None, false, None, None, None),
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
    let votype_mode = crate::window_context::resolve_votype_input_mode(
        app_name.as_deref(),
        window_title.as_deref(),
        review_editor_active,
        selected_text
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
    );
    let effective_skill_mode = match votype_mode {
        crate::window_context::VotypeInputMode::MainPolishInput
        | crate::window_context::VotypeInputMode::MainSelectedEdit
        | crate::window_context::VotypeInputMode::ReviewRewrite => false,
        crate::window_context::VotypeInputMode::ExternalDefault => skill_mode,
    };
    let effective_selected_text = match votype_mode {
        crate::window_context::VotypeInputMode::MainPolishInput
        | crate::window_context::VotypeInputMode::ReviewRewrite => None,
        crate::window_context::VotypeInputMode::MainSelectedEdit
        | crate::window_context::VotypeInputMode::ExternalDefault => selected_text.clone(),
    };

    info!(
        "[ModeRouting] app={:?}, title={:?}, review_editor_active={}, original_skill_mode={}, resolved_mode={:?}",
        app_name,
        window_title,
        review_editor_active,
        skill_mode,
        votype_mode
    );
    if let Some(text) = selected_text.as_deref() {
        info!(
            "[ModeRouting] RawSelectedText (len={}):\n{}",
            text.chars().count(),
            text
        );
    }
    if let Some(text) = review_document_text.as_deref() {
        info!(
            "[ModeRouting] ReviewDocumentText (len={}):\n{}",
            text.chars().count(),
            text
        );
    }

    if matches!(
        votype_mode,
        crate::window_context::VotypeInputMode::MainSelectedEdit
    ) {
        if let (Some(rewrite_prompt), Some(target_text)) = (
            initial_prompt_opt.as_ref().or(default_prompt),
            selected_text.as_deref(),
        ) {
            return execute_votype_rewrite_prompt(
                app_handle,
                settings,
                fallback_provider,
                rewrite_prompt,
                transcription,
                target_text,
                app_name,
                window_title,
            )
            .await;
        }
    }

    if matches!(
        votype_mode,
        crate::window_context::VotypeInputMode::ReviewRewrite
    ) {
        if let (Some(rewrite_prompt), Some(target_text)) = (
            initial_prompt_opt.as_ref().or(default_prompt),
            review_document_text.as_deref(),
        ) {
            return execute_votype_rewrite_prompt(
                app_handle,
                settings,
                fallback_provider,
                rewrite_prompt,
                transcription,
                target_text,
                app_name,
                window_title,
            )
            .await;
        }
    }

    let has_selected_text = effective_selected_text
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    // Mode B: Skill shortcut pressed - do LLM routing and execute
    if effective_skill_mode
        && !is_explicit
        && override_prompt_id.is_none()
        && !transcription.trim().is_empty()
    {
        if let Some(p) = &initial_prompt_opt {
            if let Some((route_provider, route_model, route_api_key)) =
                super::routing::resolve_intent_routing_model(settings, fallback_provider, p)
            {
                if let Some(routing_result) = super::routing::perform_skill_routing(
                    app_handle,
                    route_api_key,
                    &all_prompts,
                    route_provider,
                    &route_model,
                    transcription,
                    effective_selected_text.as_deref(),
                )
                .await
                {
                    // Accumulate routing token cost
                    if let Some(tc) = routing_result.token_count {
                        routing_token_count += tc;
                        routing_call_count += 1;
                    }
                    let route_response = routing_result.response;
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
                            Some("select") => effective_selected_text.clone().unwrap_or_default(),
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
        effective_skill_mode, is_explicit, override_prompt_id, transcription.trim().is_empty(), has_selected_text
    );

    if !effective_skill_mode
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
                        effective_selected_text.as_deref(),
                    ),
                    // Default polish
                    super::routing::execute_default_polish(
                        app_handle,
                        settings,
                        fallback_provider,
                        default_prompt,
                        transcription,
                        app_name.clone(),
                        window_title.clone(),
                        history_id,
                    )
                );

                // Accumulate token costs from both parallel requests
                if let Some(ref ir) = intent_result {
                    if let Some(tc) = ir.token_count {
                        routing_token_count += tc;
                    }
                    routing_call_count += 1;
                }
                if let Some(ref pr) = polish_result {
                    if let Some(tc) = pr.token_count {
                        routing_token_count += tc;
                    }
                    routing_call_count += 1;
                }

                // Extract inner values for downstream use
                let intent_response = intent_result.map(|r| r.response);
                let polish_text = polish_result.map(|r| r.text);

                // Log results for debugging concurrency issues
                let intent_ok = intent_response.is_some();
                let polish_ok = polish_text.is_some();
                info!(
                    "[PostProcess] Parallel requests completed - Intent: {} (skill: {:?}), Polish: {} (len: {})",
                    if intent_ok { "OK" } else { "FAILED" },
                    intent_response.as_ref().map(|r| &r.skill_id),
                    if polish_ok { "OK" } else { "FAILED" },
                    polish_text.as_ref().map(|s| s.len()).unwrap_or(0)
                );

                // Handle different result combinations:
                // 1. Intent matched + Polish OK/Failed -> Show confirmation (polish_text may be None)
                // 2. Intent failed + Polish OK -> Use polish result directly
                // 3. Both failed -> Fall through to standard processing

                if let Some(route_response) = intent_response {
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
                            if let Some(ref polished) = polish_text {
                                let total_tokens = if routing_token_count > 0 {
                                    Some(routing_token_count)
                                } else {
                                    None
                                };
                                let total_calls = if routing_call_count > 0 {
                                    Some(routing_call_count)
                                } else {
                                    None
                                };
                                return (
                                    Some(polished.clone()),
                                    None,
                                    Some(routed_prompt.id.clone()),
                                    false,
                                    None,
                                    total_tokens,
                                    total_calls,
                                );
                            }
                            // If polish failed, fall through to standard processing
                        }

                        // [DEBUG] Log selected text content before showing confirmation
                        match &effective_selected_text {
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
                                    selected_text: effective_selected_text.clone(),
                                    override_prompt_id: override_prompt_id.clone(),
                                    app_name: app_name.clone(),
                                    window_title: window_title.clone(),
                                    history_id,
                                    process_id: active_pid,
                                    polish_result: polish_text.clone(), // May be None if parallel polish failed!
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
                                    polish_result: polish_text, // Frontend should handle None case (show loading or N/A)
                                },
                            )
                            .ok();

                        // Return early with special model marker to signal pending confirmation
                        // Caller should check for this and skip paste/hide operations
                        // Include routing token costs even though confirmation is pending
                        let total_tokens = if routing_token_count > 0 {
                            Some(routing_token_count)
                        } else {
                            None
                        };
                        let total_calls = if routing_call_count > 0 {
                            Some(routing_call_count)
                        } else {
                            None
                        };
                        return (
                            None,
                            Some("__PENDING_SKILL_CONFIRMATION__".to_string()),
                            None,
                            false,
                            None,
                            total_tokens,
                            total_calls,
                        );
                    }
                }

                // No skill matched - use the polish result directly if available
                // IMPORTANT: Return the default_prompt.id so caller can get correct output_mode
                if let Some(polished) = polish_text {
                    info!(
                        "[PostProcess] No skill matched, using parallel polish result with default prompt: {} (id={})",
                        default_prompt.name, default_prompt.id
                    );
                    let total_tokens = if routing_token_count > 0 {
                        Some(routing_token_count)
                    } else {
                        None
                    };
                    let total_calls = if routing_call_count > 0 {
                        Some(routing_call_count)
                    } else {
                        None
                    };
                    return (
                        Some(polished),
                        None,
                        Some(default_prompt.id.clone()),
                        false,
                        None,
                        total_tokens,
                        total_calls,
                    );
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
            log::info!(
                "[PostProcess] No user-owned prompt is configured. Skipping post-processing and returning original transcription."
            );
            return (
                Some(transcription.to_string()),
                None,
                None,
                false,
                None,
                None,
                None,
            );
        }
    };

    let current_prompt = initial_prompt;
    let current_input_content: String = initial_content;
    let current_transcription = transcription.to_string();

    let final_result;
    let last_model;
    let last_prompt_id;
    let last_err;
    let last_error_message;
    let last_token_count;

    loop {
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
                return (None, None, Some(prompt.id.clone()), false, None, None, None);
            }
        };

        if show_overlay {
            show_llm_processing_overlay(app_handle);
        }

        // Keep prompt template as-is, only replace metadata variables
        // (PromptBuilder handles variable detection, stripping, and data injection)

        // Build hotword injection
        let hotword_injection = if settings.post_process_hotword_injection_enabled {
            if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
                let hotword_manager = HotwordManager::new(hm.db_path.clone());
                let scenario = detect_scenario(&app_name);
                let effective_scenario = scenario.unwrap_or(HotwordScenario::Work);
                match hotword_manager.build_injection(effective_scenario) {
                    Ok(injection)
                        if !(injection.person_names.is_empty()
                            && injection.product_names.is_empty()
                            && injection.domain_terms.is_empty()
                            && injection.hotwords.is_empty()) =>
                    {
                        let total_terms = injection.person_names.len()
                            + injection.product_names.len()
                            + injection.domain_terms.len()
                            + injection.hotwords.len();
                        info!(
                            "[PostProcess] Hotwords injected into prompt: scenario={:?}, terms={}",
                            effective_scenario, total_terms
                        );
                        info!(
                            "[PostProcess] Hotword summary:\n{}",
                            HotwordManager::summarize_injection(&injection)
                        );
                        Some(injection)
                    }
                    Ok(_) => {
                        info!(
                            "[PostProcess] Hotword injection skipped: scenario={:?}, no active matches or entries",
                            effective_scenario
                        );
                        None
                    }
                    Err(e) => {
                        error!("[PostProcess] Failed to build hotword injection: {}", e);
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        // Fetch history context
        let history_entries = if settings.post_process_context_enabled {
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
                        Ok(history) => history,
                        Err(e) => {
                            error!("Failed to fetch history for context: {}", e);
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

        // Resolve convention-based references from Skill's references/ directory
        let app_category = app_name
            .as_deref()
            .map(crate::app_category::from_app_name)
            .unwrap_or("Other");
        let resolved_refs = super::reference_resolver::resolve_references(
            prompt.file_path.as_deref(),
            app_name.as_deref(),
            app_category,
        );
        let refs_content = if resolved_refs.count > 0 {
            log::info!(
                "[Reference] Injecting {} reference(s) for skill '{}': {:?}",
                resolved_refs.count,
                prompt.name,
                resolved_refs.matched_files,
            );
            Some(resolved_refs.content)
        } else {
            None
        };

        // Use PromptBuilder for unified variable processing
        let mut builder = super::prompt_builder::PromptBuilder::new(&prompt, transcription_content)
            .streaming_transcription(streaming_transcription)
            .selected_text(selected_text.as_deref())
            .app_name(app_name.as_deref())
            .window_title(window_title.as_deref())
            .history_entries(history_entries)
            .hotword_injection(hotword_injection)
            .resolved_references(refs_content)
            .app_language(&settings.app_language)
            .injection_policy(super::prompt_builder::InjectionPolicy::for_post_process(
                settings,
            ));
        builder = builder.raw_transcription(transcription_original);
        let built = builder.build();

        let cached_model_id = prompt
            .model_id
            .as_deref()
            .or(settings.selected_prompt_model_id.as_deref());

        // Resolve preset parameters
        let presets_config = app_handle
            .try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>();
        let merged_extra_params = if let Some(config) = presets_config {
            let cached_model_for_preset = cached_model_id
                .and_then(|id| settings.cached_models.iter().find(|m| m.id == id))
                .or_else(|| {
                    settings
                        .cached_models
                        .iter()
                        .find(|m| m.model_id == model && m.provider_id == actual_provider.id)
                });

            let preset_params = crate::managers::model_preset::resolve_preset_params(
                prompt.param_preset.as_deref(),
                cached_model_for_preset.and_then(|m| m.model_family.as_deref()),
                &model,
                &config,
            );

            if preset_params.is_empty() {
                None
            } else {
                let merged = crate::managers::model_preset::merge_params(
                    preset_params,
                    cached_model_for_preset.and_then(|m| m.extra_params.as_ref()),
                );
                Some(merged)
            }
        } else {
            None
        };

        // Single-model request: apply a 10s timeout.
        // If the LLM takes too long, skip post-processing and return the original text.
        let llm_future = super::core::execute_llm_request_with_messages(
            app_handle,
            settings,
            actual_provider,
            &model,
            cached_model_id,
            &built.system_messages,
            built.user_message.as_deref(),
            app_name.clone(),
            window_title.clone(),
            match_pattern.clone(),
            match_type,
            merged_extra_params.as_ref(),
        );

        let (result, err, error_message, api_token_count) = match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            llm_future,
        )
        .await
        {
            Ok(llm_result) => llm_result,
            Err(_) => {
                log::warn!(
                    "[PostProcess] Single-model LLM request timed out (>10s), returning original transcription"
                );
                (
                    Some(current_input_content.clone()),
                    false,
                    Some("LLM request timed out".to_string()),
                    None,
                )
            }
        };

        let prompt_text = format!(
            "{}\n{}",
            built.system_messages.join("\n"),
            built.user_message.as_deref().unwrap_or_default()
        );
        let computed_token_count: i64 =
            api_token_count.unwrap_or_else(|| match tiktoken_rs::cl100k_base() {
                Ok(bpe) => {
                    let prompt_tokens = bpe.encode_with_special_tokens(&prompt_text).len() as i64;
                    let response_tokens = result
                        .as_ref()
                        .map(|r| bpe.encode_with_special_tokens(r).len() as i64)
                        .unwrap_or(0);
                    prompt_tokens + response_tokens
                }
                Err(_) => 0,
            });

        final_result = result;
        last_model = Some(model);
        last_prompt_id = Some(prompt.id.clone());
        last_err = err;
        last_error_message = error_message;
        last_token_count = Some(computed_token_count + routing_token_count);

        if let Some(final_text) = final_result.as_deref() {
            info!(
                "[PostProcess] FinalResult prompt_id={} model={}",
                prompt.id,
                last_model.as_deref().unwrap_or_default()
            );
            super::core::preview_multiline("PostProcessFinalText", final_text);
        } else {
            info!(
                "[PostProcess] FinalResult prompt_id={} model={} is empty",
                prompt.id,
                last_model.as_deref().unwrap_or_default()
            );
        }

        break;
    }

    // 1 for the main LLM call + any routing/polish calls
    let total_call_count = Some(1 + routing_call_count);

    (
        final_result,
        last_model,
        last_prompt_id,
        last_err,
        last_error_message,
        last_token_count,
        total_call_count,
    )
}

#[cfg(test)]
mod tests {
    use super::build_rewrite_user_message;

    #[test]
    fn test_build_rewrite_user_message_excludes_app_context() {
        let message = build_rewrite_user_message(
            "当前文稿",
            "口述指令",
            "[热词 reference]\n术语缩写类热词：ASR、JSON",
        );

        assert!(message.contains("[current_document]"));
        assert!(message.contains("[spoken_instruction]"));
        assert!(message.contains("[term_reference]"));
        assert!(!message.contains("[app_context]"));
        assert!(!message.contains("window="));
        assert!(!message.contains("app="));
    }
}
