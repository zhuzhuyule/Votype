# Unified Multi-Model Review Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all multi-model strategies (manual/race/lazy) to use the same multi-candidate review window, differentiated only by default selection and whether to auto-confirm (skip review).

**Architecture:** Remove `MultiModelAutoPick` pipeline result. All multi-model strategies return `MultiModelManual`, which always opens the multi-candidate review window and streams results. The pipeline passes `auto_confirm: bool` (from AppReviewPolicy) and `strategy` to the caller. Race/lazy with `policy=Never` auto-confirm the default pick without showing the window. Race/lazy with review enabled show the multi-candidate window with the strategy's pick pre-selected. Manual always shows the window regardless of policy.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend review window)

---

## File Map

| File | Changes |
|------|---------|
| `src-tauri/src/actions/post_process/mod.rs` | Remove `MultiModelAutoPick`, add `strategy` + `intent_token_count` to `MultiModelManual` |
| `src-tauri/src/actions/post_process/pipeline.rs` | All strategies return `MultiModelManual`; remove auto-pick await path |
| `src-tauri/src/actions/transcribe.rs` | Remove `MultiModelAutoPick` match arm; unify `MultiModelManual` to handle all strategies with review policy + auto-confirm |
| `src-tauri/src/actions/post_process/extensions.rs` | `multi_post_process_transcription` always collects all results (no early return for race/lazy); emit `auto_selected_id` in progress events |
| `src-tauri/src/review_window.rs` | Add `auto_selected_id` to `ReviewWindowMultiCandidatePayload` |
| `src/review/main.tsx` | Pass `auto_selected_id` through to ReviewWindow |
| `src/review/ReviewWindow.tsx` | Use `auto_selected_id` for initial selection instead of first candidate |

---

### Task 1: Extend `MultiModelManual` and remove `MultiModelAutoPick`

**Files:**
- Modify: `src-tauri/src/actions/post_process/mod.rs:140-199`

- [ ] **Step 1: Update `MultiModelManual` variant to carry strategy info**

In `mod.rs`, replace the existing `MultiModelManual` and `MultiModelAutoPick` variants:

```rust
    /// Multi-model: caller should show review window and start streaming.
    /// All strategies (manual/race/lazy) use this variant.
    /// The `strategy` field tells the caller how to pick the default selection
    /// and whether auto-confirm is possible.
    MultiModel {
        /// The multi-model item configs (needed to build loading candidates and call multi_post_process)
        multi_items: Vec<crate::settings::MultiModelPostProcessItem>,
        intent_token_count: Option<i64>,
        /// Prompt ID used for all candidates
        prompt_id: Option<String>,
        /// "manual", "race", or "lazy"
        strategy: String,
    },
```

Note: We rename `MultiModelManual` → `MultiModel` and remove `MultiModelAutoPick` entirely.

- [ ] **Step 2: Fix all compiler errors from the rename**

The rename will cause errors in:
- `src-tauri/src/actions/post_process/pipeline.rs` — update return statements
- `src-tauri/src/actions/transcribe.rs` — update match arms (leave as `todo!()` for now in the old AutoPick arm; we'll fix properly in Task 3)

Run: `cargo check 2>&1 | head -40`

Fix each error by:
1. In `pipeline.rs`: change `PipelineResult::MultiModelManual { .. }` to `PipelineResult::MultiModel { .. }` and add `strategy` field
2. In `transcribe.rs`: change match arm from `MultiModelManual` to `MultiModel`, temporarily keep AutoPick arm as unreachable

- [ ] **Step 3: Verify it compiles**

Run: `cargo check 2>&1 | tail -10`
Expected: compiles (possibly with warnings about unreachable code)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/mod.rs src-tauri/src/actions/post_process/pipeline.rs src-tauri/src/actions/transcribe.rs
git commit -m "Rename MultiModelManual to MultiModel and remove MultiModelAutoPick variant"
```

---

### Task 2: Pipeline always returns `MultiModel` immediately

**Files:**
- Modify: `src-tauri/src/actions/post_process/pipeline.rs:351-427`

- [ ] **Step 1: Remove the auto-pick await path**

Replace the entire `if use_multi_model` block (lines 351-427) with:

```rust
    if use_multi_model {
        let multi_items = settings.build_multi_model_items_from_selection();
        if !multi_items.is_empty() {
            let strategy = settings.multi_model_strategy.clone();
            let effective_prompt_id = override_prompt_id
                .clone()
                .or(settings.post_process_selected_prompt_id.clone());

            if log_routing {
                info!(
                    "[UnifiedPipeline] Step 3: FullPolish → multi-model ({} models, strategy={})",
                    multi_items.len(),
                    strategy
                );
            }

            // All strategies return immediately so caller can show review window
            // before results arrive. Caller handles review policy + auto-confirm.
            return super::PipelineResult::MultiModel {
                multi_items,
                intent_token_count: intent_tokens,
                prompt_id: effective_prompt_id,
                strategy,
            };
        }
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Pipeline returns MultiModel immediately for all strategies"
```

---

### Task 3: Add `auto_selected_id` to review window payload

**Files:**
- Modify: `src-tauri/src/review_window.rs:54-62, 651-721`

- [ ] **Step 1: Add `auto_selected_id` field to `ReviewWindowMultiCandidatePayload`**

```rust
#[derive(Clone, serde::Serialize)]
pub struct ReviewWindowMultiCandidatePayload {
    pub source_text: String,
    pub candidates: Vec<MultiModelCandidate>,
    pub history_id: Option<i64>,
    pub output_mode: PromptOutputMode,
    pub skill_name: Option<String>,
    pub prompt_id: Option<String>,
    /// ID of the candidate that should be pre-selected (strategy-dependent).
    /// For race: fastest result. For lazy: best within timeout. For manual: favorite model.
    pub auto_selected_id: Option<String>,
}
```

- [ ] **Step 2: Add `auto_selected_id` parameter to `show_review_window_with_candidates`**

Update the function signature and payload construction:

```rust
pub fn show_review_window_with_candidates(
    app_handle: &AppHandle,
    source_text: String,
    candidates: Vec<MultiModelCandidate>,
    history_id: Option<i64>,
    output_mode: PromptOutputMode,
    skill_name: Option<String>,
    prompt_id: Option<String>,
    auto_selected_id: Option<String>,
) {
    // ... existing code ...
    let payload = ReviewWindowMultiCandidatePayload {
        source_text,
        candidates,
        history_id,
        output_mode,
        skill_name,
        prompt_id,
        auto_selected_id,
    };
    // ... rest unchanged ...
}
```

- [ ] **Step 3: Fix callers**

Update all call sites of `show_review_window_with_candidates` to pass `None` for `auto_selected_id` (we'll set the real value in Task 5):

In `transcribe.rs`, the existing call passes `None` as placeholder.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/review_window.rs src-tauri/src/actions/transcribe.rs
git commit -m "Add auto_selected_id to review window multi-candidate payload"
```

---

### Task 4: `multi_post_process_transcription` always collects all results

**Files:**
- Modify: `src-tauri/src/actions/post_process/extensions.rs:336-500`

Currently, race mode returns early with the first result and lazy mode returns early at timeout. We need them to always collect all results but **mark** which result would be the auto-pick.

- [ ] **Step 1: Change return type to include auto-selected ID**

Add a return struct at the top of the file (or near `MultiModelPostProcessResult`):

In `mod.rs`, add:
```rust
pub struct MultiModelCollectedResults {
    pub results: Vec<MultiModelPostProcessResult>,
    /// The ID of the result that would be auto-selected by the strategy
    pub auto_selected_id: Option<String>,
}
```

- [ ] **Step 2: Refactor the result collection loop**

Change the `while !futures.is_empty()` loop in `multi_post_process_transcription` to:
- **Race**: When first success arrives, record its ID as `auto_selected_id` and emit `multi-post-process-auto-selected` event, but **continue collecting** remaining results
- **Lazy**: Same as before for timeout logic, but record the pick ID and **continue collecting**
- **Manual**: No auto-select; collect all results normally

Replace early `return vec![result]` statements with setting `auto_selected_id` and continuing the loop.

The key change pattern for race mode (around line 423):
```rust
if strategy == "race" && auto_selected_id.is_none() && result.ready && result.error.is_none() {
    auto_selected_id = Some(result.id.clone());
    info!(
        "[MultiModel] Race mode auto-selected: id={}, completed={}/{}",
        result.id, completed, total
    );
    let _ = _app_handle.emit(
        "multi-post-process-auto-selected",
        serde_json::json!({ "id": result.id }),
    );
}
```

Similar for lazy mode — replace the `return` statements with setting `auto_selected_id`.

- [ ] **Step 3: Change return type**

Change the function signature from returning `Vec<MultiModelPostProcessResult>` to `MultiModelCollectedResults`:

```rust
pub async fn multi_post_process_transcription(
    // ... same params ...
) -> MultiModelCollectedResults {
```

At the end:
```rust
    emit_multi_complete(_app_handle, total, all_results.len(), all_results.clone());
    MultiModelCollectedResults {
        results: all_results,
        auto_selected_id,
    }
```

- [ ] **Step 4: Fix callers**

Update `transcribe.rs` where `multi_post_process_transcription` is called. The result is now `MultiModelCollectedResults` — extract `.results` where the old code used the vec directly. We'll properly integrate in Task 5.

- [ ] **Step 5: Verify it compiles**

Run: `cargo check 2>&1 | tail -10`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/extensions.rs src-tauri/src/actions/post_process/mod.rs src-tauri/src/actions/transcribe.rs
git commit -m "multi_post_process always collects all results, tracks auto_selected_id"
```

---

### Task 5: Unify the `MultiModel` match arm in `transcribe.rs`

**Files:**
- Modify: `src-tauri/src/actions/transcribe.rs:1717-1860`

This is the core task. The new `MultiModel` match arm must:
1. Always open review window with loading candidates
2. Start `multi_post_process_transcription` (streams results)
3. When complete: save to history
4. If `app_policy == Never` AND strategy != "manual": auto-confirm the auto-selected result (paste without showing window)
5. If review is shown: pass `auto_selected_id` to the window

- [ ] **Step 1: Replace the entire `MultiModel` match arm**

Remove the old `MultiModelManual` arm and the old `MultiModelAutoPick` arm. Replace with:

```rust
crate::actions::post_process::PipelineResult::MultiModel {
    multi_items,
    prompt_id: effective_prompt_id,
    strategy,
    ..
} => {
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

    // Determine if review window should be shown
    let should_review = if matches!(
        votype_mode,
        VotypeInputMode::MainPolishInput
            | VotypeInputMode::MainSelectedEdit
            | VotypeInputMode::ReviewRewrite
    ) {
        false
    } else if override_prompt_id.as_deref() == Some("__SKIP_POST_PROCESS__") {
        false
    } else if strategy == "manual" {
        // Manual mode always shows review window
        true
    } else if app_policy == crate::settings::AppReviewPolicy::Never {
        false
    } else {
        true
    };

    // Build loading candidates
    let loading_candidates: Vec<crate::review_window::MultiModelCandidate> =
        multi_items
            .iter()
            .map(|item| {
                let provider_label = settings_clone
                    .post_process_provider(&item.provider_id)
                    .map(|p| p.label.clone())
                    .unwrap_or_else(|| item.provider_id.clone());
                let label = item
                    .custom_label
                    .clone()
                    .unwrap_or_else(|| item.model_id.clone());
                crate::review_window::MultiModelCandidate {
                    id: item.id.clone(),
                    label,
                    provider_label,
                    text: String::new(),
                    confidence: None,
                    processing_time_ms: 0,
                    error: None,
                    ready: false,
                }
            })
            .collect();

    if should_review {
        // Show review window immediately with loading candidates
        crate::review_window::set_last_active_window(
            active_window_snapshot_for_review.clone(),
        );
        crate::review_window::show_review_window_with_candidates(
            &ah_clone,
            transcription_clone.clone(),
            loading_candidates,
            history_id,
            output_mode,
            None,
            effective_prompt_id.clone(),
            None, // auto_selected_id set later via event
        );
    }
    utils::hide_recording_overlay(&ah_clone);
    change_tray_icon(&ah_clone, TrayIconState::Idle);

    // Start multi-model processing
    info!(
        "[MultiModel] Starting streaming multi-model post-processing ({} models, strategy={})",
        multi_items.len(), strategy
    );
    let collected =
        crate::actions::post_process::multi_post_process_transcription(
            &ah_clone,
            &settings_clone,
            &chinese_converted_text,
            secondary.as_deref(),
            history_id,
            active_window_snapshot_for_review
                .as_ref()
                .map(|info| info.app_name.clone()),
            active_window_snapshot_for_review
                .as_ref()
                .map(|info| info.title.clone()),
            override_prompt_id.clone(),
        )
        .await;

    // Save best result to history
    let best = collected.results.iter().find(|r| r.ready && r.error.is_none());
    if let Some(best) = best {
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
                    None,
                    None,
                )
                .await
            {
                error!("Failed to save multi-model result to history: {}", e);
            }
        }
    }

    // Auto-confirm for non-manual strategies when review is not shown
    if !should_review {
        let auto_id = collected.auto_selected_id.as_deref();
        let auto_result = auto_id
            .and_then(|id| collected.results.iter().find(|r| r.id == id))
            .or_else(|| collected.results.iter().find(|r| r.ready && r.error.is_none()));

        if let Some(result) = auto_result {
            let paste_text = result.text.clone();
            let ah_inner = ah_clone.clone();
            ah_clone
                .run_on_main_thread(move || {
                    if let Err(e) = utils::paste(paste_text, ah_inner) {
                        error!("Failed to paste multi-model result: {}", e);
                    }
                })
                .unwrap_or_else(|e| {
                    error!("Failed to run paste on main thread: {:?}", e)
                });
        }
    }
    return;
}
```

- [ ] **Step 2: Remove the old `MultiModelAutoPick` match arm entirely**

Delete the entire block that was matching `PipelineResult::MultiModelAutoPick`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo check 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs
git commit -m "Unify MultiModel match arm: all strategies use multi-candidate window with review policy"
```

---

### Task 6: Frontend — pass `auto_selected_id` through to ReviewWindow

**Files:**
- Modify: `src/review/main.tsx:34-41`
- Modify: `src/review/ReviewWindow.tsx:219-223`

- [ ] **Step 1: Add `auto_selected_id` to `MultiCandidateData` interface**

In `main.tsx`:
```typescript
interface MultiCandidateData {
  source_text: string;
  candidates: MultiModelCandidate[];
  history_id: number | null;
  output_mode?: "polish" | "chat";
  skill_name?: string;
  prompt_id?: string | null;
  auto_selected_id?: string | null;
}
```

- [ ] **Step 2: Pass `auto_selected_id` to ReviewWindow**

In `main.tsx`, where ReviewWindow is rendered with multiCandidateData (around line 190), pass the ID:

Find where `multiCandidates={multiCandidateData.candidates}` is passed and add:
```typescript
autoSelectedId={multiCandidateData.auto_selected_id}
```

- [ ] **Step 3: Accept `autoSelectedId` prop in ReviewWindow**

In `ReviewWindow.tsx`, add the prop and use it for initial selection:

```typescript
// Add to component props
autoSelectedId?: string | null;
```

Change the initial selectedCandidateId state (line 219-223):
```typescript
const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
  autoSelectedId && multiCandidates?.some((c) => c.id === autoSelectedId)
    ? autoSelectedId
    : multiCandidates && multiCandidates.length > 0
      ? multiCandidates[0].id
      : null,
);
```

- [ ] **Step 4: Listen for `multi-post-process-auto-selected` event**

In `ReviewWindow.tsx`, add an effect that updates the selection when the auto-selected event arrives (for race/lazy where the window opens before any results):

```typescript
useEffect(() => {
  if (!multiCandidates) return;
  let unlisten: (() => void) | null = null;
  listen<{ id: string }>("multi-post-process-auto-selected", (event) => {
    // Only auto-select if user hasn't manually changed selection
    // and current selection is still the initial first candidate or null
    setSelectedCandidateId((prev) => {
      // If user has already selected a different ready candidate, don't override
      const firstId = multiCandidates[0]?.id;
      if (prev !== null && prev !== firstId) return prev;
      return event.payload.id;
    });
  }).then((fn) => { unlisten = fn; });
  return () => { if (unlisten) unlisten(); };
}, [!!multiCandidates]);
```

- [ ] **Step 5: Commit**

```bash
git add src/review/main.tsx src/review/ReviewWindow.tsx
git commit -m "Frontend: use auto_selected_id for initial candidate selection"
```

---

### Task 7: Manual mode default selection — favorite model

**Files:**
- Modify: `src-tauri/src/actions/post_process/extensions.rs`

For manual mode, the auto_selected_id should be the user's favorite/preferred model.

- [ ] **Step 1: Set `auto_selected_id` for manual strategy**

In the `multi_post_process_transcription` function, after the strategy variable is read, add manual mode handling:

```rust
// For manual strategy, pre-select the preferred/favorite model
if strategy == "manual" {
    auto_selected_id = settings
        .multi_model_preferred_id
        .clone()
        .filter(|id| items.iter().any(|item| &item.id == id))
        .or_else(|| {
            settings
                .multi_model_manual_pick_counts
                .iter()
                .filter(|(id, _)| items.iter().any(|item| &item.id == *id))
                .max_by_key(|(_, count)| *count)
                .map(|(id, _)| id.clone())
        });
    if let Some(ref id) = auto_selected_id {
        info!("[MultiModel] Manual mode pre-selected favorite: {}", id);
    }
}
```

This uses the same preferred model logic that lazy mode already uses.

- [ ] **Step 2: Emit auto-selected event immediately for manual mode**

Right after the above block, if we have an auto_selected_id for manual:

```rust
if strategy == "manual" {
    if let Some(ref id) = auto_selected_id {
        let _ = _app_handle.emit(
            "multi-post-process-auto-selected",
            serde_json::json!({ "id": id }),
        );
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/extensions.rs
git commit -m "Manual mode pre-selects favorite model as default candidate"
```

---

### Task 8: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run full compilation**

Run: `cargo check 2>&1 | tail -10`
Expected: no errors

- [ ] **Step 2: Run all tests**

Run: `cargo test 2>&1 | tail -20`
Expected: all tests pass (except pre-existing failures in routing.rs)

- [ ] **Step 3: Fix any warnings**

Address any compiler warnings introduced by the changes.

- [ ] **Step 4: Commit warning fixes if any**

```bash
git add -u && git commit -m "Fix compiler warnings from unified multi-model review"
```
