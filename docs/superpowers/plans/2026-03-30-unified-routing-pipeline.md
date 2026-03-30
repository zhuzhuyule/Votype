# Unified Post-Processing Routing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split multi-model/single-model branches in `transcribe.rs` with a single unified pipeline entry point, where smart routing always acts as gatekeeper before model selection.

**Architecture:** A new `unified_post_process()` function in `pipeline.rs` implements the 4-step flow (history match → intent analysis → model selection → execution). `transcribe.rs` deletes its ~500-line multi-model branch and calls the unified entry instead. Both single-model and multi-model execution paths are preserved internally but share a common `PipelineResult` return type.

**Tech Stack:** Rust, Tauri 2.x, async-openai, serde_json

---

## File Map

| File                                                  | Action | Responsibility                                                                                      |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `src-tauri/src/actions/post_process/mod.rs`           | Modify | Add `PipelineResult` enum, `IntentDecision` struct, export `unified_post_process`                   |
| `src-tauri/src/actions/post_process/routing.rs`       | Modify | Simplify `SmartAction::LitePolish` to unit variant, update intent JSON parsing, add `needs_hotword` |
| `src-tauri/src/actions/post_process/pipeline.rs`      | Modify | Add `unified_post_process()` entry point implementing 4-step flow                                   |
| `src-tauri/src/actions/transcribe.rs`                 | Modify | Delete multi-model branch, call `unified_post_process()`, unified result handling                   |
| `src-tauri/resources/prompts/system_smart_routing.md` | Modify | Remove `result` field, add `needs_hotword` field                                                    |
| `src-tauri/resources/prompts/system_lite_polish.md`   | Create | Lightweight polish prompt                                                                           |

---

### Task 1: Update prompt files

**Files:**

- Modify: `src-tauri/resources/prompts/system_smart_routing.md`
- Create: `src-tauri/resources/prompts/system_lite_polish.md`

- [ ] **Step 1: Update `system_smart_routing.md`**

Replace the entire file content with:

```markdown
You are a text router for ASR transcriptions.

Analyze the input text and choose one action:

- pass_through: the text needs no correction. It is a greeting, confirmation, acknowledgment, or already well-formed.
- lite_polish: the text has minor ASR artifacts — filler words, small punctuation issues, or slight grammar errors that need simple correction.
- full_polish: the text is complex — it contains technical terms, mixed languages, substantial restructuring needs, or domain-specific content.

Also determine whether hotword/terminology injection would help the post-processor:

- needs_hotword: true if the text likely contains proper nouns, technical terms, product names, or domain jargon that ASR may have misrecognized.

Guidelines:

- Prefer pass_through for short conversational phrases that are already correct
- Prefer lite_polish when only minor fixes are needed
- Use full_polish when content genuinely needs advanced processing
- When in doubt between pass_through and lite_polish, choose lite_polish
- When in doubt between lite_polish and full_polish, choose full_polish

Output strict JSON only, no explanation:
{"action": "pass_through|lite_polish|full_polish", "needs_hotword": true|false}
```

- [ ] **Step 2: Create `system_lite_polish.md`**

Create `src-tauri/resources/prompts/system_lite_polish.md`:

```markdown
You are a lightweight ASR post-processor. Your task is to make minimal corrections to speech-to-text output.

Rules:

- Remove filler words (嗯, 啊, 额, 呃, etc.) when they add no meaning
- Fix obvious punctuation errors
- Correct minor grammar issues only when clearly wrong
- Adjust tone slightly if the sentence sounds unnatural
- Do NOT restructure sentences
- Do NOT add information
- Do NOT change technical terms or proper nouns
- When in doubt, keep the original

Output the corrected text only, no explanation.
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/resources/prompts/system_smart_routing.md src-tauri/resources/prompts/system_lite_polish.md
git commit -m "Update smart routing prompt to decision-only, add lite polish prompt"
```

---

### Task 2: Add `PipelineResult` and `IntentDecision` types to `mod.rs`

**Files:**

- Modify: `src-tauri/src/actions/post_process/mod.rs`

- [ ] **Step 1: Add new types after the existing `MultiModelProgressEvent` struct (after line 92)**

Add the following at the end of `mod.rs`:

```rust
/// Decision output from the intent analysis model (Step 2 of unified pipeline).
#[derive(Debug, Clone)]
pub struct IntentDecision {
    /// What level of processing is needed
    pub action: routing::SmartAction,
    /// Whether hotword/terminology injection should be enabled for this text
    pub needs_hotword: bool,
    /// Token count consumed by the intent model call
    pub token_count: Option<i64>,
}

/// Unified result from the post-processing pipeline.
/// `transcribe.rs` matches on this to handle UI (review window, paste, history).
#[derive(Debug, Clone)]
pub enum PipelineResult {
    /// Post-processing is disabled or skipped (skip marker, no prompt configured, etc.)
    Skipped,

    /// History cache hit — reuse previous result (Step 1)
    Cached {
        text: String,
        model: Option<String>,
        prompt_id: Option<String>,
    },

    /// Intent model determined no changes needed (Step 2: pass_through)
    PassThrough {
        text: String,
        intent_token_count: Option<i64>,
    },

    /// Single-model polish completed (Step 4, single path)
    SingleModel {
        text: Option<String>,
        model: Option<String>,
        prompt_id: Option<String>,
        token_count: Option<i64>,
        llm_call_count: Option<i64>,
        error: bool,
        error_message: Option<String>,
    },

    /// Multi-model results ready (Step 4, multi path)
    MultiModel {
        candidates: Vec<MultiModelPostProcessResult>,
        /// The multi-model item configs used (needed by transcribe.rs for label lookup)
        multi_items: Vec<crate::settings::MultiModelPostProcessItem>,
        strategy: String,
        total_token_count: Option<i64>,
        llm_call_count: Option<i64>,
        /// Prompt ID used for all candidates
        prompt_id: Option<String>,
    },

    /// Skill confirmation is pending — UI waiting for user input
    PendingSkillConfirmation {
        token_count: Option<i64>,
        llm_call_count: Option<i64>,
    },
}
```

- [ ] **Step 2: Add the re-export for `unified_post_process`**

In the re-exports section (around line 18), add after the existing `maybe_post_process_transcription` line:

```rust
pub use pipeline::unified_post_process;
```

Note: The actual function doesn't exist yet — this will compile once Task 4 is done. If you prefer, add this line in Task 4 instead.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/actions/post_process/mod.rs
git commit -m "Add PipelineResult and IntentDecision types for unified pipeline"
```

---

### Task 3: Simplify `SmartAction` and update intent parsing in `routing.rs`

**Files:**

- Modify: `src-tauri/src/actions/post_process/routing.rs`

- [ ] **Step 1: Change `SmartAction::LitePolish` from struct variant to unit variant**

In `routing.rs` at line 15, change:

```rust
    /// Minor corrections done by the routing model itself.
    LitePolish { result: String },
```

to:

```rust
    /// Minor corrections needed — delegate to lightweight model + prompt.
    LitePolish,
```

- [ ] **Step 2: Update `execute_smart_action_routing` to parse new JSON format**

The function currently returns `Option<(SmartAction, Option<i64>)>`. Change the return type and parsing logic.

Replace the entire parsing block (lines 59-98, from `let parsed: serde_json::Value` to the end of the function) with:

```rust
    let response_text = result?;

    // Parse JSON response — try direct parse, then extract JSON from possible markdown wrapper
    let parsed: serde_json::Value = serde_json::from_str(&response_text)
        .or_else(|_| {
            let trimmed = response_text.trim();
            let json_str = trimmed
                .find('{')
                .and_then(|start| trimmed.rfind('}').map(|end| &trimmed[start..=end]))
                .unwrap_or(trimmed);
            serde_json::from_str(json_str)
        })
        .ok()?;

    let action_str = parsed
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("full_polish");

    let needs_hotword = parsed
        .get("needs_hotword")
        .and_then(|v| v.as_bool())
        .unwrap_or(true); // Default to true (safe fallback)

    let action = match action_str {
        "pass_through" => SmartAction::PassThrough,
        "lite_polish" => SmartAction::LitePolish,
        _ => SmartAction::FullPolish,
    };

    info!(
        "[SmartRouting] Action={} needs_hotword={} tokens={:?} input_len={}",
        action_str,
        needs_hotword,
        token_count,
        transcription.chars().count()
    );

    Some(super::IntentDecision {
        action,
        needs_hotword,
        token_count,
    })
```

Also update the function signature return type from `Option<(SmartAction, Option<i64>)>` to `Option<super::IntentDecision>`.

- [ ] **Step 3: Update all callers of `execute_smart_action_routing` in `pipeline.rs`**

In `pipeline.rs`, the current callers (around lines 312-370) destructure the result as `(SmartAction, Option<i64>)`. Update them to use `IntentDecision`. The specific code changes:

Find the match block (around line 320):

```rust
match &action_result {
    Some((super::routing::SmartAction::PassThrough, token_count)) => {
```

Replace with:

```rust
match &action_result {
    Some(super::IntentDecision { action: super::routing::SmartAction::PassThrough, token_count, .. }) => {
```

Find (around line 340):

```rust
Some((super::routing::SmartAction::LitePolish { result }, token_count)) => {
    if log_routing {
        info!("[SmartRouting] Action: lite_polish ({} chars)", char_count);
    }
    return (
        Some(result.clone()),
        None,
        override_prompt_id.clone(),
        false,
        None,
        *token_count,
        Some(1),
    );
}
```

Replace with:

```rust
Some(super::IntentDecision { action: super::routing::SmartAction::LitePolish, token_count, .. }) => {
    if log_routing {
        info!("[SmartRouting] Action: lite_polish ({} chars), delegating to lightweight model", char_count);
    }
    // LitePolish no longer short-circuits — fall through to execution with lightweight model.
    // The needs_hotword flag and lite prompt will be handled by the caller.
    smart_routing_tokens = *token_count;
}
```

Find (around line 354):

```rust
Some((super::routing::SmartAction::FullPolish, _)) => {
```

Replace with:

```rust
Some(super::IntentDecision { action: super::routing::SmartAction::FullPolish, token_count, .. }) => {
```

And update the token extraction accordingly:

```rust
smart_routing_tokens = action_result.as_ref().and_then(|d| d.token_count);
```

Replace with:

```rust
smart_routing_tokens = *token_count;
```

Find (around line 363):

```rust
None => {
```

This stays the same.

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: No errors related to `SmartAction` or `IntentDecision`. There may be warnings about unused fields which are fine at this stage.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/post_process/routing.rs src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Simplify SmartAction to decision-only, add IntentDecision with needs_hotword"
```

---

### Task 4: Implement `unified_post_process()` in `pipeline.rs`

This is the core task. The new function orchestrates the 4-step flow and returns `PipelineResult`.

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `src-tauri/src/actions/post_process/mod.rs` (add re-export if not done in Task 2)

- [ ] **Step 1: Add the `unified_post_process` function signature**

Add this function at the **top** of `pipeline.rs` (after imports, before `detect_scenario`). It wraps the full 4-step decision flow:

```rust
/// Unified post-processing entry point.
///
/// Implements the 4-step routing pipeline:
///   1. History exact match (short-circuit if hit)
///   2. Intent analysis (pass_through / lite_polish / full_polish + needs_hotword)
///   3. Model selection (single vs multi-model, prompt selection)
///   4. Execute polish
///
/// Returns `PipelineResult` — caller handles all UI (review window, paste, history).
pub async fn unified_post_process(
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
) -> super::PipelineResult {
    let log_routing = crate::DEBUG_LOG_ROUTING.load(std::sync::atomic::Ordering::Relaxed);

    // --- Gate: post-processing disabled ---
    if !settings.post_process_enabled {
        return super::PipelineResult::Skipped;
    }
    if override_prompt_id.as_deref() == Some("__SKIP_POST_PROCESS__") {
        info!("[UnifiedPipeline] Skipping post-processing due to app rule override");
        return super::PipelineResult::Skipped;
    }

    let char_count = transcription.chars().count() as u32;
    let smart_routing_enabled = settings.length_routing_enabled
        && settings.post_process_intent_model_id.is_some();
    let is_short_text = char_count <= settings.length_routing_threshold;

    // ═══════════════════════════════════════════════════════════════
    // Step 1 + 2: Smart Routing (only for short text with smart mode on)
    // ═══════════════════════════════════════════════════════════════
    let mut intent_decision: Option<super::IntentDecision> = None;

    if smart_routing_enabled && is_short_text {
        // Step 1: History exact match
        if let Some(hm) = app_handle.try_state::<Arc<HistoryManager>>() {
            match hm.find_cached_post_process_result(transcription) {
                Ok(Some((cached_text, cached_model, cached_prompt_id))) => {
                    if log_routing {
                        info!(
                            "[UnifiedPipeline] Step 1: HistoryHit (len={})",
                            cached_text.chars().count()
                        );
                    }
                    return super::PipelineResult::Cached {
                        text: cached_text,
                        model: cached_model,
                        prompt_id: cached_prompt_id,
                    };
                }
                Ok(None) => {
                    if log_routing {
                        info!("[UnifiedPipeline] Step 1: HistoryMiss (len={})", char_count);
                    }
                }
                Err(e) => {
                    error!("[UnifiedPipeline] Step 1: History lookup failed: {}", e);
                }
            }
        }

        // Step 2: Intent analysis
        let fallback_provider = match settings.active_post_process_provider() {
            Some(p) => p,
            None => return super::PipelineResult::Skipped,
        };

        let decision = super::routing::execute_smart_action_routing(
            app_handle,
            settings,
            fallback_provider,
            transcription,
        )
        .await;

        match &decision {
            Some(d) if d.action == super::routing::SmartAction::PassThrough => {
                if log_routing {
                    info!(
                        "[UnifiedPipeline] Step 2: PassThrough ({} chars)",
                        char_count
                    );
                }
                return super::PipelineResult::PassThrough {
                    text: transcription.to_string(),
                    intent_token_count: d.token_count,
                };
            }
            Some(d) => {
                if log_routing {
                    info!(
                        "[UnifiedPipeline] Step 2: {:?} (needs_hotword={}, {} chars)",
                        d.action, d.needs_hotword, char_count
                    );
                }
            }
            None => {
                if log_routing {
                    info!(
                        "[UnifiedPipeline] Step 2: Intent analysis unavailable, defaulting to FullPolish"
                    );
                }
            }
        }
        intent_decision = decision;
    } else if log_routing {
        if !smart_routing_enabled {
            info!("[UnifiedPipeline] Smart routing disabled, going to full pipeline");
        } else {
            info!(
                "[UnifiedPipeline] Long text ({} > {}), skipping smart routing",
                char_count, settings.length_routing_threshold
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 3 + 4: Model Selection and Execution
    // ═══════════════════════════════════════════════════════════════
    let is_lite = intent_decision
        .as_ref()
        .map(|d| d.action == super::routing::SmartAction::LitePolish)
        .unwrap_or(false);
    let needs_hotword = intent_decision
        .as_ref()
        .map(|d| d.needs_hotword)
        .unwrap_or(true); // Default: inject hotwords
    let intent_tokens = intent_decision.as_ref().and_then(|d| d.token_count);

    // For LitePolish: use lightweight model + lite prompt, always single-model
    if is_lite {
        if log_routing {
            info!("[UnifiedPipeline] Step 3: LitePolish → lightweight single-model path");
        }

        // Build a temporary settings override for lightweight model
        let mut lite_settings = settings.clone();
        if let Some(ref short_model_id) = settings.length_routing_short_model_id {
            lite_settings.selected_prompt_model_id = Some(short_model_id.clone());
        }
        // Disable hotwords if intent says not needed
        if !needs_hotword {
            lite_settings.post_process_hotword_injection_enabled = false;
        }

        // Load the lite polish prompt and create a temporary LLMPrompt
        let prompt_manager = app_handle.state::<Arc<crate::managers::prompt::PromptManager>>();
        let lite_instructions = prompt_manager
            .get_prompt(app_handle, "system_lite_polish")
            .unwrap_or_else(|_| {
                "Fix minor ASR errors. Output corrected text only.".to_string()
            });

        // Use default prompt as base, override instructions
        let lite_prompt = if let Some(base) = lite_settings.post_process_prompts.first() {
            let mut p = base.clone();
            p.instructions = lite_instructions;
            p
        } else {
            return super::PipelineResult::Skipped;
        };

        // Resolve model for lite prompt
        let fallback_provider = match lite_settings.active_post_process_provider() {
            Some(p) => p,
            None => return super::PipelineResult::Skipped,
        };

        let (actual_provider, model) =
            match super::routing::resolve_effective_model(&lite_settings, fallback_provider, &lite_prompt) {
                Some((p, m)) => (p, m),
                None => return super::PipelineResult::Skipped,
            };

        if show_overlay {
            show_llm_processing_overlay(app_handle);
        }

        // Build prompt (minimal — no history context for lite, hotword only if needed)
        let hotword_injection = if needs_hotword && lite_settings.post_process_hotword_injection_enabled {
            build_hotword_injection(app_handle, &app_name, transcription)
        } else {
            None
        };

        let built = super::prompt_builder::PromptBuilder::new(&lite_prompt, transcription)
            .app_name(app_name.as_deref())
            .window_title(window_title.as_deref())
            .hotword_injection(hotword_injection)
            .app_language(&lite_settings.app_language)
            .injection_policy(super::prompt_builder::InjectionPolicy::for_post_process(
                &lite_settings,
            ))
            .build();

        let cached_model_id = lite_prompt
            .model_id
            .as_deref()
            .or(lite_settings.selected_prompt_model_id.as_deref());

        let (result, err, error_message, api_token_count) =
            super::core::execute_llm_request_with_messages(
                app_handle,
                &lite_settings,
                actual_provider,
                &model,
                cached_model_id,
                &built.system_messages,
                built.user_message.as_deref(),
                app_name,
                window_title,
                None,
                None,
                None,
            )
            .await;

        let total_tokens = match (intent_tokens, api_token_count) {
            (Some(a), Some(b)) => Some(a + b),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let total_calls = Some(if intent_tokens.is_some() { 2 } else { 1 });

        return super::PipelineResult::SingleModel {
            text: result,
            model: Some(model),
            prompt_id: Some(lite_prompt.id.clone()),
            token_count: total_tokens,
            llm_call_count: total_calls,
            error: err,
            error_message,
        };
    }

    // FullPolish path: check if multi-model should be used
    let use_multi_model = settings.multi_model_post_process_enabled
        && !skill_mode
        && !matches!(
            crate::window_context::resolve_votype_input_mode(
                app_name.as_deref(),
                window_title.as_deref(),
                review_editor_active,
                selected_text.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false),
            ),
            crate::window_context::VotypeInputMode::MainPolishInput
                | crate::window_context::VotypeInputMode::MainSelectedEdit
                | crate::window_context::VotypeInputMode::ReviewRewrite
        );

    if use_multi_model {
        let multi_items = settings.build_multi_model_items_from_selection();
        if !multi_items.is_empty() {
            if log_routing {
                info!(
                    "[UnifiedPipeline] Step 3: FullPolish → multi-model ({} models, strategy={})",
                    multi_items.len(),
                    settings.multi_model_strategy
                );
            }

            if show_overlay {
                show_llm_processing_overlay(app_handle);
                app_handle.emit("post-process-status", "正在多模型润色中...").ok();
            }

            let candidates = super::extensions::multi_post_process_transcription(
                app_handle,
                settings,
                transcription,
                streaming_transcription,
                history_id,
                app_name,
                window_title,
                override_prompt_id.clone(),
            )
            .await;

            let total_tokens: Option<i64> = {
                let mut sum: i64 = intent_tokens.unwrap_or(0);
                sum += candidates.iter().filter_map(|r| r.token_count).sum::<i64>();
                if sum > 0 { Some(sum) } else { None }
            };
            let call_count: Option<i64> = {
                let mut count = candidates.len() as i64;
                if intent_tokens.is_some() { count += 1; }
                if count > 0 { Some(count) } else { None }
            };

            let effective_prompt_id = override_prompt_id
                .or(settings.post_process_selected_prompt_id.clone());

            return super::PipelineResult::MultiModel {
                candidates,
                multi_items,
                strategy: settings.multi_model_strategy.clone(),
                total_token_count: total_tokens,
                llm_call_count: call_count,
                prompt_id: effective_prompt_id,
            };
        }
    }

    // Single-model full polish: delegate to existing maybe_post_process_transcription
    if log_routing {
        info!("[UnifiedPipeline] Step 3: FullPolish → single-model path");
    }

    // If intent said no hotwords needed, temporarily disable
    let effective_settings;
    let settings_ref = if !needs_hotword && settings.post_process_hotword_injection_enabled {
        let mut s = settings.clone();
        s.post_process_hotword_injection_enabled = false;
        effective_settings = s;
        &effective_settings
    } else {
        settings
    };

    let (text, model, prompt_id, err, error_message, api_token_count, api_call_count) =
        maybe_post_process_transcription(
            app_handle,
            settings_ref,
            transcription,
            streaming_transcription,
            show_overlay,
            override_prompt_id,
            app_name,
            window_title,
            match_pattern,
            match_type,
            history_id,
            skill_mode,
            review_editor_active,
            selected_text,
            review_document_text,
        )
        .await;

    // Check for pending skill confirmation
    if model.as_deref() == Some("__PENDING_SKILL_CONFIRMATION__") {
        return super::PipelineResult::PendingSkillConfirmation {
            token_count: sum_tokens(intent_tokens, api_token_count),
            llm_call_count: sum_counts(if intent_tokens.is_some() { Some(1) } else { None }, api_call_count),
        };
    }

    super::PipelineResult::SingleModel {
        text,
        model,
        prompt_id,
        token_count: sum_tokens(intent_tokens, api_token_count),
        llm_call_count: sum_counts(if intent_tokens.is_some() { Some(1) } else { None }, api_call_count),
        error: err,
        error_message,
    }
}

/// Helper: sum two optional token counts
fn sum_tokens(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x + y),
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

/// Helper: sum two optional call counts
fn sum_counts(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x + y),
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

/// Helper: build hotword injection from history manager
fn build_hotword_injection(
    app_handle: &AppHandle,
    app_name: &Option<String>,
    transcription: &str,
) -> Option<crate::managers::hotword::HotwordInjection> {
    let hm = app_handle.try_state::<Arc<HistoryManager>>()?;
    let hotword_manager = HotwordManager::new(hm.db_path.clone());
    let scenario = detect_scenario(app_name);
    let effective_scenario = scenario.unwrap_or(HotwordScenario::Work);
    match hotword_manager.build_contextual_injection(
        effective_scenario,
        transcription,
        transcription,
        app_name.as_deref(),
    ) {
        Ok(injection)
            if !(injection.person_names.is_empty()
                && injection.product_names.is_empty()
                && injection.domain_terms.is_empty()
                && injection.hotwords.is_empty()) =>
        {
            Some(injection)
        }
        _ => None,
    }
}
```

- [ ] **Step 2: Add the re-export in `mod.rs`**

In `mod.rs`, after line 18 (`pub use pipeline::maybe_post_process_transcription;`), add:

```rust
pub use pipeline::unified_post_process;
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | head -40`

Expected: Compiles without errors. Warnings about unused variables or dead code are acceptable at this stage.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/actions/post_process/mod.rs
git commit -m "Add unified_post_process entry point with 4-step routing pipeline"
```

---

### Task 5: Replace multi-model branch in `transcribe.rs` with unified pipeline call

This is the largest change. Delete the multi-model branch (~500 lines) and replace the single-model call with `unified_post_process`, then handle `PipelineResult` uniformly.

**Files:**

- Modify: `src-tauri/src/actions/transcribe.rs`

- [ ] **Step 1: Identify the replacement zone**

The code to replace spans from line ~1121 (comment `// Check if multi-model post-processing is enabled`) through line ~1608 (the `return;` that ends the multi-model block) AND the single-model call starting at line ~1611 through line ~1645.

Both branches are replaced by a single call to `unified_post_process` followed by a match on `PipelineResult`.

- [ ] **Step 2: Replace the multi-model + single-model branches**

Delete from line 1121 (`// Check if multi-model post-processing is enabled`) through line 1645 (end of `(token_count, llm_call_count) = (inner_token_count, inner_llm_call_count);`).

Replace with:

```rust
                                // ═══════════════════════════════════════════
                                // Unified post-processing pipeline
                                // ═══════════════════════════════════════════
                                let pipeline_result =
                                    crate::actions::post_process::unified_post_process(
                                        &ah_clone,
                                        &settings_clone,
                                        &chinese_converted_text,
                                        secondary.as_deref(),
                                        true,
                                        override_prompt_id.clone(),
                                        active_window_snapshot_for_review
                                            .as_ref()
                                            .map(|info| info.app_name.clone()),
                                        active_window_snapshot_for_review
                                            .as_ref()
                                            .map(|info| info.title.clone()),
                                        matched_rule.map(|r| r.pattern.clone()),
                                        matched_rule.map(|r| r.match_type),
                                        history_id,
                                        skill_mode,
                                        review_editor_active,
                                        selected_text.clone(),
                                        review_document_text.clone(),
                                    )
                                    .await;

                                // Handle pipeline result
                                match pipeline_result {
                                    crate::actions::post_process::PipelineResult::Skipped => {
                                        // No post-processing — use original transcription
                                    }

                                    crate::actions::post_process::PipelineResult::Cached {
                                        text,
                                        model,
                                        prompt_id,
                                    } => {
                                        final_text = text;
                                        if model.is_some() {
                                            used_model = model;
                                        }
                                        if prompt_id.is_some() {
                                            post_process_prompt_id = prompt_id;
                                        }
                                        token_count = Some(0);
                                        llm_call_count = Some(0);
                                    }

                                    crate::actions::post_process::PipelineResult::PassThrough {
                                        text,
                                        intent_token_count,
                                    } => {
                                        final_text = text;
                                        token_count = intent_token_count;
                                        llm_call_count = Some(1);
                                    }

                                    crate::actions::post_process::PipelineResult::PendingSkillConfirmation {
                                        token_count: tc,
                                        llm_call_count: lc,
                                    } => {
                                        info!("[PostProcess] Skill confirmation pending, keeping overlay visible");
                                        token_count = tc;
                                        llm_call_count = lc;
                                        return;
                                    }

                                    crate::actions::post_process::PipelineResult::MultiModel {
                                        candidates,
                                        multi_items,
                                        strategy,
                                        total_token_count,
                                        llm_call_count: multi_call_count,
                                        prompt_id: effective_prompt_id,
                                    } => {
                                        token_count = total_token_count;
                                        llm_call_count = multi_call_count;

                                        let auto_pick_multi =
                                            strategy == "race" || strategy == "lazy";

                                        // Get output_mode from the prompt
                                        let output_mode = if let Some(ref pid) = effective_prompt_id {
                                            settings_clone
                                                .post_process_prompts
                                                .iter()
                                                .find(|p| &p.id == pid)
                                                .map(|p| p.output_mode)
                                                .or_else(|| {
                                                    let sm = crate::managers::skill::SkillManager::new(&ah_clone);
                                                    sm.get_all_skills()
                                                        .into_iter()
                                                        .find(|p| &p.id == pid)
                                                        .map(|p| p.output_mode)
                                                })
                                                .unwrap_or_default()
                                        } else {
                                            crate::settings::PromptOutputMode::default()
                                        };

                                        if !auto_pick_multi {
                                            // Manual strategy: show review window with candidates
                                            let initial_candidates: Vec<crate::review_window::MultiModelCandidate> =
                                                candidates
                                                    .iter()
                                                    .map(|r| crate::review_window::MultiModelCandidate {
                                                        id: r.id.clone(),
                                                        label: r.label.clone(),
                                                        text: r.text.clone(),
                                                        confidence: r.confidence,
                                                        processing_time_ms: r.processing_time_ms,
                                                        error: r.error.clone(),
                                                        ready: r.ready,
                                                    })
                                                    .collect();

                                            crate::review_window::set_last_active_window(
                                                active_window_snapshot_for_review.clone(),
                                            );
                                            crate::review_window::show_review_window_with_candidates(
                                                &ah_clone,
                                                transcription_clone.clone(),
                                                initial_candidates,
                                                history_id,
                                                output_mode,
                                                None,
                                                effective_prompt_id,
                                            );
                                            utils::hide_recording_overlay(&ah_clone);
                                            change_tray_icon(&ah_clone, TrayIconState::Idle);

                                            // Save best result to history
                                            if let Some(best) = candidates.iter().find(|r| r.ready && r.error.is_none()) {
                                                let model_name = multi_items
                                                    .iter()
                                                    .find(|item| item.id == best.id)
                                                    .map(|item| item.model_id.clone())
                                                    .unwrap_or_else(|| best.label.clone());
                                                if let Some(hid) = history_id {
                                                    if let Err(e) = hm_clone
                                                        .save_post_processed_text(
                                                            hid,
                                                            best.text.clone(),
                                                            Some(model_name),
                                                            settings_clone.post_process_selected_prompt_id.clone(),
                                                            total_token_count,
                                                            multi_call_count,
                                                        )
                                                        .await
                                                    {
                                                        error!("Failed to save multi-model result to history: {}", e);
                                                    }
                                                }
                                            }
                                            return;
                                        }

                                        // Auto-pick: select best result
                                        let best_result = candidates.iter().find(|r| r.ready && r.error.is_none());
                                        if let Some(best) = best_result {
                                            let model_name = multi_items
                                                .iter()
                                                .find(|item| item.id == best.id)
                                                .map(|item| item.model_id.clone())
                                                .unwrap_or_else(|| best.label.clone());

                                            final_text = best.text.clone();
                                            used_model = Some(model_name);
                                            if effective_prompt_id.is_some() {
                                                post_process_prompt_id = effective_prompt_id;
                                            }
                                        } else {
                                            // All candidates failed — fall through to use original text
                                            info!("[UnifiedPipeline] All multi-model candidates failed, using original transcription");
                                            error_shown = true;
                                        }
                                    }

                                    crate::actions::post_process::PipelineResult::SingleModel {
                                        text: processed_text,
                                        model,
                                        prompt_id,
                                        token_count: tc,
                                        llm_call_count: lc,
                                        error: err,
                                        error_message,
                                    } => {
                                        token_count = tc;
                                        llm_call_count = lc;
                                        let post_process_failed = err && processed_text.is_none();
                                        error_shown = error_shown || err;

                                        if model.is_some() {
                                            used_model = model;
                                        }
                                        if let Some(text) = processed_text.as_ref() {
                                            final_text = text.clone();
                                        }
                                        if prompt_id.is_some() {
                                            post_process_prompt_id = prompt_id;
                                        }
                                        if post_process_failed {
                                            if let Some(msg) = error_message {
                                                error!("Post-processing failed: {}", msg);
                                            }
                                        }
                                    }
                                }
```

- [ ] **Step 3: Remove now-dead `__PENDING_SKILL_CONFIRMATION__` check**

After the replacement, there was previously a check for `__PENDING_SKILL_CONFIRMATION__` at line ~1648. This is now handled inside the match arm above. Find and delete any remaining reference to it below the match block:

```rust
// DELETE THIS (if it still exists after replacement):
if model.as_deref() == Some("__PENDING_SKILL_CONFIRMATION__") {
    ...
    return;
}
```

- [ ] **Step 4: Verify the remaining code still compiles**

The code after the match block (review window logic at ~line 1654 onwards) should still work because `final_text`, `used_model`, `post_process_prompt_id`, `token_count`, `llm_call_count`, and `error_shown` are all set by the match arms above.

Run: `cd src-tauri && cargo check 2>&1 | head -50`

Fix any compilation errors. Common issues:

- Variable shadowing or missing variables from deleted multi-model branch
- Type mismatches in `PipelineResult` fields
- Missing imports

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs
git commit -m "Replace split multi/single-model branches with unified pipeline call"
```

---

### Task 6: Clean up `pipeline.rs` — remove duplicate smart routing from `maybe_post_process_transcription`

Now that `unified_post_process` handles Steps 1-2 (history + intent), the smart routing code inside `maybe_post_process_transcription` is duplicated. When called from the unified pipeline for FullPolish single-model, Steps 1-2 have already run.

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs`

- [ ] **Step 1: Add a parameter to skip smart routing when called from unified pipeline**

The simplest approach: `maybe_post_process_transcription` already has the `length_routing_enabled` settings flag controlling smart routing. Since `unified_post_process` delegates to it for single-model FullPolish, and the intent analysis has already run, we need to avoid re-running it.

Add a new `skip_smart_routing: bool` parameter to `maybe_post_process_transcription`:

At line 222, update the function signature — add `skip_smart_routing: bool` after `review_document_text: Option<String>`:

```rust
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
    skip_smart_routing: bool,
) -> (/* same return type */)
```

- [ ] **Step 2: Guard the smart routing block**

At line 265, wrap the existing smart routing block:

Change:

```rust
    if settings.length_routing_enabled {
```

To:

```rust
    if settings.length_routing_enabled && !skip_smart_routing {
```

- [ ] **Step 3: Update all callers**

There are two callers:

1. `unified_post_process` in `pipeline.rs` — pass `true` (skip smart routing, already done)
2. Any remaining direct callers in `transcribe.rs` (the multi-model fallback path that was deleted in Task 5 should be gone, but verify)

In `unified_post_process` (Task 4's code), the call to `maybe_post_process_transcription` should pass `true` as the last argument:

```rust
        maybe_post_process_transcription(
            app_handle,
            settings_ref,
            transcription,
            streaming_transcription,
            show_overlay,
            override_prompt_id,
            app_name,
            window_title,
            match_pattern,
            match_type,
            history_id,
            skill_mode,
            review_editor_active,
            selected_text,
            review_document_text,
            true, // skip_smart_routing: already done by unified_post_process
        )
        .await;
```

Search for any other callers:

Run: `grep -rn "maybe_post_process_transcription" src-tauri/src/ --include="*.rs"`

For any external callers (e.g., in `manual.rs` or elsewhere), pass `false` to maintain existing behavior.

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/actions/transcribe.rs
git commit -m "Add skip_smart_routing flag to avoid duplicate intent analysis"
```

---

### Task 7: Smoke test and final verification

**Files:** None (testing only)

- [ ] **Step 1: Full compilation check**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`

Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify all entry points**

Run: `grep -rn "unified_post_process\|maybe_post_process_transcription\|multi_post_process_transcription" src-tauri/src/ --include="*.rs" | grep -v "^.*:.*//"`

Verify:

- `unified_post_process` is called from `transcribe.rs` (the main entry)
- `maybe_post_process_transcription` is called only from `unified_post_process` (and possibly `manual.rs`)
- `multi_post_process_transcription` is called only from `unified_post_process`
- No direct calls to multi-model from `transcribe.rs`

- [ ] **Step 3: Verify prompt files exist**

Run: `ls -la src-tauri/resources/prompts/system_smart_routing.md src-tauri/resources/prompts/system_lite_polish.md`

Expected: Both files exist.

- [ ] **Step 4: Check for leftover dead code**

Run: `cd src-tauri && cargo build 2>&1 | grep "warning.*dead_code\|warning.*unused" | head -20`

Address any warnings that are directly related to the refactoring (removed branches leaving unused variables, etc.).

- [ ] **Step 5: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "Clean up dead code from unified pipeline refactoring"
```
