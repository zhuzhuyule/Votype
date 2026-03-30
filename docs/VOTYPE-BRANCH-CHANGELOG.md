# Votype Branch Changelog

**Branch:** `votype`
**Base:** `main` @ `d1d33932` (upgrade transcribe rs to 0.3.5)
**Latest merge:** `b1b1d375` (2026-03-30)

---

## Unified Post-Processing Pipeline

The post-processing system was redesigned from two independent branches (multi-model vs single-model) into a single unified 4-step pipeline. All text flows through one entry point (`unified_post_process`), with the pipeline deciding internally which path to take.

### 4-Step Flow

| Step                        | Function                                                                                  | Condition                          |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| **Step 1: History Match**   | Exact match in history DB → return cached result                                          | Smart routing enabled + short text |
| **Step 2: Intent Analysis** | Intent model classifies: PassThrough / LitePolish / FullPolish + needs_hotword + language | Smart routing enabled + short text |
| **Step 3: Model Selection** | LitePolish → lightweight model; FullPolish → single or multi-model based on config        | Always                             |
| **Step 4: Execution**       | Run LLM polish with selected model + prompt                                               | Always (unless PassThrough)        |

### Smart Routing Bypass

- Text exceeding `length_routing_threshold` → skip Steps 1-2, go directly to FullPolish
- Smart routing disabled → skip Steps 1-2
- ReviewRewrite mode → skip Steps 1-2 and multi-model (voice instruction on selected text)

### Key Files

- `src-tauri/src/actions/post_process/pipeline.rs` — `unified_post_process()` entry point
- `src-tauri/src/actions/post_process/routing.rs` — Intent analysis, `IntentDecision` type
- `src-tauri/src/actions/post_process/mod.rs` — `PipelineResult` enum
- `src-tauri/src/actions/transcribe.rs` — Calls unified pipeline, handles all result types

---

## Review Window System

### Display Modes

| Pipeline Result                                                   | Window Mode         | Description                                            |
| ----------------------------------------------------------------- | ------------------- | ------------------------------------------------------ |
| Skipped / PassThrough / Cached / LitePolish / FullPolish (single) | **Polish**          | Large editor with diff view, Undo/Redo, direct editing |
| MultiModelManual (2+ candidates)                                  | **Multi-candidate** | Candidate panels with ranking, speed, comparison       |
| MultiModelAutoPick (best result)                                  | **Polish**          | Auto-selected best result in editor view               |

### Voice Rewrite (ReviewRewrite)

When the user presses the voice key while the review window is focused:

1. `handler.rs` detects review window focus → routes to `"review-window-local"`
2. `freeze_review_editor_content_snapshot()` captures current editor text synchronously
3. Recording starts → ASR produces spoken instruction
4. Pipeline receives: `review_document_text` (frozen editor content) + transcription (voice instruction)
5. `execute_votype_rewrite_prompt()` uses dedicated rewrite prompt (`system_votype_rewrite.md`)
6. Result emitted via `"review-window-rewrite-apply"` event
7. Frontend updates editor content + syncs back to backend immediately

**Model selection for rewrite:**

- Target text ≤ threshold → lightweight model
- Target text > threshold → full model
- Prompt's `model_id` cleared to respect pipeline's model selection

**Safeguards:**

- Hotword injection disabled during rewrite (prevents instruction misinterpretation)
- Language detection passed to rewrite prompt (prevents language inconsistency)
- `REVIEW_EDITOR_CONTENT` updated synchronously before emit (prevents frozen content race)

### ESC Behavior

- Text modified (manual edit or voice rewrite) → first ESC shows warning toast, second ESC closes
- No modification → ESC closes immediately
- Warning auto-resets after 2 seconds

### Header Components

**Polish mode:** `ASR 结果` | [Play ▶] | [Prompt dropdown] | [Model selector] | [Diff toggle] | [Translate]
**Multi-candidate mode:** `ASR 结果` | [Play ▶] | [Prompt dropdown] | [Sort button] | [Translate]

---

## Multi-Model Candidate System

### Candidate Header Layout

```
Left:  [rank badge] model_name [provider badge] ±change%
Right: 1st/2nd/3rd place counts (highlight current) | time | speed (t/s)
```

### Features

- **Skeleton placeholders** during loading (fixed-size, no layout shift)
- **Output speed** calculated as estimated tokens/sec (heuristic: CJK ≈ 1 token/char, English ≈ 1.3 tokens/word)
- **Shortcut overlay**: Command held → rank badge shows shortcut number (1-5), released → restores rank
- **Streaming results**: Manual mode opens review window immediately, candidates stream in via progress events
- **Sort modes**: Default / Speed-first / Change-first (cycle via toolbar button)
- **Rank statistics**: Historical 1st/2nd/3rd place counts per candidate

### Label Format

`{model_id}` with `{provider_label}` as badge — no prompt name (prompt shown in top dropdown)

---

## Prompt System

### Built-in Prompts

| ID                 | Name           | File                    | Purpose                                                           |
| ------------------ | -------------- | ----------------------- | ----------------------------------------------------------------- |
| `__PASS_THROUGH__` | 无需润色       | —                       | Return source text as-is                                          |
| `__LITE_POLISH__`  | 轻量润色       | `system_lite_polish.md` | Minimal ASR correction (filler words, punctuation, minor grammar) |
| (user prompts)     | (user defined) | External skill files    | Full polish with custom instructions                              |

### Prompt Files

| File                       | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `system_smart_routing.md`  | Intent analysis: action + needs_hotword + language |
| `system_lite_polish.md`    | Lightweight ASR post-processing                    |
| `system_votype_rewrite.md` | Voice instruction rewrite (document editor prompt) |

### Prompt Dropdown Order

`无需润色` → `轻量润色` → [user prompts ordered by drag-and-drop]

---

## Language Detection

### Flow

```
Smart Routing (short text) → intent model outputs "language": "zh"|"en"
    or
Heuristic (long text / no routing) → all ASCII = "en", otherwise = user's app_language
    ↓
detected_language flows through pipeline
    ↓
Rewrite prompt receives [output_language] section
    ↓
Rule 7: "Preserve document language (output_language) unless explicit translation"
```

---

## Audio Playback

Review window header includes a play/pause button that loads the recording audio via `get_audio_path_by_history_id` command. Uses HTML5 Audio API with Tauri asset URL conversion.

---

## Configuration

### Reused Settings

| Setting                                  | Purpose                                            |
| ---------------------------------------- | -------------------------------------------------- |
| `length_routing_enabled`                 | Smart routing on/off                               |
| `post_process_intent_model_id`           | Intent model for Step 2                            |
| `length_routing_short_model_id`          | Lightweight model for LitePolish                   |
| `length_routing_threshold`               | Character count threshold for smart routing bypass |
| `multi_model_post_process_enabled`       | Enable multi-model in Step 3                       |
| `post_process_hotword_injection_enabled` | Global hotword toggle                              |

### New Commands

| Command                        | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| `get_audio_path_by_history_id` | Get audio file path from history entry ID |
