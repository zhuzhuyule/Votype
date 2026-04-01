# Skill Routing & Smart Polish Pipeline Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the complete skill routing pipeline so that invoke_skill hotkey and selected-text intent detection work correctly, and extract Smart Polish as a reusable pipeline module.

**Architecture:** The post-processing pipeline has two independent routing systems: Smart Routing (classifies text quality for polish) and Skill Routing (detects user intent for skill execution). When selected text exists, the user's speech is an instruction targeting that content — Smart Routing is irrelevant and Skill Routing should drive the flow. The Smart Polish pipeline (Smart Routing → classify → execute) is extracted as a self-contained, reusable module that can be called from any context.

**Tech Stack:** Rust, Tauri 2.x, async_openai

---

## File Structure

| File                                             | Role                                    | Action                                                       |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ |
| `src-tauri/src/actions/post_process/routing.rs`  | Smart Routing & Skill Routing functions | **Modify**: Add `execute_smart_polish()` function            |
| `src-tauri/src/actions/post_process/pipeline.rs` | Unified pipeline & maybe_post_process   | **Modify**: Fix Mode B/C conditions, swap parallel polish    |
| `src-tauri/src/actions/post_process/mod.rs`      | Module types & re-exports               | **Modify**: Add `SmartPolishResult` type                     |
| `src-tauri/src/lib.rs`                           | App state types                         | **Modify**: Add `input_source` to `PendingSkillConfirmation` |
| `src-tauri/src/commands/mod.rs`                  | Tauri commands (confirm_skill)          | **Modify**: Use `input_source` for primary input selection   |
| `src-tauri/src/actions/transcribe.rs`            | FinishGuard overlay lifecycle           | **Already fixed**: pending skill check in FinishGuard        |

## Existing Fixes (already committed)

These fixes are already in the codebase from previous work in this session:

- `pipeline.rs:67-71` — Smart Routing skips `skill_mode` and `has_selected_text_raw`
- `pipeline.rs:360` — Multi-model skips `has_selected_text_raw`
- `pipeline.rs:1331` — Mode C condition simplified (no `is_explicit`/`override_prompt_id` gate)
- `pipeline.rs:191-207` — Accurate skip-reason logging
- `commands/mod.rs:373` — `confirm_skill` uses `skip_smart_routing: true`
- `transcribe.rs:385-394` — FinishGuard checks pending skill before hiding overlay

---

### Task 1: Extract `execute_smart_polish` as Reusable Pipeline

This is the core extraction. `execute_smart_polish` replaces `execute_default_polish` in Mode C's parallel block. It has the **same signature and return type**, but internally runs Smart Routing classification first, then executes the appropriate polish level.

**Files:**

- Modify: `src-tauri/src/actions/post_process/routing.rs`
- Modify: `src-tauri/src/actions/post_process/mod.rs`

- [ ] **Step 1: Add `SmartPolishResult` type to mod.rs**

In `src-tauri/src/actions/post_process/mod.rs`, the `DefaultPolishResult` is `pub(super)` in routing.rs. We need `SmartPolishResult` which includes the Smart Routing action taken. Add after the `IntentDecision` struct (around line 116):

```rust
/// Result from the smart polish pipeline (Smart Routing → classify → execute)
#[derive(Debug, Clone)]
pub(crate) struct SmartPolishResult {
    /// Polished text (or original for PassThrough)
    pub text: String,
    /// Which action was taken
    pub action: routing::SmartAction,
    /// Combined token count (routing + polish)
    pub token_count: Option<i64>,
    /// Model used for the final execution step
    pub model_id: String,
    /// Provider used for the final execution step
    pub provider_id: String,
    /// Total duration in milliseconds (routing + polish)
    pub duration_ms: u64,
}
```

- [ ] **Step 2: Implement `execute_smart_polish` in routing.rs**

Add this function after `execute_default_polish` (around line 475 in routing.rs). The function has the same parameters as `execute_default_polish` plus reuses existing functions:

```rust
/// Smart Polish pipeline: classify via Smart Routing, then execute appropriate polish level.
/// When Smart Routing is disabled or text is long, falls back to full polish directly.
/// This is a drop-in replacement for `execute_default_polish` with smarter internal routing.
pub(super) async fn execute_smart_polish<'a>(
    app_handle: &AppHandle,
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    default_prompt: &LLMPrompt,
    transcription: &str,
    app_name: Option<String>,
    window_title: Option<String>,
    history_id: Option<i64>,
) -> Option<super::SmartPolishResult> {
    let start = std::time::Instant::now();
    let char_count = transcription.chars().count() as u32;
    let smart_routing_enabled =
        settings.length_routing_enabled && settings.post_process_intent_model_id.is_some();
    let is_short_text = char_count <= settings.length_routing_threshold;

    // Phase 1: Classify (only for short text with smart routing enabled)
    let decision = if smart_routing_enabled && is_short_text {
        execute_smart_action_routing(app_handle, settings, fallback_provider, transcription).await
    } else {
        None // Long text or disabled → default to FullPolish
    };

    let action = decision
        .as_ref()
        .map(|d| d.action)
        .unwrap_or(SmartAction::FullPolish);
    let routing_tokens = decision.as_ref().and_then(|d| d.token_count);
    let needs_hotword = decision.as_ref().map(|d| d.needs_hotword).unwrap_or(true);

    // Phase 2: Execute based on classification
    match action {
        SmartAction::PassThrough => {
            // Check for repetition patterns (same override as unified_post_process)
            if super::pipeline::has_repetition_pattern(transcription) {
                info!("[SmartPolish] PassThrough overridden to LitePolish (repetition detected)");
                // Fall through to LitePolish below
            } else {
                let total_ms = start.elapsed().as_millis() as u64;
                return Some(super::SmartPolishResult {
                    text: transcription.to_string(),
                    action: SmartAction::PassThrough,
                    token_count: routing_tokens,
                    model_id: "none".to_string(),
                    provider_id: "none".to_string(),
                    duration_ms: total_ms,
                });
            }
            // If repetition detected, execute LitePolish
            execute_smart_polish_lite(
                app_handle, settings, fallback_provider, transcription,
                needs_hotword, &app_name, routing_tokens, start,
            )
            .await
        }

        SmartAction::LitePolish => {
            execute_smart_polish_lite(
                app_handle, settings, fallback_provider, transcription,
                needs_hotword, &app_name, routing_tokens, start,
            )
            .await
        }

        SmartAction::FullPolish => {
            // Delegate to existing full polish, then wrap result
            // Apply hotword settings override if intent says not needed
            let effective_settings;
            let settings_ref = if !needs_hotword && settings.post_process_hotword_injection_enabled {
                let mut s = settings.clone();
                s.post_process_hotword_injection_enabled = false;
                effective_settings = s;
                &effective_settings
            } else {
                settings
            };

            let result = execute_default_polish(
                app_handle,
                settings_ref,
                fallback_provider,
                default_prompt,
                transcription,
                app_name,
                window_title,
                history_id,
            )
            .await?;

            let total_tokens = match (routing_tokens, result.token_count) {
                (Some(a), Some(b)) => Some(a + b),
                (Some(a), None) => Some(a),
                (None, b) => b,
            };

            Some(super::SmartPolishResult {
                text: result.text,
                action: SmartAction::FullPolish,
                token_count: total_tokens,
                model_id: result.model_id,
                provider_id: result.provider_id,
                duration_ms: start.elapsed().as_millis() as u64,
            })
        }
    }
}
```

- [ ] **Step 3: Implement `execute_smart_polish_lite` helper**

Add this private helper right after `execute_smart_polish`. It handles the LitePolish execution path (extracted from `unified_post_process` lines 234-352):

```rust
/// Execute LitePolish: lightweight model + lite prompt
async fn execute_smart_polish_lite<'a>(
    app_handle: &AppHandle,
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    transcription: &str,
    needs_hotword: bool,
    app_name: &Option<String>,
    routing_tokens: Option<i64>,
    start: std::time::Instant,
) -> Option<super::SmartPolishResult> {
    // Build lite settings with lightweight model
    let mut lite_settings = settings.clone();
    if let Some(ref short_model_id) = settings.length_routing_short_model_id {
        lite_settings.selected_prompt_model_id = Some(short_model_id.clone());
    }
    if !needs_hotword {
        lite_settings.post_process_hotword_injection_enabled = false;
    }

    // Load lite polish prompt
    let prompt_manager =
        app_handle.state::<std::sync::Arc<crate::managers::prompt::PromptManager>>();
    let lite_instructions = prompt_manager
        .get_prompt(app_handle, "system_lite_polish")
        .unwrap_or_else(|_| "Fix minor ASR errors. Output corrected text only.".to_string());

    // Build LLMPrompt from base prompt
    let lite_prompt = if let Some(base) = lite_settings.post_process_prompts.first() {
        let mut p = base.clone();
        p.id = "__LITE_POLISH__".to_string();
        p.name = "轻量润色".to_string();
        p.instructions = lite_instructions;
        p
    } else {
        return None;
    };

    let lite_provider = lite_settings.active_post_process_provider()?;
    let (actual_provider, model) =
        resolve_effective_model(&lite_settings, lite_provider, &lite_prompt)?;

    // Build hotword injection if needed
    let hotword_injection = if needs_hotword && lite_settings.post_process_hotword_injection_enabled
    {
        super::pipeline::build_hotword_injection(app_handle, app_name, transcription)
    } else {
        None
    };

    let built = super::prompt_builder::PromptBuilder::new(&lite_prompt, transcription)
        .app_name(app_name.as_deref())
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

    let (result, _err, _error_msg, token_count) =
        super::core::execute_llm_request_with_messages(
            app_handle,
            &lite_settings,
            actual_provider,
            &model,
            cached_model_id,
            &built.system_messages,
            built.user_message.as_deref(),
            None,
            app_name.clone(),
            None,
            None,
            None,
            None,
        )
        .await;

    let total_tokens = match (routing_tokens, token_count) {
        (Some(a), Some(b)) => Some(a + b),
        (Some(a), None) => Some(a),
        (None, b) => b,
    };

    Some(super::SmartPolishResult {
        text: result.unwrap_or_else(|| transcription.to_string()),
        action: super::routing::SmartAction::LitePolish,
        token_count: total_tokens,
        model_id: model.clone(),
        provider_id: actual_provider.id.clone(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}
```

- [ ] **Step 4: Make `build_hotword_injection` and `has_repetition_pattern` pub(super)**

In `src-tauri/src/actions/post_process/pipeline.rs`, find `fn build_hotword_injection` (around line 581) and `fn has_repetition_pattern` and ensure they are `pub(super)` so routing.rs can call them:

```rust
// Change from:
fn build_hotword_injection(
// To:
pub(super) fn build_hotword_injection(

// Change from:
fn has_repetition_pattern(
// To:
pub(super) fn has_repetition_pattern(
```

- [ ] **Step 5: Compile check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: Compilation succeeds (warnings OK)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/routing.rs src-tauri/src/actions/post_process/mod.rs src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Extract execute_smart_polish as reusable pipeline module

Smart Polish encapsulates the full Smart Routing pipeline (classify →
execute) behind the same interface as execute_default_polish. Internally
it runs Smart Routing classification first, then dispatches to
PassThrough, LitePolish (lightweight model), or FullPolish as needed.
When Smart Routing is disabled, falls back to FullPolish directly."
```

---

### Task 2: Wire Smart Polish into Mode C Parallel Block

Replace `execute_default_polish` with `execute_smart_polish` in Mode C's `tokio::join!` block.

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs`

- [ ] **Step 1: Update the parallel join in Mode C**

In `pipeline.rs`, find the Mode C parallel block (around line 1352). Change the second arm of `tokio::join!` from `execute_default_polish` to `execute_smart_polish`:

```rust
// Before (around line 1352):
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

// After:
let (intent_result, smart_polish_result) = tokio::join!(
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
    // Smart polish (Smart Routing → classify → execute)
    super::routing::execute_smart_polish(
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
```

- [ ] **Step 2: Update post-parallel code to use `smart_polish_result`**

The variable was renamed from `polish_result` to `smart_polish_result`, and the type changed from `Option<DefaultPolishResult>` to `Option<SmartPolishResult>`. Update all downstream references in Mode C (lines ~1358-1596):

Replace the token accumulation block:

```rust
// Before:
if let Some(ref pr) = polish_result {
    if let Some(tc) = pr.token_count {
        routing_token_count += tc;
    }
    routing_call_count += 1;
}

let intent_response = intent_result.map(|r| r.response);
let polish_text = polish_result.map(|r| r.text);

// After:
if let Some(ref pr) = smart_polish_result {
    if let Some(tc) = pr.token_count {
        routing_token_count += tc;
    }
    // Smart polish may include 1-2 LLM calls internally (routing + polish)
    routing_call_count += match pr.action {
        super::routing::SmartAction::PassThrough => 1, // routing only
        _ => 2, // routing + polish
    };
}

let intent_response = intent_result.map(|r| r.response);
let polish_text = smart_polish_result.map(|r| r.text);
```

The rest of Mode C uses `polish_text: Option<String>` which is unchanged.

- [ ] **Step 3: Compile check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: Compilation succeeds

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Wire execute_smart_polish into Mode C parallel block

Replace execute_default_polish with execute_smart_polish in Mode C's
tokio::join! so the parallel polish path uses Smart Routing internally.
Short instruction text gets PassThrough (0ms) or LitePolish (fast)
instead of always running FullPolish with the heavy model."
```

---

### Task 3: Add `input_source` to PendingSkillConfirmation

The Skill Router returns `input_source` telling which content to use as primary input, but this information is lost when saving to `PendingSkillConfirmation`. Fix the full chain: save → store → use.

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Add fields to `PendingSkillConfirmation`**

In `src-tauri/src/lib.rs`, add two fields to the struct (around line 130, before `is_ui_visible`):

```rust
pub struct PendingSkillConfirmation {
    pub skill_id: Option<String>,
    pub skill_name: Option<String>,
    pub transcription: Option<String>,
    pub selected_text: Option<String>,
    pub override_prompt_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub history_id: Option<i64>,
    /// Process ID of the original window for focus restoration
    pub process_id: Option<u64>,
    /// Cached polish result from parallel request
    pub polish_result: Option<String>,
    /// Input source from skill routing: "select", "output", or "extract"
    pub input_source: Option<String>,
    /// Extracted content from speech (when input_source is "extract")
    pub extracted_content: Option<String>,
    /// Whether the confirmation UI is visible in the frontend
    pub is_ui_visible: bool,
}
```

- [ ] **Step 2: Save `input_source` in Mode C's skill confirmation block**

In `pipeline.rs`, find the block where `PendingSkillConfirmation` is populated (around line 1491). Add the two new fields:

```rust
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
    polish_result: polish_text.clone(),
    input_source: route_response.input_source.clone(),           // NEW
    extracted_content: route_response.extracted_content.clone(),  // NEW
    is_ui_visible: false,
};
```

- [ ] **Step 3: Use `input_source` in `confirm_skill` to select primary input**

In `src-tauri/src/commands/mod.rs`, find the skill_input assignment (around line 333-337). Replace:

```rust
// Before:
let polished_text = pending
    .polish_result
    .clone()
    .filter(|text| !text.trim().is_empty());
let skill_input = polished_text.as_deref().unwrap_or(&transcription);
let secondary_output = if polished_text.is_some() {
    Some(transcription.as_str())
} else {
    None
};

// After:
// Determine primary input based on Skill Router's input_source decision
let skill_input_owned: String;
let secondary_output: Option<&str>;

match pending.input_source.as_deref() {
    Some("select") => {
        // Instruction targets selected text — selected text is primary input
        skill_input_owned = pending
            .selected_text
            .clone()
            .unwrap_or_else(|| transcription.clone());
        secondary_output = Some(&transcription); // speech as context
    }
    Some("extract") => {
        // Speech contains both instruction and content — use extracted portion
        skill_input_owned = pending
            .extracted_content
            .clone()
            .unwrap_or_else(|| transcription.clone());
        secondary_output = Some(&transcription);
    }
    _ => {
        // "output" or unspecified — use polished transcription (current behavior)
        let polished_text = pending
            .polish_result
            .clone()
            .filter(|text| !text.trim().is_empty());
        skill_input_owned = polished_text.unwrap_or_else(|| transcription.clone());
        secondary_output = None;
    }
};
let skill_input = skill_input_owned.as_str();
```

- [ ] **Step 4: Compile check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: Compilation succeeds

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/commands/mod.rs
git commit -m "Preserve input_source through skill confirmation flow

Add input_source and extracted_content fields to PendingSkillConfirmation.
When user confirms a skill, confirm_skill now uses input_source to decide
the primary input: 'select' uses selected text, 'extract' uses extracted
content, 'output' uses polished transcription."
```

---

### Task 4: Remove Mode B Override Prompt Gate

When `invoke_skill` hotkey is pressed, Skill Routing should always run regardless of app-specific override prompts.

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs`

- [ ] **Step 1: Simplify Mode B entry condition**

In `pipeline.rs`, find the Mode B condition (around line 1257):

```rust
// Before:
if effective_skill_mode
    && !is_explicit
    && override_prompt_id.is_none()
    && !transcription.trim().is_empty()
{

// After:
if effective_skill_mode && !transcription.trim().is_empty() {
```

- [ ] **Step 2: Compile check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: Compilation succeeds

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Allow invoke_skill to bypass app-specific override prompts

The invoke_skill hotkey represents explicit user intent to enter skill
mode. App rules (override_prompt_id) should not block skill routing."
```

---

### Task 5: Final Verification

End-to-end compile and review all changes.

**Files:**

- All modified files

- [ ] **Step 1: Full cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: Clean compilation (warnings acceptable)

- [ ] **Step 2: Verify the complete change set**

Run: `git log --oneline -6`

Expected commits (newest first):

1. Allow invoke_skill to bypass app-specific override prompts
2. Preserve input_source through skill confirmation flow
3. Wire execute_smart_polish into Mode C parallel block
4. Extract execute_smart_polish as reusable pipeline module
5. (existing commits)

- [ ] **Step 3: Review the full diff for consistency**

Run: `git diff HEAD~4..HEAD --stat`

Verify the files changed match expectations:

- `src-tauri/src/actions/post_process/routing.rs` — new functions
- `src-tauri/src/actions/post_process/pipeline.rs` — Mode B/C changes + pub(super) helpers
- `src-tauri/src/actions/post_process/mod.rs` — SmartPolishResult type
- `src-tauri/src/lib.rs` — PendingSkillConfirmation fields
- `src-tauri/src/commands/mod.rs` — input_source logic in confirm_skill
