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
        );
    };

    let system_prompts = vec![
        "你是一个高保真的文稿编辑助手。\n\n你的唯一任务是：根据 spoken_instruction 理解用户真实意图，并修改 current_document。\n\n输入说明：\n- current_document：本次录音开始时冻结的最新完整文稿。它不是历史初稿，而是这一次必须直接编辑的当前结果。\n- spoken_instruction：用户本次口述的编辑指令，由 ASR 转写而来，可能包含口语化表达、识别错误、术语误识别、大小写错误、缩写错误、同音词错误。\n- term_reference：给你的少量术语参考，已经按类别筛选，只保留与当前文稿或本次指令更相关的热词、自定义词和常见误识别。\n- app_context：弱上下文，只用于帮助理解当前是在执行窗口中持续改写文稿。\n\n工作要求：\n1. 先在心里纠正 spoken_instruction 中的 ASR 噪声，并归一化成明确、简洁、忠实于用户原意的编辑意图。\n2. 再依据归一化后的意图，对 current_document 执行对应编辑。\n3. 你处理的是“对当前文稿继续修改”，不是生成全新文章；如果执行窗口连续多次录音，每次都必须只基于这次输入提供的 current_document 继续修改。\n4. current_document 是唯一主文本。理解术语、实体、缩写、大小写、语言风格和上下文时，优先级永远高于 spoken_instruction 的字面形式。\n5. 如果 spoken_instruction 中提到的词在 current_document 中没有完全一致的匹配，你必须结合 current_document 和 term_reference 找到最可能对应的近似术语、误识别形式或同音词，再执行修改。\n6. term_reference 只是纠错参考，不是强制替换表；只有当它能帮助你更准确理解用户意图时才使用，不要被无关热词干扰。\n7. 用户意图可能是 rewrite、expand、format、translate 或 polish。你必须先判断最合适的操作，再执行编辑。\n8. 除非用户明确要求切换语言或翻译，否则 rewritten_text 必须保持与 current_document 主语言一致。\n9. 只做与用户意图直接相关的修改，尽量保留未被要求修改的内容、结构、语气和有效信息；不要无关扩写，不要擅自增加新观点。\n10. 如果指令含糊不清，优先选择改动最小但最符合字面意图的编辑方式。\n11. 不要输出解释，不要输出 markdown，不要输出额外文本。\n\n输出要求：\n你必须只返回合法 JSON，对象结构如下：\n- normalized_instruction: 纠错并归一化后的用户编辑意图\n- operation: 你判断的操作类型，只能是 rewrite、expand、format、translate、polish 之一\n- rewritten_text: 编辑后的完整文稿\n- changes: 数组，列出主要修改项；每项包含 from、to、reason\n\n除了这个 JSON 对象，不要输出任何其他内容。".to_string(),
    ];
    let term_reference = build_rewrite_term_reference(
        app_handle,
        settings,
        target_text,
        input_text,
        app_name.as_deref(),
    );
    let user_message = format!(
        "[current_document]\n{}\n\n[spoken_instruction]\n{}\n\n[term_reference]\n{}\n\n[app_context]\napp={:?}\nwindow={:?}",
        target_text.trim(),
        input_text.trim(),
        term_reference,
        app_name,
        window_title
    );
    let cached_model_id = prompt
        .model_id
        .as_deref()
        .or(settings.selected_prompt_model_id.as_deref());

    let (result, err, error_message) = super::core::execute_llm_request_with_messages(
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
            );
        }
    }

    (
        result,
        Some(model),
        Some(prompt.id.clone()),
        err,
        error_message,
    )
}

fn build_rewrite_term_reference(
    app_handle: &AppHandle,
    settings: &AppSettings,
    target_text: &str,
    input_text: &str,
    app_name: Option<&str>,
) -> String {
    let document_terms = extract_ascii_terms(target_text, 8);
    let spoken_terms = extract_ascii_terms(input_text, 8);

    let mut domain_terms: Vec<String> = Vec::new();

    let push_unique = |bucket: &mut Vec<String>, item: String| {
        let item = item.trim().to_string();
        if !item.is_empty() && !bucket.iter().any(|existing| existing == &item) {
            bucket.push(item);
        }
    };

    for token in &settings.custom_words {
        let token_lower = token.trim().to_lowercase();
        if !token_lower.is_empty()
            && (target_text.to_lowercase().contains(&token_lower)
                || input_text.to_lowercase().contains(&token_lower))
        {
            push_unique(&mut domain_terms, token.clone());
        }
    }

    let mut sections: Vec<String> = Vec::new();
    if !document_terms.is_empty() {
        sections.push(format!("[当前文稿术语]\n- {}", document_terms.join("\n- ")));
    }
    if !spoken_terms.is_empty() {
        sections.push(format!("[本次口述术语]\n- {}", spoken_terms.join("\n- ")));
    }
    if !domain_terms.is_empty() {
        sections.push(format!("[自定义词]\n- {}", domain_terms.join("\n- ")));
    }

    if sections.is_empty() {
        "(none)".to_string()
    } else {
        sections.join("\n\n")
    }
}

fn extract_ascii_terms(text: &str, limit: usize) -> Vec<String> {
    let mut terms = Vec::new();
    for token in text
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'))
        .filter(|token| token.len() >= 2 && token.chars().any(|ch| ch.is_ascii_alphabetic()))
    {
        let token = token.trim().to_string();
        if !token.is_empty() && !terms.iter().any(|existing| existing == &token) {
            terms.push(token);
        }
        if terms.len() >= limit {
            break;
        }
    }
    terms
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
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<String>,
) {
    if !settings.post_process_enabled {
        return (None, None, None, false, None);
    }

    // Check for skip post-process marker
    if override_prompt_id.as_deref() == Some("__SKIP_POST_PROCESS__") {
        info!("[PostProcess] Skipping post-processing due to app rule override");
        return (None, None, None, false, None);
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
        None => return (None, None, None, false, None),
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
                if let Some(route_response) = super::routing::perform_skill_routing(
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
                                    None,
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
                            None,
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
                    return (
                        Some(polished),
                        None,
                        Some(default_prompt.id.clone()),
                        false,
                        None,
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
            return (Some(transcription.to_string()), None, None, false, None);
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
                return (None, None, Some(prompt.id.clone()), false, None);
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

        let (result, err, error_message) = match tokio::time::timeout(
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
                )
            }
        };

        final_result = result;
        last_model = Some(model);
        last_prompt_id = Some(prompt.id.clone());
        last_err = err;
        last_error_message = error_message;

        break;
    }

    (
        final_result,
        last_model,
        last_prompt_id,
        last_err,
        last_error_message,
    )
}
