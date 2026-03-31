# Multi-Turn Voice Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multi-turn conversation in the review window's voice rewrite mode so subsequent voice instructions share context with previous exchanges.

**Architecture:** Add a session-scoped conversation history (`Vec<RewriteMessage>`) to `review_window.rs`, keyed by session ID to prevent cross-session contamination. The LLM call in `core.rs` gains an optional `conversation_history` parameter. The pipeline reads/writes history around each rewrite call, storing only normalized assistant content.

**Tech Stack:** Rust (Tauri backend), async-openai (`ChatCompletionRequestAssistantMessageArgs`)

**Spec:** `docs/superpowers/specs/2026-03-31-multi-turn-voice-rewrite-design.md`

---

### Task 1: Add Rewrite Conversation State to review_window.rs

**Files:**

- Modify: `src-tauri/src/review_window.rs:70-84` (static state declarations)
- Modify: `src-tauri/src/review_window.rs:434-453` (hide_review_window)
- Modify: `src-tauri/src/review_window.rs:355-367` (show_review_window)
- Modify: `src-tauri/src/review_window.rs:586-596` (show_review_window_with_candidates)

- [ ] **Step 1: Add types and static state**

Add after the existing static declarations (after line 84):

```rust
/// Role in a rewrite conversation turn.
#[derive(Clone, Debug)]
pub enum RewriteRole {
    User,
    Assistant,
}

/// A single message in the rewrite conversation history.
#[derive(Clone, Debug)]
pub struct RewriteMessage {
    pub role: RewriteRole,
    pub content: String,
}

/// Session-scoped conversation history for multi-turn voice rewrite.
struct RewriteConversation {
    session_id: u64,
    messages: Vec<RewriteMessage>,
}

static REWRITE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static REWRITE_CONVERSATION: Lazy<Mutex<RewriteConversation>> = Lazy::new(|| {
    Mutex::new(RewriteConversation {
        session_id: 0,
        messages: Vec::new(),
    })
});
```

- [ ] **Step 2: Add public API functions**

Add after `take_frozen_review_editor_content()` (after line 584):

```rust
/// Get the current rewrite session ID.
pub fn current_rewrite_session_id() -> u64 {
    REWRITE_SESSION_COUNTER.load(Ordering::SeqCst)
}

/// Get conversation history, only if the session ID matches.
/// Returns None if the session has changed (stale request).
pub fn get_rewrite_conversation(session_id: u64) -> Option<Vec<RewriteMessage>> {
    REWRITE_CONVERSATION
        .lock()
        .ok()
        .and_then(|guard| {
            if guard.session_id == session_id {
                Some(guard.messages.clone())
            } else {
                None
            }
        })
}

/// Append a message to the conversation history, only if the session ID matches.
pub fn append_rewrite_message(session_id: u64, role: RewriteRole, content: String) {
    if let Ok(mut guard) = REWRITE_CONVERSATION.lock() {
        if guard.session_id == session_id {
            guard.messages.push(RewriteMessage { role, content });
        }
    }
}

/// Clear conversation history and start a new session.
fn reset_rewrite_conversation() {
    let new_id = REWRITE_SESSION_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut guard) = REWRITE_CONVERSATION.lock() {
        guard.session_id = new_id;
        guard.messages.clear();
    }
}
```

- [ ] **Step 3: Clear history on hide_review_window**

In `hide_review_window()`, add before the final `hidden.clear()` line (before line 452):

```rust
    reset_rewrite_conversation();
```

- [ ] **Step 4: Clear history on show_review_window**

In `show_review_window()`, add after `REVIEW_WINDOW_ACTIVE.store(false, ...)` (after line 367):

```rust
    reset_rewrite_conversation();
```

- [ ] **Step 5: Clear history on show_review_window_with_candidates**

In `show_review_window_with_candidates()`, add after `REVIEW_WINDOW_ACTIVE.store(false, ...)` (after line 596):

```rust
    reset_rewrite_conversation();
```

- [ ] **Step 6: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: `Finished` with no errors (warnings OK)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/review_window.rs
git commit -m "Add session-scoped rewrite conversation state to review window"
```

---

### Task 2: Add build_assistant_message Helper to core.rs

**Files:**

- Modify: `src-tauri/src/actions/post_process/core.rs:7-8` (imports)
- Modify: `src-tauri/src/actions/post_process/core.rs:202-210` (after build_user_message)

- [ ] **Step 1: Add import for assistant message type**

Update the import at line 7-8 to include `ChatCompletionRequestAssistantMessageArgs`:

```rust
use async_openai::types::{
    ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestDeveloperMessageArgs,
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs,
};
```

- [ ] **Step 2: Add build_assistant_message function**

Add after `build_user_message` (after line 210):

```rust
pub(crate) fn build_assistant_message(
    content: impl Into<String>,
) -> Option<ChatCompletionRequestMessage> {
    ChatCompletionRequestAssistantMessageArgs::default()
        .content(content.into())
        .build()
        .ok()
        .map(ChatCompletionRequestMessage::Assistant)
}
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: `Finished` with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs
git commit -m "Add build_assistant_message helper for multi-turn conversations"
```

---

### Task 3: Extend execute_llm_request_with_messages to Accept Conversation History

**Files:**

- Modify: `src-tauri/src/actions/post_process/core.rs:243-256` (function signature)
- Modify: `src-tauri/src/actions/post_process/core.rs:347-364` (message building)

- [ ] **Step 1: Add conversation_history parameter**

Update the function signature at line 243 to add a new parameter after `user_message`:

```rust
pub async fn execute_llm_request_with_messages(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    _app_name: Option<String>,
    _window_title: Option<String>,
    _match_pattern: Option<String>,
    _match_type: Option<crate::settings::TitleMatchType>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> (Option<String>, bool, Option<String>, Option<i64>)
```

- [ ] **Step 2: Insert conversation history into messages array**

In the message building section (around line 357, after the system prompts loop and before the user message), add:

```rust
    // Insert conversation history between system prompts and the new user message
    if let Some(history) = conversation_history {
        for msg in history {
            let chat_msg = match msg.role {
                crate::review_window::RewriteRole::User => build_user_message(&msg.content),
                crate::review_window::RewriteRole::Assistant => build_assistant_message(&msg.content),
            };
            if let Some(m) = chat_msg {
                messages.push(m);
            }
        }
    }
```

This goes after the system prompts loop (`for sp in system_prompts { ... }`) and before the `if let Some(um) = user_message { ... }` block.

- [ ] **Step 3: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: Errors from callers missing the new parameter (expected, will fix in next steps)

- [ ] **Step 4: Update all existing callers to pass None**

Search for all calls to `execute_llm_request_with_messages` and add `None` for the new `conversation_history` parameter. The callers are in:

- `pipeline.rs` (`execute_votype_rewrite_prompt`, line ~710) — will be updated in Task 4 with actual history
- `pipeline.rs` (any other call sites) — pass `None`
- `core.rs` (`execute_llm_request`, the wrapper function) — pass `None`

For each caller, insert `None,` after the `user_message` argument and before `_app_name`. Example for the wrapper `execute_llm_request`:

```rust
    execute_llm_request_with_messages(
        app_handle,
        settings,
        provider,
        model,
        cached_model_id,
        system_prompts,
        user_message,
        None, // conversation_history
        _app_name,
        // ... rest unchanged
    )
```

- [ ] **Step 5: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: `Finished` with no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Extend LLM request to accept optional conversation history"
```

---

### Task 4: Wire Multi-Turn History into execute_votype_rewrite_prompt

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs:630-772` (execute_votype_rewrite_prompt)

- [ ] **Step 1: Capture session ID and read history at the start**

After the `info!` logging lines (after line 661), add:

```rust
    let session_id = crate::review_window::current_rewrite_session_id();
    let history = crate::review_window::get_rewrite_conversation(session_id);
    let history_turns = history.as_ref().map(|h| h.len() / 2).unwrap_or(0);
    info!(
        "[VotypeRewrite] session_id={} history_turns={}",
        session_id, history_turns
    );
```

- [ ] **Step 2: Pass conversation history to the LLM call**

Update the `execute_llm_request_with_messages` call (around line 702-716) to pass the history:

```rust
    let (result, err, error_message, api_token_count) =
        super::core::execute_llm_request_with_messages(
            app_handle,
            settings,
            actual_provider,
            &model,
            cached_model_id,
            &system_prompts,
            Some(&user_message),
            history.as_deref(),
            app_name,
            window_title,
            None,
            None,
            None,
        )
        .await;
```

Note: `history.as_deref()` converts `Option<Vec<RewriteMessage>>` to `Option<&[RewriteMessage]>`.

- [ ] **Step 3: Append to history on successful parse**

In the successful parse branch (around line 733-757), after the `info!` logging and before the `return`, add:

```rust
            // Append this exchange to the multi-turn conversation history
            crate::review_window::append_rewrite_message(
                session_id,
                crate::review_window::RewriteRole::User,
                user_message.clone(),
            );
            crate::review_window::append_rewrite_message(
                session_id,
                crate::review_window::RewriteRole::Assistant,
                parsed.rewritten_text.clone(),
            );
```

This goes right before the `return (Some(parsed.rewritten_text), ...)` statement.

- [ ] **Step 4: Do NOT append on parse failure**

The fallback branch (lines 760-771) returns the raw result without parsing. No history append here — failed turns are stateless as specified in the design.

- [ ] **Step 5: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: `Finished` with no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Wire multi-turn conversation history into voice rewrite pipeline"
```

---

### Task 5: Manual Smoke Test

- [ ] **Step 1: Start the dev server**

Run: `bun tauri dev`

- [ ] **Step 2: Test single-model rewrite (regression)**

1. Trigger a normal transcription that opens the review window (single model)
2. Press the global shortcut and give a voice instruction (e.g., "add punctuation")
3. Verify the rewrite works as before
4. Check logs for `[VotypeRewrite] session_id=N history_turns=0`

- [ ] **Step 3: Test multi-turn rewrite**

1. With the review window still open from step 2, give another voice instruction (e.g., "use arrows to connect the steps")
2. Check logs for `[VotypeRewrite] session_id=N history_turns=1`
3. Verify the result builds on the previous rewrite context

- [ ] **Step 4: Test session isolation**

1. Close the review window (ESC)
2. Trigger a new transcription that opens a fresh review window
3. Give a voice instruction
4. Check logs for `history_turns=0` (history was cleared)
5. Verify the new session ID is different from the previous one

- [ ] **Step 5: Test multi-model rewrite**

1. Trigger a multi-model transcription
2. Wait for candidates to appear
3. Give a voice instruction
4. Verify rewrite works and logs show `history_turns=0` on first turn
5. Give another voice instruction, verify `history_turns=1`

- [ ] **Step 6: Commit spec and plan**

```bash
git add docs/superpowers/specs/2026-03-31-multi-turn-voice-rewrite-design.md docs/superpowers/plans/2026-03-31-multi-turn-voice-rewrite.md
git commit -m "Add multi-turn voice rewrite spec and implementation plan"
```
