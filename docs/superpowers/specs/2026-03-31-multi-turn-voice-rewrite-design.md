# Multi-Turn Voice Rewrite in Review Window

## Problem

Each voice rewrite in the review window is currently an independent single-turn LLM call. When the user issues multiple voice instructions on the same document (e.g., "use arrows to connect the steps" then "add punctuation"), each call has no awareness of the previous exchange. This prevents natural iterative editing where the LLM can build on prior context.

## Design

### Overview

Convert voice rewrite from independent calls into a multi-turn conversation scoped to the review window's lifecycle. The first rewrite establishes the conversation (system prompt + document + instruction); subsequent rewrites append to the same conversation history.

### State Management

**New state in `review_window.rs`:**

```rust
/// A single message in the rewrite conversation history.
struct RewriteMessage {
    role: RewriteRole,   // User or Assistant
    content: String,
}

enum RewriteRole {
    User,
    Assistant,
}

/// Conversation history keyed by session ID to prevent cross-session contamination.
struct RewriteConversation {
    session_id: u64,
    messages: Vec<RewriteMessage>,
}

static REWRITE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static REWRITE_CONVERSATION: Lazy<Mutex<RewriteConversation>> =
    Lazy::new(|| Mutex::new(RewriteConversation { session_id: 0, messages: Vec::new() }));
```

**Session isolation:**

- Each `show_review_window()` / `show_review_window_with_candidates()` increments `REWRITE_SESSION_COUNTER` and resets `REWRITE_CONVERSATION` with the new session ID
- When a rewrite response returns, it checks the current session ID before appending to history — if the session has changed (window closed and reopened), the stale response is discarded
- `hide_review_window()` also clears the conversation

**System prompt handling:**

- The system prompt is NOT stored in history — it is loaded fresh each call from PromptManager

**Public API:**

- `current_rewrite_session_id() -> u64` — get current session ID
- `get_rewrite_conversation(session_id: u64) -> Option<Vec<RewriteMessage>>` — clone history only if session matches
- `append_rewrite_message(session_id: u64, role, content)` — add a message only if session matches
- `clear_rewrite_conversation()` — reset history and increment session

### Message Building

**First turn (history empty):**

Messages array sent to LLM:

```
[system]  system_votype_rewrite prompt
[user]    [current_document]...[spoken_instruction]...[term_reference]...[output_language]...
```

Same as today. After the LLM responds, the user message and the **normalized assistant content** (extracted `rewritten_text`, not the raw response) are appended to `REWRITE_CONVERSATION`.

**Subsequent turns (history non-empty):**

Messages array sent to LLM:

```
[system]     system_votype_rewrite prompt
[user]       (turn 1 user message from history)
[assistant]  (turn 1 normalized response from history)
[user]       (turn 2 user message from history)
[assistant]  (turn 2 normalized response from history)
...
[user]       (new message with current [current_document] + [spoken_instruction])
```

Each follow-up user message still includes the full `[current_document]` (fetched from `REVIEW_EDITOR_CONTENT` at freeze time). This ensures the LLM sees the latest document state even if the user manually edited text between voice inputs.

**Assistant message normalization:**

- Only the successfully parsed `rewritten_text` is stored as the assistant message content, not the raw LLM response
- If response parsing fails (salvage mode or complete failure), the message is NOT appended to history — that turn is treated as stateless, and the next turn starts fresh from the last successful state

### core.rs Changes

`execute_llm_request_with_messages` currently accepts:

- `system_prompts: &[String]` — converted to system/developer messages
- `user_message: &str` — converted to a single user message

It needs to also accept an optional conversation history that gets inserted between the system prompts and the final user message. The simplest approach: add an optional `conversation_history: &[RewriteMessage]` parameter that maps to user/assistant messages in the messages array.

### Pipeline Flow

In `execute_votype_rewrite_prompt`:

1. Capture `session_id` from `current_rewrite_session_id()`
2. Read `REWRITE_CONVERSATION` history (returns None if session mismatch)
3. Build user message (same format as today — document + instruction + term_reference + language)
4. Call LLM with system prompt + history + new user message
5. Parse response, extract `rewritten_text`
6. If parsing succeeded: append user message and normalized `rewritten_text` to history (with session ID check)
7. If parsing failed: do not append — next turn will retry without this failed exchange
8. Return result as today

### Token Budget

No explicit limit. The review window is a short-lived session (typically 5-10 voice rewrites at most). The conversation is cleared when the window closes. Each assistant message stores only the `rewritten_text` (not the full JSON response), keeping history compact.

## Files Changed

| File                                             | Change                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `src-tauri/src/review_window.rs`                 | Add `REWRITE_CONVERSATION` with session ID, public API, clear on hide/show           |
| `src-tauri/src/actions/post_process/pipeline.rs` | `execute_votype_rewrite_prompt` reads/writes conversation history with session guard |
| `src-tauri/src/actions/post_process/core.rs`     | `execute_llm_request_with_messages` accepts optional conversation history            |

## Not Changed

- Frontend (`ReviewWindow.tsx`) — unaware of conversation history
- Prompt files — no modifications needed
- Database — history is memory-only
- Model selection / routing logic — unchanged
