# Review Window Fixes Plan

**Date:** 2026-03-30
**Status:** Draft

## Problems

### P1: Frozen content race condition (CRITICAL)

`freeze_review_editor_content_snapshot()` runs in `handler.rs` (Rust, sync) when voice key is pressed. But the latest editor content is synced from frontend via async `invoke("set_review_editor_content_state")`. If the user presses voice key before the async sync completes, the frozen snapshot contains stale content.

**Evidence:** Log showed `ReviewDocumentText len=3` ("可以。") instead of the full rewritten text.

**Fix:** After rewrite result is applied, use a synchronous mechanism to ensure content is up-to-date before next freeze. Options:

- A) Frontend emits a sync event that blocks until backend confirms receipt
- B) `freeze` pulls content directly from frontend via sync IPC call
- C) Store the latest text in a frontend-accessible ref AND backend, freeze reads from whichever is newer

**Recommended: Option A** — After `replaceEditorDocument`, do a blocking sync:

```typescript
await invoke("set_review_editor_content_state", { text });
```

The `await` ensures the backend has the latest text before returning. Since `freeze` happens on the next voice key press (which comes after this), the timing is safe as long as the user waits for the editor to update visually.

### P2: Model resolution uses wrong prompt for rewrite

`execute_votype_rewrite_prompt` calls `resolve_effective_model(settings, fallback_provider, prompt)` where `prompt` is the user's polish prompt (e.g., "开发润色"). The model is resolved from this prompt's `model_id` field. For rewrite, the model should be selected based on the target text length (lite vs full), which we already do in `unified_post_process` by overriding `selected_prompt_model_id`. But `resolve_effective_model` may prioritize `prompt.model_id` over `selected_prompt_model_id`.

**Fix:** In `unified_post_process`, when building `overridden_settings` for rewrite mode, also clear the prompt's `model_id` override so `selected_prompt_model_id` takes effect.

### P3: Prompt dropdown shows wrong selection for PassThrough/LitePolish

When PassThrough sets `post_process_prompt_id = "__PASS_THROUGH__"`, the dropdown should select "无需润色". When LitePolish runs, `post_process_prompt_id` is set to the base prompt's id (not `"__LITE_POLISH__"`).

**Fix:** In the LitePolish path of `unified_post_process`, return `prompt_id = Some("__LITE_POLISH__")` instead of the base prompt's id.

## Implementation Steps

### Step 1: Fix frozen content race (P1)

- In `ReviewWindow.tsx`, ensure the rewrite apply handler `await`s the sync invoke
- The `replaceEditorDocument` path already has sync at line 648, but verify it runs before freeze

### Step 2: Fix LitePolish prompt_id (P3)

- In `pipeline.rs` LitePolish path, set prompt_id to `"__LITE_POLISH__"` in the return

### Step 3: Verify model resolution for rewrite (P2)

- Trace the model resolution path to confirm `overridden_settings.selected_prompt_model_id` takes effect
- If `prompt.model_id` overrides it, clear `prompt.model_id` in the rewrite path

### Step 4: Extract rewrite prompt to external file

- Move the hardcoded rewrite prompt from pipeline.rs to `src-tauri/resources/prompts/system_votype_rewrite.md`
- Load via PromptManager like all other prompts (follows AI Prompt Rules in CLAUDE.md)
