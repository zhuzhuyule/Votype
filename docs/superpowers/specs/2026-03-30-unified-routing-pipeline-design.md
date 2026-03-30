# Unified Post-Processing Routing Pipeline

**Date:** 2026-03-30
**Status:** Approved

## Problem

The current post-processing pipeline has two independent branches in `transcribe.rs`:

1. **Multi-model branch** — when `multi_model_post_process_enabled` is true, `transcribe.rs` directly calls `extensions::multi_post_process_transcription()`, bypassing all smart routing logic.
2. **Single-model branch** — calls `pipeline::maybe_post_process_transcription()`, which contains smart routing (history match, intent analysis, length routing).

This split means short text (e.g., 7 characters) that should be handled by smart routing's pass_through or lite_polish instead flows through 4-model concurrent processing, wasting resources and adding latency.

## Solution

Replace the two branches with a single unified pipeline that **all** text flows through. Smart routing becomes the gatekeeper; multi-model execution is a downstream option, not a parallel branch.

## Unified Pipeline Flow

```
unified_post_process(transcription, settings, context...)
    │
    ├── char_count > length_routing_threshold?
    │   └── YES → FullPolish (skip smart routing, long text needs full context)
    │
    ├── 智能模式关闭 (smart routing disabled)?
    │   └── YES → FullPolish (按现有配置直接执行)
    │
    ├── Step 1: History Exact Match (local, 0ms)
    │   └── Hit → PipelineResult::Cached
    │
    ├── Step 2: Intent Analysis (intent model, ~1-2s)
    │   │  Input: transcription text
    │   │  Output: { action, needs_hotword }
    │   ├── PassThrough → PipelineResult::PassThrough (return original text)
    │   ├── LitePolish → Step 4 with lightweight model + lightweight prompt
    │   └── FullPolish → Step 3
    │
    ├── Step 3: Model Selection (local logic, 0ms, FullPolish only)
    │   ├── multi_model_enabled → build multi-model items
    │   └── otherwise → single model + full prompt
    │
    └── Step 4: Execute Polish
        ├── Single model path (core.rs)
        └── Multi-model path (extensions.rs)
        └── → PipelineResult
```

## Key Design Decisions

### 1. Intent Model Only Decides, Never Modifies

Step 2 uses the configured intent model (`post_process_intent_model_id`) to output a structured JSON decision:

```json
{"action": "pass_through", "needs_hotword": false}
{"action": "lite_polish", "needs_hotword": false}
{"action": "full_polish", "needs_hotword": true}
```

The intent model does **not** return corrected text. Previous design had `LitePolish { result }` where the intent model attempted both classification and correction — this is removed because small/fast models cannot reliably do both.

### 2. LitePolish Execution

When Step 2 returns `lite_polish`:

- **Model**: lightweight model via `length_routing_short_model_id` (existing config)
- **Prompt**: new `system_lite_polish.md` — conservative corrections only:
  - Remove filler words (嗯, 啊, 额)
  - Simple tone adjustments
  - Grammar/punctuation fixes when clearly wrong
  - No deep rewriting, no structural changes
  - Goal: high accuracy, minimal modification

### 3. Long Text Bypasses Smart Routing

Text exceeding `length_routing_threshold` skips Steps 1-2 entirely and goes directly to FullPolish. Rationale: long content inherently needs full context (hotwords, history, complete prompt) for accurate processing.

### 4. Single-Model and Multi-Model Remain Separate Paths

The two execution paths in Step 4 are preserved as-is:

- `core.rs` handles single-model execution
- `extensions.rs` handles multi-model concurrent execution

They are not merged. Both return results through the unified `PipelineResult`.

### 5. Review Window Logic Is External

The pipeline returns `PipelineResult` without any UI side effects. `transcribe.rs` handles all UI concerns (review window, overlay, paste, history save) uniformly based on the result, regardless of which path produced it.

### 6. Hotword Injection Controlled by Intent

The `needs_hotword` field from Step 2 determines whether hotword context is injected into the polish prompt. When smart routing is bypassed (long text or disabled), hotwords are always injected (current default behavior).

## PipelineResult Type

```rust
pub enum PipelineResult {
    /// No post-processing needed (disabled, skip marker, etc.)
    Skipped,
    /// History cache hit — reuse previous result
    Cached {
        text: String,
        model: Option<String>,
        prompt_id: Option<String>,
    },
    /// Intent model determined no changes needed
    PassThrough {
        text: String,
        intent_token_count: Option<i64>,
    },
    /// Single-model polish completed
    SingleModel {
        text: String,
        model: Option<String>,
        prompt_id: Option<String>,
        token_count: Option<i64>,
        llm_call_count: Option<i64>,
        error: bool,
        error_message: Option<String>,
    },
    /// Multi-model results ready
    MultiModel {
        candidates: Vec<MultiModelPostProcessResult>,
        multi_items: Vec<MultiModelPostProcessItem>,
        total_token_count: Option<i64>,
        llm_call_count: Option<i64>,
    },
}
```

## Configuration

### Reused (no changes):

- `length_routing_enabled` — smart routing on/off toggle
- `post_process_intent_model_id` — Step 2 intent model
- `length_routing_short_model_id` — lightweight model for LitePolish
- `length_routing_threshold` — character count threshold; above this, skip smart routing
- `multi_model_post_process_enabled` — whether Step 3 can choose multi-model
- `post_process_hotword_injection_enabled` — global hotword toggle (Step 2's `needs_hotword` operates within this)

### New:

- `system_lite_polish.md` — prompt file for lightweight polish execution

### Removed:

- `SmartAction::LitePolish { result }` — the `result` field is removed; LitePolish no longer carries corrected text from the intent model

## Updated Prompt: `system_smart_routing.md`

Simplified to decision-only output:

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

## New Prompt: `system_lite_polish.md`

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

## Code Changes

### `pipeline.rs`

- New function: `unified_post_process()` — the single entry point implementing the full 4-step flow
- Existing `maybe_post_process_transcription()` becomes an internal helper for Step 4 single-model execution
- Move threshold check and smart routing toggle logic into `unified_post_process()`

### `routing.rs`

- `SmartAction::LitePolish` — remove `{ result: String }`, make it a unit variant
- `execute_smart_action_routing()` — update to parse new JSON format with `needs_hotword`, no longer extract `result`
- New struct: `IntentDecision { action: SmartAction, needs_hotword: bool }`

### `transcribe.rs`

- Delete the multi-model branch (~500 lines, from line 1124 to ~1608)
- Replace with a single call to `unified_post_process()`
- Unified post-result handling: match on `PipelineResult` variants to determine review window / auto-paste / history save
- All UI logic (overlay, review window, tray icon, paste) remains in `transcribe.rs`

### `extensions.rs`

- No structural changes
- `multi_post_process_transcription()` continues to handle multi-model execution

### `core.rs`

- No changes

### New file: `src-tauri/resources/prompts/system_lite_polish.md`

### Updated file: `src-tauri/resources/prompts/system_smart_routing.md`
