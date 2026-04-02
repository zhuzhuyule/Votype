# P0–P2 Engineering Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor LLM error handling into typed errors, add retry/degradation, pipeline decision logging, and cost dashboard.

**Architecture:** Three phases executed sequentially. P0 (LlmError types) unlocks P1 (retry + degradation + decision log). P2 (cost dashboard) is independent frontend work. All backend changes in `src-tauri/src/actions/post_process/` and `src-tauri/src/managers/`.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), SQLite (storage)

**Important context:**
- `extensions.rs` has its own HTTP implementation that mirrors `core.rs` but does NOT call it. This plan refactors `core.rs` and its direct callers only. Unifying `extensions.rs` is a separate future task.
- `fallback.rs` uses `Result<T, String>` — callers already convert the 4-tuple to Result before passing to fallback. This pattern stays unchanged.

---

## Phase P0: LlmError Type Refactor

### Task 1: Define LlmError and LlmResponse types

**Files:**
- Modify: `src-tauri/src/actions/post_process/core.rs` (top of file)
- Modify: `src-tauri/src/actions/post_process/mod.rs` (re-export)

- [ ] **Step 1: Add type definitions to core.rs**

Add after the existing `use` statements (around line 25):

```rust
/// Structured error type for LLM API calls.
#[derive(Debug, Clone)]
pub enum LlmError {
    /// reqwest client creation failed
    ClientInit {
        provider: String,
        model: String,
        detail: String,
    },
    /// Network-level failure (DNS, connection, timeout)
    Network {
        provider: String,
        model: String,
        url: String,
        detail: String,
    },
    /// HTTP response with non-2xx status
    ApiError {
        provider: String,
        model: String,
        status: u16,
        body: String,
    },
    /// Response body could not be parsed
    ParseError {
        provider: String,
        model: String,
        detail: String,
    },
    /// Apple Intelligence specific error
    AppleIntelligence {
        detail: String,
    },
}

impl LlmError {
    /// Whether this error is worth retrying
    pub fn is_retryable(&self) -> bool {
        match self {
            LlmError::Network { .. } => true,
            LlmError::ApiError { status, .. } => *status == 429 || *status >= 500,
            _ => false,
        }
    }

    /// Suggested retry delay in ms for a given attempt (0-indexed)
    pub fn retry_delay_ms(&self, attempt: u32) -> u64 {
        match self {
            LlmError::ApiError { status: 429, .. } => 1000,
            LlmError::Network { .. } if attempt == 0 => 0,
            LlmError::Network { .. } => 500,
            LlmError::ApiError { status, .. } if *status >= 500 && attempt == 0 => 0,
            LlmError::ApiError { .. } => 500,
            _ => 0,
        }
    }

    /// Error code for overlay-error event
    pub fn error_code(&self) -> &'static str {
        match self {
            LlmError::ClientInit { .. } => "llm_init_failed",
            LlmError::Network { .. } => "llm_network_error",
            LlmError::ApiError { status: 429, .. } => "llm_rate_limited",
            LlmError::ApiError { status, .. } if *status == 401 || *status == 403 => {
                "llm_auth_failed"
            }
            LlmError::ApiError { .. } => "llm_api_error",
            LlmError::ParseError { .. } => "llm_parse_error",
            LlmError::AppleIntelligence { .. } => "apple_intelligence_failed",
        }
    }

    /// Human-readable error message
    pub fn message(&self) -> String {
        match self {
            LlmError::ClientInit { provider, model, detail, .. } => {
                format!("LLM 客户端初始化失败 provider={provider} model={model}: {detail}")
            }
            LlmError::Network { provider, model, url, detail } => {
                format!("LLM 网络请求失败 provider={provider} model={model} url={url}: {detail}")
            }
            LlmError::ApiError { provider, model, status, body } => {
                format!("LLM 请求失败 provider={provider} model={model} status={status}: {body}")
            }
            LlmError::ParseError { provider, model, detail } => {
                format!("LLM 响应解析失败 provider={provider} model={model}: {detail}")
            }
            LlmError::AppleIntelligence { detail } => {
                format!("Apple Intelligence 请求失败: {detail}")
            }
        }
    }
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

/// Successful LLM response
#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub text: String,
    pub token_count: Option<i64>,
}

/// Result type for LLM calls
pub type LlmResult = Result<LlmResponse, LlmError>;
```

- [ ] **Step 2: Add backward-compatible conversion**

Add below the type definitions:

```rust
/// Bridge: convert LlmResult back to the legacy 4-tuple.
/// Use during incremental migration — remove once all callers are migrated.
impl From<LlmResult> for (Option<String>, bool, Option<String>, Option<i64>) {
    fn from(result: LlmResult) -> Self {
        match result {
            Ok(resp) => (Some(resp.text), false, None, resp.token_count),
            Err(e) => (None, true, Some(e.message()), None),
        }
    }
}
```

- [ ] **Step 3: Re-export from mod.rs**

In `src-tauri/src/actions/post_process/mod.rs`, add to the existing `pub(crate) use core::` block:

```rust
pub(crate) use core::{
    build_instruction_message, build_user_message, execute_llm_request,
    resolve_prompt_message_role, LlmError, LlmResponse, LlmResult,
};
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS (types defined but not yet used)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/mod.rs
git commit -m "Define LlmError, LlmResponse, LlmResult types with retry policy and legacy bridge"
```

---

### Task 2: Refactor execute_llm_request_with_messages to return LlmResult

**Files:**
- Modify: `src-tauri/src/actions/post_process/core.rs`

This is the largest single change. The function currently returns `(Option<String>, bool, Option<String>, Option<i64>)` from 11 code paths. We convert it to return `LlmResult` and add a new wrapper that preserves the old signature for callers not yet migrated.

- [ ] **Step 1: Rename the existing function to `execute_llm_request_inner`**

Change the function signature at line 255:

```rust
// OLD:
pub async fn execute_llm_request_with_messages(
    ...
) -> (Option<String>, bool, Option<String>, Option<i64>)

// NEW:
async fn execute_llm_request_inner(
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
) -> LlmResult
```

- [ ] **Step 2: Convert all return points in the function body**

Replace each return point (reference line numbers from the original):

**Apple Intelligence unavailable (line 278-283):**
```rust
// OLD: (None, true, Some("Apple Intelligence 不可用".to_string()), None)
// NEW:
return Err(LlmError::AppleIntelligence {
    detail: "Apple Intelligence 不可用".to_string(),
});
```

**Apple Intelligence success (line 299):**
```rust
// OLD: (Some(result), false, None, None)
// NEW:
return Ok(LlmResponse { text: result, token_count: None });
```

**Apple Intelligence error (line 309-314):**
```rust
// OLD: (None, true, Some(format!("Apple Intelligence 请求失败: {}", err)), None)
// NEW:
return Err(LlmError::AppleIntelligence {
    detail: format!("{}", err),
});
```

**Non-macOS Apple Intelligence (line 319):**
```rust
// OLD: (None, false, None, None)
// This is a "not applicable" case, not an error. Return empty success:
return Ok(LlmResponse { text: String::new(), token_count: None });
```

**Client init failure (line 345-356):**
```rust
// OLD: (None, true, Some(format!("LLM 客户端初始化失败 ...")), None)
// NEW:
return Err(LlmError::ClientInit {
    provider: provider.id.clone(),
    model: model.to_string(),
    detail: format!("{}", e),
});
```

**Empty messages (line 395):**
```rust
// OLD: (None, false, None, None)
// NEW:
return Ok(LlmResponse { text: String::new(), token_count: None });
```

**JSON success (line 691):**
```rust
// OLD: return (Some(text), false, None, token_count);
// NEW:
return Ok(LlmResponse { text, token_count });
```

**JSON parse failure (line 706):**
```rust
// OLD: return (None, true, Some(detail), None);
// NEW:
return Err(LlmError::ParseError {
    provider: provider.id.clone(),
    model: model.to_string(),
    detail: format!("{:?}", e),
});
```

**HTTP non-success status (line 724):**
```rust
// OLD: return (None, true, Some(detail), None);
// NEW:
let status_code = status.as_u16();
return Err(LlmError::ApiError {
    provider: provider.id.clone(),
    model: model.to_string(),
    status: status_code,
    body: error_text,
});
```

**Network error (line 740):**
```rust
// OLD: return (None, true, Some(detail), None);
// NEW:
return Err(LlmError::Network {
    provider: provider.id.clone(),
    model: model.to_string(),
    url: url.clone(),
    detail: format!("{:?}", err),
});
```

**HTTP client build failure (line 757):**
```rust
// OLD: return (None, true, Some(detail), None);
// NEW:
return Err(LlmError::ClientInit {
    provider: provider.id.clone(),
    model: model.to_string(),
    detail: format!("{}", e),
});
```

- [ ] **Step 3: Move overlay-error emission to a helper**

The `execute_llm_request_inner` no longer emits overlay-error (pure function). Add a helper:

```rust
fn emit_llm_error(app_handle: &AppHandle, error: &LlmError) {
    let _ = app_handle.emit(
        "overlay-error",
        serde_json::json!({
            "code": error.error_code(),
            "message": error.message(),
        }),
    );
}
```

- [ ] **Step 4: Add the public wrapper that preserves legacy behavior**

```rust
/// Public entry point — returns legacy tuple and emits overlay-error on failure.
/// Callers should migrate to `execute_llm_request_typed()` over time.
pub async fn execute_llm_request_with_messages(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    app_name: Option<String>,
    window_title: Option<String>,
    match_pattern: Option<String>,
    match_type: Option<crate::settings::TitleMatchType>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> (Option<String>, bool, Option<String>, Option<i64>) {
    let result = execute_llm_request_inner(
        app_handle, settings, provider, model, cached_model_id,
        system_prompts, user_message, conversation_history,
        app_name, window_title, match_pattern, match_type,
        override_extra_params,
    )
    .await;

    if let Err(ref e) = result {
        log::error!("LLM request failed: {}", e);
        emit_llm_error(app_handle, e);
    }

    result.into()
}
```

- [ ] **Step 5: Add typed public API**

```rust
/// Typed entry point — returns LlmResult. Caller is responsible for error handling.
pub async fn execute_llm_request_typed(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> LlmResult {
    execute_llm_request_inner(
        app_handle, settings, provider, model, cached_model_id,
        system_prompts, user_message, conversation_history,
        None, None, None, None,
        override_extra_params,
    )
    .await
}
```

- [ ] **Step 6: Update execute_llm_request to delegate**

The simple `execute_llm_request` wrapper (line 223-253) should continue delegating to `execute_llm_request_with_messages` — no change needed since it already calls the public wrapper.

- [ ] **Step 7: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS — all existing callers use the unchanged legacy wrapper.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs
git commit -m "Refactor core LLM execution to LlmResult internally with legacy bridge"
```

---

## Phase P1a: Retry with Backoff

### Task 3: Add retry wrapper

**Files:**
- Modify: `src-tauri/src/actions/post_process/core.rs`

- [ ] **Step 1: Add retry wrapper function**

Add above `execute_llm_request_typed`:

```rust
const MAX_RETRIES: u32 = 2;

/// Execute with automatic retry for transient failures.
/// Total retry budget ≤ 1.5s to keep voice input responsive.
pub async fn execute_llm_request_with_retry(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    conversation_history: Option<&[crate::review_window::RewriteMessage]>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> LlmResult {
    let mut last_error: Option<LlmError> = None;

    for attempt in 0..=MAX_RETRIES {
        let result = execute_llm_request_inner(
            app_handle, settings, provider, model, cached_model_id,
            system_prompts, user_message, conversation_history,
            None, None, None, None,
            override_extra_params,
        )
        .await;

        match result {
            Ok(resp) => return Ok(resp),
            Err(ref e) if e.is_retryable() && attempt < MAX_RETRIES => {
                let delay = e.retry_delay_ms(attempt);
                log::warn!(
                    "[LLM] Retryable error on attempt {}/{}: {} (delay={}ms)",
                    attempt + 1,
                    MAX_RETRIES + 1,
                    e,
                    delay,
                );
                if delay > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                }
                last_error = Some(result.unwrap_err());
            }
            Err(e) => return Err(e),
        }
    }

    Err(last_error.expect("retry loop must set last_error"))
}
```

- [ ] **Step 2: Re-export from mod.rs**

Add to the `pub(crate) use core::` block:

```rust
pub(crate) use core::{
    build_instruction_message, build_user_message, execute_llm_request,
    execute_llm_request_typed, execute_llm_request_with_retry,
    resolve_prompt_message_role, LlmError, LlmResponse, LlmResult,
};
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/mod.rs
git commit -m "Add execute_llm_request_with_retry with transient failure recovery"
```

---

## Phase P1b: Degradation UX

### Task 4: Frontend error code mapping

**Files:**
- Modify: `src/overlay/RecordingOverlay.tsx`

- [ ] **Step 1: Extend the error code map**

Find the `errorMap` object (around line 170) and add new codes:

```typescript
const errorMap: Record<string, string> = {
  transcription_failed_saved: "overlay.error.transcriptionFailedSaved",
  llm_init_failed: "overlay.error.llmInitFailed",
  llm_request_failed: "overlay.error.llmRequestFailed",
  // New typed error codes
  llm_network_error: "overlay.error.llmNetworkError",
  llm_rate_limited: "overlay.error.llmRateLimited",
  llm_auth_failed: "overlay.error.llmAuthFailed",
  llm_api_error: "overlay.error.llmApiError",
  llm_parse_error: "overlay.error.llmParseError",
  apple_intelligence_unavailable:
    "overlay.error.appleIntelligenceUnavailable",
  apple_intelligence_failed: "overlay.error.appleIntelligenceFailed",
};
```

- [ ] **Step 2: Add i18n translations**

Find the i18n files (likely `src/i18n/` or `public/locales/`). Add Chinese translations:

```json
{
  "overlay.error.llmNetworkError": "网络连接失败，正在重试...",
  "overlay.error.llmRateLimited": "API 请求频率过高，请稍后重试",
  "overlay.error.llmAuthFailed": "API 密钥无效，请检查设置",
  "overlay.error.llmApiError": "API 服务异常",
  "overlay.error.llmParseError": "模型响应解析失败"
}
```

And English:

```json
{
  "overlay.error.llmNetworkError": "Network error, retrying...",
  "overlay.error.llmRateLimited": "Rate limited, please wait",
  "overlay.error.llmAuthFailed": "Invalid API key, check settings",
  "overlay.error.llmApiError": "API service error",
  "overlay.error.llmParseError": "Failed to parse model response"
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `bun build`

- [ ] **Step 4: Commit**

```bash
git add src/overlay/RecordingOverlay.tsx src/i18n/
git commit -m "Add typed LLM error codes to overlay with i18n messages"
```

---

## Phase P1c: Pipeline Decision Log

### Task 5: Create pipeline_decisions table

**Files:**
- Modify: `src-tauri/src/managers/history.rs` (migration)

- [ ] **Step 1: Add migration 40**

After the existing Migration 39, add:

```rust
// Migration 40: Pipeline decision log for routing observability
M::up(
    "CREATE TABLE IF NOT EXISTS pipeline_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        history_id INTEGER,
        timestamp TEXT NOT NULL,
        input_length INTEGER NOT NULL,
        history_hit INTEGER NOT NULL DEFAULT 0,
        history_elapsed_ms INTEGER,
        intent_action TEXT,
        intent_needs_hotword INTEGER,
        intent_language TEXT,
        intent_model_id TEXT,
        intent_provider_id TEXT,
        intent_elapsed_ms INTEGER,
        intent_overridden INTEGER DEFAULT 0,
        intent_override_reason TEXT,
        model_selection TEXT,
        selected_model_id TEXT,
        is_multi_model INTEGER DEFAULT 0,
        result_type TEXT NOT NULL,
        total_elapsed_ms INTEGER NOT NULL,
        error_type TEXT,
        error_detail TEXT,
        app_name TEXT,
        smart_routing_enabled INTEGER,
        bypass_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pd_history ON pipeline_decisions(history_id);
    CREATE INDEX IF NOT EXISTS idx_pd_timestamp ON pipeline_decisions(timestamp);"
),
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "Add pipeline_decisions table for routing observability (Migration 40)"
```

---

### Task 6: Pipeline decision logger

**Files:**
- Create: `src-tauri/src/managers/pipeline_log.rs`
- Modify: `src-tauri/src/managers/mod.rs`

- [ ] **Step 1: Create the pipeline log manager**

```rust
use log::error;
use rusqlite::{params, Connection};
use std::path::PathBuf;

/// Accumulator for pipeline step data, written at the end of unified_post_process.
#[derive(Debug, Default)]
pub struct PipelineDecisionRecord {
    pub history_id: Option<i64>,
    pub input_length: u32,

    // Step 1
    pub history_hit: bool,
    pub history_elapsed_ms: Option<u64>,

    // Step 2
    pub intent_action: Option<String>,
    pub intent_needs_hotword: Option<bool>,
    pub intent_language: Option<String>,
    pub intent_model_id: Option<String>,
    pub intent_provider_id: Option<String>,
    pub intent_elapsed_ms: Option<u64>,
    pub intent_overridden: bool,
    pub intent_override_reason: Option<String>,

    // Step 3
    pub model_selection: Option<String>,
    pub selected_model_id: Option<String>,
    pub is_multi_model: bool,

    // Step 4
    pub result_type: String,
    pub total_elapsed_ms: u64,
    pub error_type: Option<String>,
    pub error_detail: Option<String>,

    // Context
    pub app_name: Option<String>,
    pub smart_routing_enabled: bool,
    pub bypass_reason: Option<String>,
}

pub struct PipelineLogManager {
    db_path: PathBuf,
}

impl PipelineLogManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    fn get_connection(&self) -> Result<Connection, rusqlite::Error> {
        let conn = Connection::open(&self.db_path)?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        Ok(conn)
    }

    pub fn log_decision(&self, record: &PipelineDecisionRecord) {
        if let Err(e) = self.log_decision_inner(record) {
            error!("[PipelineLog] Failed to log decision: {}", e);
        }
    }

    fn log_decision_inner(&self, r: &PipelineDecisionRecord) -> Result<(), rusqlite::Error> {
        let conn = self.get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO pipeline_decisions (
                history_id, timestamp, input_length,
                history_hit, history_elapsed_ms,
                intent_action, intent_needs_hotword, intent_language,
                intent_model_id, intent_provider_id, intent_elapsed_ms,
                intent_overridden, intent_override_reason,
                model_selection, selected_model_id, is_multi_model,
                result_type, total_elapsed_ms, error_type, error_detail,
                app_name, smart_routing_enabled, bypass_reason
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                ?21, ?22, ?23
            )",
            params![
                r.history_id,
                now,
                r.input_length,
                r.history_hit,
                r.history_elapsed_ms,
                r.intent_action,
                r.intent_needs_hotword,
                r.intent_language,
                r.intent_model_id,
                r.intent_provider_id,
                r.intent_elapsed_ms,
                r.intent_overridden,
                r.intent_override_reason,
                r.model_selection,
                r.selected_model_id,
                r.is_multi_model,
                r.result_type,
                r.total_elapsed_ms,
                r.error_type,
                r.error_detail,
                r.app_name,
                r.smart_routing_enabled,
                r.bypass_reason,
            ],
        )?;
        Ok(())
    }
}
```

- [ ] **Step 2: Register in managers/mod.rs**

Add to `src-tauri/src/managers/mod.rs`:

```rust
pub mod pipeline_log;
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/managers/pipeline_log.rs src-tauri/src/managers/mod.rs
git commit -m "Add PipelineLogManager for routing decision observability"
```

---

### Task 7: Instrument unified_post_process with decision logging

**Files:**
- Modify: `src-tauri/src/actions/post_process/pipeline.rs`

- [ ] **Step 1: Add timing and accumulator at pipeline entry**

At the top of `unified_post_process()`, after the gate checks (around line 47), add:

```rust
let pipeline_start = std::time::Instant::now();
let mut decision = crate::managers::pipeline_log::PipelineDecisionRecord {
    input_length: char_count,
    app_name: app_name.clone(),
    smart_routing_enabled,
    history_id,
    ..Default::default()
};
```

- [ ] **Step 2: Instrument Step 1 (History lookup)**

Around the history lookup (line 73-97), wrap with timing:

```rust
let history_start = std::time::Instant::now();
// ... existing history lookup code ...
decision.history_elapsed_ms = Some(history_start.elapsed().as_millis() as u64);
```

On cache hit (before the `return PipelineResult::Cached`):
```rust
decision.history_hit = true;
decision.result_type = "Cached".to_string();
decision.total_elapsed_ms = pipeline_start.elapsed().as_millis() as u64;
log_pipeline_decision(app_handle, &decision);
```

- [ ] **Step 3: Instrument Step 2 (Intent analysis)**

After the intent decision is resolved (around line 117-170), record:

```rust
if let Some(ref d) = intent_decision {
    decision.intent_action = Some(format!("{:?}", d.action));
    decision.intent_needs_hotword = Some(d.needs_hotword);
    decision.intent_language = d.language.clone();
    decision.intent_model_id = Some(d.model_id.clone());
    decision.intent_provider_id = Some(d.provider_id.clone());
    decision.intent_elapsed_ms = Some(d.duration_ms);
}
```

On PassThrough return (before `return PipelineResult::PassThrough`):
```rust
decision.result_type = "PassThrough".to_string();
decision.total_elapsed_ms = pipeline_start.elapsed().as_millis() as u64;
log_pipeline_decision(app_handle, &decision);
```

On repetition override:
```rust
decision.intent_overridden = true;
decision.intent_override_reason = Some("repetition_pattern".to_string());
```

- [ ] **Step 4: Instrument Step 3/4 (Model selection + execution)**

Before each `return PipelineResult::SingleModel` (LitePolish path):
```rust
decision.model_selection = Some("lite".to_string());
decision.selected_model_id = Some(result_model.clone());
decision.result_type = "SingleModel".to_string();
decision.total_elapsed_ms = pipeline_start.elapsed().as_millis() as u64;
if err { decision.error_detail = error_message.clone(); }
log_pipeline_decision(app_handle, &decision);
```

Before `return PipelineResult::MultiModel`:
```rust
decision.model_selection = Some("multi".to_string());
decision.is_multi_model = true;
decision.result_type = "MultiModel".to_string();
decision.total_elapsed_ms = pipeline_start.elapsed().as_millis() as u64;
log_pipeline_decision(app_handle, &decision);
```

Before the final `PipelineResult::SingleModel` (FullPolish path):
```rust
decision.model_selection = Some("full".to_string());
decision.result_type = "SingleModel".to_string();
decision.total_elapsed_ms = pipeline_start.elapsed().as_millis() as u64;
if err { decision.error_detail = error_message.clone(); }
log_pipeline_decision(app_handle, &decision);
```

On Skipped returns, set `decision.bypass_reason` accordingly:
```rust
decision.result_type = "Skipped".to_string();
decision.bypass_reason = Some("post_process_disabled".to_string()); // or appropriate reason
```

- [ ] **Step 5: Add helper function at bottom of pipeline.rs**

```rust
fn log_pipeline_decision(
    app_handle: &AppHandle,
    record: &crate::managers::pipeline_log::PipelineDecisionRecord,
) {
    if let Some(manager) = app_handle
        .try_state::<std::sync::Arc<crate::managers::pipeline_log::PipelineLogManager>>()
    {
        manager.log_decision(record);
    }
}
```

- [ ] **Step 6: Register PipelineLogManager in app state**

Find where `LlmMetricsManager` is registered (likely in `src-tauri/src/lib.rs` or `main.rs`) and add alongside it:

```rust
app.manage(std::sync::Arc::new(
    crate::managers::pipeline_log::PipelineLogManager::new(db_path.clone()),
));
```

- [ ] **Step 7: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/lib.rs
git commit -m "Instrument unified pipeline with decision logging at all step boundaries"
```

---

## Phase P2: Cost Dashboard

### Task 8: Add token cost display to Dashboard

**Files:**
- Modify: `src/components/settings/dashboard/Dashboard.tsx`

The Dashboard already fetches `totalTokens` via `get_llm_usage_stats` but doesn't display it. This task surfaces token usage in the existing stats cards.

- [ ] **Step 1: Add token stats card**

Find the summary cards section in Dashboard.tsx (where `entryCount`, `charCount`, etc. are displayed). Add a new card for tokens:

```typescript
// Add to the stats cards grid, after the existing LLM calls card
<StatCard
  label={t("dashboard.totalTokens")}
  value={formatNumber(summary.totalTokens)}
  trend={calculateTrend(summary.totalTokens, prevSummary?.totalTokens)}
  icon={<TokenIcon />}
/>
```

If `StatCard` doesn't exist as a separate component, follow the exact pattern used for the existing cards (entry count, duration, chars, LLM calls).

- [ ] **Step 2: Add i18n translations**

```json
{
  "dashboard.totalTokens": "Token 用量",
  "dashboard.estimatedCost": "估算费用"
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `bun build`

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/dashboard/ src/i18n/
git commit -m "Surface token usage in dashboard stats cards"
```

---

### Task 9: Update engineering plan status

**Files:**
- Modify: `docs/superpowers/plans/2026-04-02-engineering-improvements.md`

- [ ] **Step 1: Mark all completed items in the Progress Tracker table**

Update the status column for items 1.1, 1.2, 2.1, 2.2, 4.4 to **DONE**.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-04-02-engineering-improvements.md
git commit -m "Update engineering improvements plan: all P0-P2 items complete"
```

---

## Execution Dependencies

```
Task 1 (LlmError types)
  └→ Task 2 (Refactor core.rs)
       ├→ Task 3 (Retry wrapper)     ← P1a
       └→ Task 4 (Frontend errors)   ← P1b (independent of Task 3)

Task 5 (Decision table)
  └→ Task 6 (Log manager)
       └→ Task 7 (Instrument pipeline) ← P1c

Task 8 (Cost dashboard)              ← P2 (independent)
Task 9 (Plan update)                 ← After all
```

Tasks 1→2→3 are sequential (P0→P1a).
Tasks 4, 5→6→7, and 8 can run in parallel after Task 2.
