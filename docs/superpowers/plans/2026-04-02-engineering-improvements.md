# Votype Pipeline Engineering Improvements Plan

> Reference: Claude Code architecture deep-dive (ai-agent-deep-dive-v2.pdf)
> Date: 2026-04-02
> Status: Complete (all P0/P1/P2 items done)

## Context

Based on analysis of Claude Code's engineering patterns and Votype's current codebase,
this plan identifies concrete improvements across error handling, observability, resilience,
context awareness, and quality feedback. Each item has been validated against actual code
to assess feasibility and impact.

---

## Current State Assessment

### Strengths (no changes needed)

| Area | Evidence |
|------|----------|
| Pipeline structure | 4-step routing with clear separation (pipeline.rs ~700 lines) |
| Multi-model execution | FuturesUnordered parallel execution, 3 strategies (race/lazy/manual) |
| Metrics collection | `llm_call_log` + `llm_call_stats` with model/provider/call_type/tokens/speed/error |
| Fallback chain | `fallback.rs` with serial/race/staggered strategies (537 lines) |
| App-context threading | `app_name` fully piped from entry → PromptBuilder → reference_resolver → LLM |
| Skill references | Convention-based resolution: `_always.md` / `{app_name}.md` / `{app_category}.md` |
| Review feedback basics | `post_process_rejected`, `learnFromEdit`, `multi_model_manual_pick_counts` |

### Gaps (this plan addresses)

| Gap | Impact | Evidence |
|-----|--------|----------|
| Untyped error returns | Cannot distinguish error types for smart recovery | Tuple `(Option<String>, bool, Option<String>, Option<i64>)` in all 12+ return paths |
| No retry for transient failures | Rate limit or network blip = immediate failure | Zero retry logic in entire post_process/ |
| No pipeline decision log | Cannot debug routing decisions or measure quality | Only `DEBUG_LOG_ROUTING` flag for console |
| No session context | Consecutive inputs treated independently | No tracking outside review window rewrite |
| No cost visibility | Users cannot evaluate multi-model cost-benefit | `total_tokens` exists but no cost calculation |
| Incomplete feedback loop | Edit distance, candidate selection reasons not stored | Only binary rejected/accepted |
| No scenario-aware prompting | Same prompt tone for code editor and chat app | `app_name` threaded but not used for style |

---

## Phase 1: Error Types & Pipeline Decision Log

> Goal: Make the system debuggable and ready for smart recovery.
> Estimated scope: core.rs, pipeline.rs, routing.rs, extensions.rs, history.rs migration

### 1.1 Structured LLM Error Type

**Current:** All LLM errors return `(None, true, Some(error_string), None)` with same
error code `"llm_request_failed"` for 4 distinct failure modes.

**Change:** Define `LlmError` enum in `core.rs`:

```rust
pub enum LlmError {
    /// reqwest::Client::builder().build() failed
    ClientInit { provider: String, model: String, detail: String },
    /// client.post().send().await failed (DNS, connection, timeout)
    Network { provider: String, model: String, url: String, detail: String },
    /// HTTP response status != 2xx
    ApiError { provider: String, model: String, status: u16, body: String },
    /// resp.json() failed or response structure unexpected
    ParseError { provider: String, model: String, detail: String },
    /// Apple Intelligence specific
    AppleIntelligence { detail: String },
}

pub struct LlmResponse {
    pub text: String,
    pub token_count: Option<i64>,
}

pub type LlmResult = Result<LlmResponse, LlmError>;
```

**Affected code paths** (execute_llm_request_with_messages, 12 return sites):
- Line 299: Apple Intelligence success → `Ok(LlmResponse { text, token_count: None })`
- Line 309: Apple Intelligence error → `Err(LlmError::AppleIntelligence { .. })`
- Line 345: Client init → `Err(LlmError::ClientInit { .. })`
- Line 675: JSON success → `Ok(LlmResponse { text, token_count })`
- Line 690: JSON parse → `Err(LlmError::ParseError { .. })`
- Line 708: HTTP error → `Err(LlmError::ApiError { status, body, .. })`
- Line 724: Network error → `Err(LlmError::Network { .. })`
- Line 741: Client build → `Err(LlmError::ClientInit { .. })`

**Callers to update:**
- `pipeline.rs` lines 1948-2046: Main single-model execution + fallback
- `routing.rs` lines 100-143: Smart routing intent model
- `routing.rs` lines 708-754: Default polish execution
- `extensions.rs` line 626: `execute_single_model_post_process` (currently 3-tuple variant)

**overlay-error emission:** Keep in `core.rs` but derive error code from enum variant:
- `LlmError::Network { .. }` → `"llm_network_error"`
- `LlmError::ApiError { status: 429, .. }` → `"llm_rate_limited"`
- `LlmError::ApiError { status: 401, .. }` → `"llm_auth_failed"`
- `LlmError::ApiError { .. }` → `"llm_api_error"`
- etc.

**Migration path:** Can be done incrementally:
1. Define `LlmError` and `LlmResult` types
2. Convert `execute_llm_request_with_messages` return type
3. Add `impl From<LlmResult> for (Option<String>, bool, Option<String>, Option<i64>)` as bridge
4. Migrate callers one by one, removing bridge uses

### 1.2 Pipeline Decision Log

**New SQLite table** via migration:

```sql
CREATE TABLE pipeline_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    history_id INTEGER,
    timestamp TEXT NOT NULL,
    input_text TEXT NOT NULL,
    input_length INTEGER NOT NULL,

    -- Step 1: History
    history_hit INTEGER NOT NULL DEFAULT 0,
    history_elapsed_ms INTEGER,

    -- Step 2: Intent
    intent_action TEXT,
    intent_needs_hotword INTEGER,
    intent_language TEXT,
    intent_model_id TEXT,
    intent_elapsed_ms INTEGER,
    intent_overridden INTEGER DEFAULT 0,
    intent_override_reason TEXT,

    -- Step 3: Model selection
    model_selection TEXT,
    selected_model_id TEXT,
    is_multi_model INTEGER DEFAULT 0,

    -- Step 4: Execution
    result_type TEXT NOT NULL,
    total_elapsed_ms INTEGER NOT NULL,
    error_type TEXT,
    error_detail TEXT,

    -- Context
    app_name TEXT,
    smart_routing_enabled INTEGER,
    bypass_reason TEXT
);

CREATE INDEX idx_pd_history ON pipeline_decisions(history_id);
CREATE INDEX idx_pd_timestamp ON pipeline_decisions(timestamp);
CREATE INDEX idx_pd_result ON pipeline_decisions(result_type);
```

**Write point:** End of `unified_post_process()` in pipeline.rs, single insert with all
accumulated step data. Use `Instant::now()` at each step boundary for elapsed_ms.

**Read points:**
- New Tauri command `get_pipeline_decision(history_id)` for Dashboard detail view
- New Tauri command `get_pipeline_stats(date_range)` for aggregate analysis

**Dashboard integration:** History entry detail → expandable "Pipeline Decision" panel
showing the full routing path with timing.

### 1.3 History Cache Index

**Finding:** `find_cached_post_process_result` does exact string match on
`transcription_text` with no index. Performance degrades at 10k+ entries.

**Fix:** Add migration:

```sql
CREATE INDEX idx_th_cache_lookup ON transcription_history(
    transcription_text, post_process_rejected, deleted
);
```

---

## Phase 2: Resilience

> Goal: Make every failure recoverable. No user should ever be "stuck".
> Estimated scope: core.rs, pipeline.rs

### 2.1 Retry for Transient Failures

**Scope:** Add retry logic inside `execute_llm_request_with_messages` in core.rs,
transparent to all callers.

**Policy (based on LlmError type):**

| Error Type | Retry? | Strategy |
|-----------|--------|----------|
| `Network` | Yes | 1 immediate retry + 1 after 500ms |
| `ApiError { status: 429 }` | Yes | 1 retry after `retry_after` header or 1000ms |
| `ApiError { status: 5xx }` | Yes | 1 immediate retry |
| `ApiError { status: 4xx }` | No | Immediate fail (client error) |
| `ParseError` | No | Immediate fail (model output issue) |
| `ClientInit` | No | Immediate fail (config issue) |

**Implementation:**

```rust
const MAX_RETRIES: u32 = 2;

async fn execute_with_retry(...) -> LlmResult {
    let mut last_error = None;
    for attempt in 0..=MAX_RETRIES {
        match execute_llm_request_inner(...).await {
            Ok(resp) => return Ok(resp),
            Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                let delay = e.retry_delay(attempt);
                if delay > 0 { tokio::time::sleep(Duration::from_millis(delay)).await; }
                last_error = Some(e);
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap())
}
```

**Constraint:** Total retry time budget ≤ 1.5s. Voice input is latency-sensitive;
longer than that, should fall through to existing fallback chain.

### 2.2 Degradation Policy

**Current behavior (verified):**
- Intent model fails → defaults to FullPolish (routing.rs line 140)
- Primary polish fails → tries fallback if configured (pipeline.rs line 1983)
- All multi-model models fail → returns `auto_selected_id: None` (extensions.rs line 569)
- No fallback configured → returns original text with error flag

**Gaps to fill:**
1. **All-model-fail in multi-model → no user notification.** Frontend handles
   `auto_selected_id: None` but no toast/notification tells user what happened.
2. **Auth failure (401) not distinguished from transient errors.** User keeps getting
   generic "LLM request failed" without knowing their API key is invalid.
3. **Rate limit (429) not surfaced.** User doesn't know they hit a quota.

**Changes:**
- Frontend overlay: Map new error codes to specific user-facing messages:
  - `"llm_rate_limited"` → "API rate limit reached, retrying..." or "请稍后重试"
  - `"llm_auth_failed"` → "API key invalid" with link to settings
  - `"llm_network_error"` → "Network error, retrying..."
- Multi-model all-fail: Emit `"multi-post-process-all-failed"` event with error summary
- Review window: Show error banner when all candidates errored

---

## Phase 3: Context & Quality

> Goal: Make output quality visibly better through context awareness.
> Estimated scope: New RecentContext module, prompt_builder.rs, prompt templates

### 3.1 Session Context Window

**Finding:** PromptBuilder already has `history_entries: Vec<String>` field (line 178)
and a `[history-hints]` section in user message (line 261). This is currently used for
historical correction pairs, but the injection point is ready.

**New module:** `src-tauri/src/managers/recent_context.rs`

```rust
use std::collections::VecDeque;
use std::time::Instant;

pub struct RecentContext {
    entries: VecDeque<ContextEntry>,
    max_entries: usize,        // default: 5
    window_duration_ms: u64,   // default: 300_000 (5 minutes)
    max_total_chars: usize,    // default: 500 (token budget)
}

struct ContextEntry {
    text: String,
    timestamp: Instant,
    app_name: String,
}

impl RecentContext {
    /// Add a completed transcription result to context
    pub fn push(&mut self, text: &str, app_name: &str) {
        self.evict_expired();
        self.entries.push_back(ContextEntry {
            text: text.to_string(),
            timestamp: Instant::now(),
            app_name: app_name.to_string(),
        });
        while self.entries.len() > self.max_entries {
            self.entries.pop_front();
        }
    }

    /// Get recent context for same app, within time window and char budget
    pub fn get_for_app(&self, app_name: &str) -> Vec<String> {
        let mut result = Vec::new();
        let mut total_chars = 0;
        for entry in self.entries.iter().rev() {
            if entry.app_name != app_name { continue; }
            if entry.timestamp.elapsed().as_millis() > self.window_duration_ms as u128 { break; }
            if total_chars + entry.text.len() > self.max_total_chars { break; }
            total_chars += entry.text.len();
            result.push(entry.text.clone());
        }
        result.reverse();
        result
    }
}
```

**Integration in pipeline.rs:**
1. After Step 4 result, call `recent_context.push(final_text, app_name)`
2. Before Step 4 execution, call `recent_context.get_for_app(app_name)`
3. Pass to PromptBuilder as a new `session_context` field (separate from history_entries)

**Prompt injection:** New `[session-context]` section in user message:

```
[session-context]
(以下为同一应用内最近的输入，仅供理解当前语境参考)
1. "我们下周三开会讨论新方案"
2. "参加的人有小李和小王"
```

**Prompt cache impact:** This section is in the user message (dynamic part), not system
prompt. No impact on system prompt cache prefix.

**State ownership:** `Lazy<Mutex<RecentContext>>` in pipeline module scope. Cleared on
app_name change or time window expiry. No persistence needed (session-scoped).

### 3.2 Application Scenario Hint

**Finding:** `app_name` is already threaded through to PromptBuilder. `{{app-name}}`
and `{{app-category}}` template variables already exist (prompt_builder.rs lines 447-458).
Reference resolver already loads app-specific files.

**Change needed:** Add `{{scenario-hint}}` variable substitution in prompt_builder.rs:

```rust
// In build(), after existing app-name substitution
if let Some(app) = self.app_name {
    let hint = scenario_hint_for_app(app);
    skill_prompt = skill_prompt.replace("{{scenario-hint}}", &hint);
} else {
    skill_prompt = skill_prompt.replace("{{scenario-hint}}", "");
}
```

**Hint mapping function:**

```rust
fn scenario_hint_for_app(app_name: &str) -> String {
    let category = crate::app_category::from_app_name(app_name);
    match category.as_str() {
        "CodeEditor" | "Terminal" | "IDE" =>
            "当前为代码/终端环境：保留技术术语、代码片段和命令原样，只修正自然语言部分。",
        "InstantMessaging" | "SocialMedia" =>
            "当前为即时通讯环境：保持口语化，不过度正式化，简洁为主。",
        "Email" =>
            "当前为邮件环境：使用书面语，注意礼貌用语和结构。",
        "Browser" | "TextEditor" | "Notes" =>
            "当前为文档/笔记环境：注重条理性和可读性。",
        _ => "",
    }.to_string()
}
```

**Prompt template update:** In `system_lite_polish.md` and default Polish skill, add:

```
{{scenario-hint}}
```

**Effort:** Extremely small. 1 function + 1 template variable + prompt file edit.
Impact is immediate and user-visible.

### 3.3 Extended Feedback Tracking

**Finding:** Review window already sends rich data back:
- `confirm_reviewed_transcription`: text, historyId, cachedModelId, learnFromEdit, originalTextForLearning
- `cancel_transcription_review`: text, historyId
- `post_process_rejected` field exists in DB
- `multi_model_manual_pick_counts` tracked in settings

**What's missing:** The edit distance between original and user-modified text,
and the reason for candidate selection.

**Changes:**

1. **New fields in `transcription_history`** (migration):

```sql
ALTER TABLE transcription_history ADD COLUMN review_action TEXT;
ALTER TABLE transcription_history ADD COLUMN review_edit_distance INTEGER;
ALTER TABLE transcription_history ADD COLUMN review_selected_candidate TEXT;
ALTER TABLE transcription_history ADD COLUMN review_elapsed_ms INTEGER;
```

2. **Frontend timing:** Record `Date.now()` when review window opens, send elapsed_ms
on confirm/cancel.

3. **Backend update in review_cmds.rs:**
   - `confirm_reviewed_transcription`: Compute Levenshtein distance between
     `original_text_for_learning` and final `text`. Write `review_action = "accept"` or
     `"edit_accept"` (if learnFromEdit), `review_edit_distance`, `review_selected_candidate`.
   - `cancel_transcription_review`: Write `review_action = "reject"`.

4. **Dashboard aggregate:** New query to show acceptance rate, average edit distance,
most-selected model in multi-model mode.

---

## Phase 4: Optimization

> Goal: Reduce latency and API cost.
> Prerequisite: Phases 1-3 data to guide decisions.

### 4.1 Prompt Cache Prefix Optimization

**Finding:** Multi-model execution in extensions.rs already de-duplicates prompts by
`prompt_id` (pre-resolves all unique prompts into HashMap). Shared hotword injection and
history context are built once.

**Optimization:** Ensure system prompt structure follows CC's boundary pattern:

```
[Static prefix - identical across all models and calls]
  - Role definition
  - General behavior rules
  - Output format rules

──── DYNAMIC BOUNDARY ────

[Dynamic suffix - varies per call]
  - {{scenario-hint}}
  - {{app-name}}, {{app-category}}, {{window-title}}
  - Resolved skill references
```

**Action:** Audit all prompt templates to ensure static content is at the top.
No code change needed — just prompt file reorganization.

### 4.2 History Cache Acceleration

Beyond the index added in Phase 1.3, consider:

**Bloom filter pre-check:** Keep an in-memory Bloom filter of all cached transcription
texts. If Bloom filter says "definitely not in cache", skip the DB query entirely.
False positive rate ~1% is acceptable (just means an unnecessary DB query).

**Cost-benefit:** Only valuable at 50k+ history entries. Skip for now, revisit when
pipeline_decisions data shows cache lookup time is a real bottleneck.

### 4.3 Pipeline Step 1+2 Parallel Execution

**Finding (REVISED):** After code analysis, this is **NOT viable** in the current
architecture. Step 1 (history lookup) takes ~1-5ms and short-circuits the entire
pipeline on hit. Parallelizing it with Step 2 (intent LLM call, ~200ms) would add
code complexity for negligible gain.

**Alternative:** If pipeline_decisions data shows that Step 2 is a consistent bottleneck,
consider **speculative intent caching** — cache intent decisions for similar texts
(fuzzy match by edit distance) to skip the LLM call entirely.

### 4.4 Cost Dashboard

**Finding:** `llm_call_log` already has `total_tokens`, `model_id`, `provider`,
`call_type`. Cost can be calculated client-side.

**Frontend implementation:**
1. Model pricing table as JSON config (editable in settings)
2. New Dashboard panel: daily/weekly/monthly cost breakdown
3. Per-call-type breakdown (intent vs polish vs multi-model)
4. Comparison: "Multi-model costs X% more than single-model"

**Backend:** No change needed. Frontend calculates from existing data.

---

## Implementation Order & Dependencies

```
Phase 1.3 History Index ──────────────────────── (standalone, immediate)
Phase 3.2 Scenario Hint ─────────────────────── (standalone, immediate, high impact)

Phase 1.1 LlmError Type ─┬─ Phase 2.1 Retry ──── (retry logic depends on error types)
                          └─ Phase 2.2 Degradation (error-specific UI depends on types)

Phase 1.2 Pipeline Decision Log ──────────────── (standalone, but benefits from 1.1)

Phase 3.1 Session Context ───────────────────── (standalone)
Phase 3.3 Feedback Tracking ─────────────────── (standalone, extends existing fields)

Phase 4.1 Prompt Cache ──────────────────────── (after 3.2, prompt structure stabilized)
Phase 4.4 Cost Dashboard ───────────────────── (standalone frontend, any time)
```

**Quick wins (< 1 hour each, do first):**
1. Phase 1.3: History cache index (1 SQL migration)
2. Phase 3.2: Scenario hint (1 function + 1 template variable)

**Core infrastructure (do together):**
3. Phase 1.1: LlmError type (refactor core.rs, update callers)
4. Phase 1.2: Pipeline decision log (1 new table + pipeline.rs instrumentation)

**Resilience (depends on 1.1):**
5. Phase 2.1: Retry with backoff (core.rs wrapper)
6. Phase 2.2: Degradation UX (frontend error code mapping)

**Quality features (independent, can parallelize):**
7. Phase 3.1: Session context window (new module + PromptBuilder integration)
8. Phase 3.3: Feedback tracking (migration + review_cmds.rs update)

**Optimization (data-driven, do last):**
9. Phase 4.1: Prompt cache prefix audit
10. Phase 4.4: Cost dashboard

---

## Scope Exclusions

The following items from initial brainstorming are **deferred** after code analysis:

| Item | Reason |
|------|--------|
| Review window state consolidation | 9 Mutex globals work correctly; consolidation is cosmetic, risk of regression outweighs benefit |
| Pipeline Step 1+2 parallelization | Step 1 is ~1-5ms; parallelizing adds complexity for no measurable gain |
| Input text compression (snip/micro/auto) | Votype inputs are typically short (< 200 chars); compression unnecessary |
| Prompt A/B testing | Needs larger user base to be statistically meaningful |
| Verification agent pattern | Multi-model comparison already serves similar purpose |
| Plugin/Hook extension system | No current need for third-party extensions |
| Bloom filter for history cache | Premature; add index first, measure before optimizing further |

---

## Progress Tracker

| ID | Item | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 1.1 | LlmError 类型重构 | **DONE** | P0 | LlmError enum + LlmResult + execute_llm_request_inner + legacy bridge |
| 1.2 | Pipeline Decision Log | **DONE** | P1 | Migration 40 + PipelineLogManager + pipeline.rs 11 个返回点全部插桩 |
| 1.3 | History 缓存索引 | **DONE** | — | Migration 38: idx_th_cache_lookup 复合索引 |
| 2.1 | Retry with Backoff | **DONE** | P1 | execute_llm_request_with_retry, MAX_RETRIES=2, budget ≤1.5s |
| 2.2 | 降级策略 UX | **DONE** | P1 | 前端 overlay 5 个新错误码 + zh/en i18n |
| 3.1 | 会话上下文窗口 | **DONE** | — | recent_context.rs + PromptBuilder [session-context] + pipeline/extensions 集成 |
| 3.2 | 场景感知提示 | **DONE** | — | {{scenario-hint}} 模板变量 + lite_polish/smart_polish 模板更新 |
| 3.3 | Review 反馈追踪 | **DONE** | — | Migration 39: review_action/edit_distance/selected_candidate + review_cmds 更新 |
| 4.1 | Prompt Cache 前缀优化 | **DEFERRED** | P2 | 仅需 prompt 文件重排，无代码改动 |
| 4.2 | History 缓存加速 (Bloom) | **DEFERRED** | — | 等 1.3 索引效果验证后再评估 |
| 4.3 | Pipeline 并行化 | **DEFERRED** | — | 代码分析证实不可行（Step 1 仅 ~1-5ms） |
| 4.4 | Token Dashboard | **DONE** | P2 | Dashboard token 趋势指标修正 + 显示 |
| BUG | Multi-model 缺失 .app_name() | **DONE** | — | extensions.rs PromptBuilder 链补充 .app_name(app_name) |

### Priority Legend

- **P0**: 后续多个功能的前置依赖，应优先完成
- **P1**: 直接影响用户体验或系统可靠性
- **P2**: 锦上添花，可在有余力时推进

### Future Work

- **Migrate callers to typed API:** routing.rs, pipeline.rs, extensions.rs 调用方逐步从 legacy tuple 迁移到 `execute_llm_request_typed` / `execute_llm_request_with_retry`
- **Unify extensions.rs HTTP implementation:** 目前 extensions.rs 有自己的 HTTP 实现，与 core.rs 重复。统一后 retry 和 typed error 自动生效
- **Pipeline Decision Dashboard panel:** 在历史详情页展示 pipeline_decisions 数据
- **Prompt Cache prefix audit:** 确保 prompt 模板静态内容在前、动态内容在后

---

## Success Criteria

After all phases:

1. ~~**Every LLM failure has a typed error**~~ ✅ LlmError enum with 5 variants, typed error codes in overlay
2. ~~**Every pipeline run has a decision log entry**~~ ✅ pipeline_decisions table, 11 return points instrumented
3. ~~**Transient failures auto-recover**~~ ✅ execute_llm_request_with_retry with backoff
4. ~~**Consecutive inputs are context-aware**~~ ✅ RecentContext with [session-context] injection
5. ~~**Prompt tone matches application**~~ ✅ {{scenario-hint}} per app category
6. ~~**User feedback is quantified**~~ ✅ review_action / edit_distance / selected_candidate
7. ~~**API cost is visible**~~ ✅ Token usage trend in Dashboard (cost calculation deferred to pricing table)
