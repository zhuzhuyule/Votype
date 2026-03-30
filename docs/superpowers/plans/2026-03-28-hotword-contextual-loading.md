# Hotword Contextual Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable hotword loading system that preserves user-added hotwords, learns app/scenario relevance from actual outputs, and injects only the most relevant grouped hotwords into ASR/rewrite prompts.

**Architecture:** Extend the hotword model with lightweight relevance telemetry instead of adding more user-facing controls. Record hotword hits from final outputs together with app/scenario context, then rank hotwords at request time using manual priority, current-text relevance, app affinity, scenario affinity, recency, and false-positive penalties. Prompt injection stays compact by separating required targets from optional misrecognition mappings and grouping them by category.

**Tech Stack:** Rust, Tauri v2, rusqlite, React/TypeScript, existing `HotwordManager`, existing post-process pipeline, existing active-window/app-category utilities.

---

## File Map

| File                                                                              | Responsibility                                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/managers/history.rs`                                               | Add DB migration(s) for hotword telemetry tables/columns                                                 |
| `src-tauri/src/settings.rs`                                                       | Extend `Hotword` shape with telemetry fields returned to app/runtime                                     |
| `src-tauri/src/managers/hotword.rs`                                               | Persist hotword telemetry, scenario/app stats, ranked retrieval APIs                                     |
| `src-tauri/src/actions/transcribe.rs`                                             | Trigger final-output hotword usage recording after successful ASR/polish/rewrite                         |
| `src-tauri/src/actions/post_process/pipeline.rs`                                  | Replace naive hotword injection with grouped contextual loading for rewrite and normal post-processing   |
| `src-tauri/src/app_category.rs`                                                   | Reuse or extend app-to-scenario/category helpers if needed                                               |
| `src/review/ReviewWindow.tsx`                                                     | No behavior change required for plan phase; only verify no contract break if event payloads evolve later |
| `src/bindings.ts`                                                                 | Regenerate only if backend command signatures or serialized types change                                 |
| `docs/superpowers/specs/2026-03-28-votype-selection-and-review-rewrite-design.md` | Reference-only; no required edits unless implementation changes design                                   |

## Task 1: Add Hotword Telemetry Storage

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/managers/history.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs`
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs` (unit tests added there)

- [ ] **Step 1: Write the failing telemetry-shape test**

Add a new unit test in `src-tauri/src/managers/hotword.rs` that asserts hotword rows can round-trip the new telemetry fields:

```rust
#[test]
fn test_hotword_row_includes_contextual_telemetry_defaults() {
    let json = r#"{
        "id": 1,
        "target": "skill",
        "originals": ["scale"],
        "category": "term",
        "scenarios": ["work"],
        "user_override": true,
        "use_count": 3,
        "last_used_at": 1710000000,
        "false_positive_count": 0,
        "created_at": 1710000000,
        "status": "active",
        "source": "manual",
        "recent_use_count": 0,
        "app_affinity": {},
        "scenario_affinity": {}
    }"#;

    let parsed: crate::settings::Hotword = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.target, "skill");
    assert_eq!(parsed.recent_use_count, 0);
    assert!(parsed.app_affinity.is_empty());
    assert!(parsed.scenario_affinity.is_empty());
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_hotword_row_includes_contextual_telemetry_defaults --lib
```

Expected: FAIL because `Hotword` does not yet include `recent_use_count`, `app_affinity`, or `scenario_affinity`.

- [ ] **Step 3: Add DB schema support**

In `src-tauri/src/managers/history.rs`, add a migration that creates a dedicated telemetry table rather than overloading `hotwords` with large JSON blobs:

```rust
M::up(
    "CREATE TABLE IF NOT EXISTS hotword_usage_context (
        hotword_id INTEGER NOT NULL,
        app_name TEXT NOT NULL,
        scenario TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        PRIMARY KEY (hotword_id, app_name, scenario),
        FOREIGN KEY (hotword_id) REFERENCES hotwords(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hotword_usage_context_hotword ON hotword_usage_context(hotword_id);
    CREATE INDEX IF NOT EXISTS idx_hotword_usage_context_app ON hotword_usage_context(app_name);
    "
)
```

Also add a small-column migration for aggregate recency on `hotwords`:

```rust
M::up(
    "ALTER TABLE hotwords ADD COLUMN recent_use_count INTEGER NOT NULL DEFAULT 0;"
)
```

- [ ] **Step 4: Extend the serialized `Hotword` type**

In `src-tauri/src/settings.rs`, extend `Hotword`:

```rust
#[serde(default)]
pub recent_use_count: i64,
#[serde(default)]
pub app_affinity: std::collections::HashMap<String, i64>,
#[serde(default)]
pub scenario_affinity: std::collections::HashMap<String, i64>,
```

Use `#[serde(default)]` so old rows and exported JSON remain compatible.

- [ ] **Step 5: Load telemetry defaults in row mapping**

In `src-tauri/src/managers/hotword.rs`, initialize the new fields in `row_to_hotword`:

```rust
recent_use_count: row.get("recent_use_count").unwrap_or(0),
app_affinity: HashMap::new(),
scenario_affinity: HashMap::new(),
```

The per-app/scenario maps will be hydrated by a follow-up query method instead of inline row loading.

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_hotword_row_includes_contextual_telemetry_defaults --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add /Users/zac/code/github/asr/Handy/src-tauri/src/managers/history.rs /Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs /Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs
git commit -m "feat: add hotword contextual telemetry storage"
```

## Task 2: Record Hotword Usage From Final Outputs

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/transcribe.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/app_category.rs` (only if helper expansion is needed)
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs`

- [ ] **Step 1: Write a failing hotword-hit recording test**

Add a test in `src-tauri/src/managers/hotword.rs`:

```rust
#[test]
fn test_record_output_hits_updates_hotword_and_context_stats() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("hotword.db");
    let manager = HotwordManager::new(db.clone());
    crate::managers::history::HistoryManager::new(db).unwrap();

    let hotword = manager
        .add(
            "skill".into(),
            vec!["scale".into()],
            Some("term".into()),
            Some(vec![crate::settings::HotwordScenario::Work]),
        )
        .unwrap();

    manager
        .record_output_hits(
            "当前 skill 的状态需要更新",
            Some("Cursor"),
            Some(crate::settings::HotwordScenario::Work),
        )
        .unwrap();

    let enriched = manager.get_contextual_hotwords(crate::settings::HotwordScenario::Work).unwrap();
    let item = enriched.into_iter().find(|h| h.id == hotword.id).unwrap();
    assert_eq!(item.use_count, 1);
    assert_eq!(item.recent_use_count, 1);
    assert_eq!(item.app_affinity.get("Cursor"), Some(&1));
    assert_eq!(item.scenario_affinity.get("work"), Some(&1));
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_record_output_hits_updates_hotword_and_context_stats --lib
```

Expected: FAIL because `record_output_hits` and `get_contextual_hotwords` do not exist yet.

- [ ] **Step 3: Add contextual telemetry APIs**

In `src-tauri/src/managers/hotword.rs`, add:

```rust
pub fn record_output_hits(
    &self,
    output_text: &str,
    app_name: Option<&str>,
    scenario: Option<HotwordScenario>,
) -> Result<()>

pub fn get_contextual_hotwords(
    &self,
    scenario: HotwordScenario,
) -> Result<Vec<Hotword>>
```

Implementation details:

- Match hotwords by `target` and `originals` against normalized final output text.
- Increment `use_count`, `recent_use_count`, `last_used_at`.
- Upsert `hotword_usage_context (hotword_id, app_name, scenario)`.
- Hydrate `app_affinity` and `scenario_affinity` maps when reading contextual hotwords.

- [ ] **Step 4: Wire output-hit recording into transcription flow**

In `src-tauri/src/actions/transcribe.rs`, after `final_text` is produced and before returning, call:

```rust
if let Some(hm) = ah_clone.try_state::<Arc<HistoryManager>>() {
    let hotword_manager = crate::managers::HotwordManager::new(hm.db_path.clone());
    let scenario = crate::actions::post_process::pipeline::detect_scenario(&app_name_for_review);
    if let Err(e) = hotword_manager.record_output_hits(
        &final_text,
        active_window_snapshot_for_review.as_ref().map(|w| w.app_name.as_str()),
        scenario,
    ) {
        log::warn!("[Hotword] Failed to record output hits: {}", e);
    }
}
```

Use the final polished/rewrite text, not the raw ASR result, because final output is the accepted reference.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_record_output_hits_updates_hotword_and_context_stats --lib
```

Expected: PASS.

- [ ] **Step 6: Run broader regression for hotword and transcribe paths**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test hotword --lib
cargo test window_context --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add /Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs /Users/zac/code/github/asr/Handy/src-tauri/src/actions/transcribe.rs /Users/zac/code/github/asr/Handy/src-tauri/src/app_category.rs
git commit -m "feat: track hotword usage from final outputs"
```

## Task 3: Add Contextual Ranking for Hotword Retrieval

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs`
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs`

- [ ] **Step 1: Write a failing ranking test**

Add a ranking-focused test:

```rust
#[test]
fn test_ranked_hotwords_prefer_manual_and_contextual_matches_over_raw_count() {
    // Arrange a high-count legacy term and a lower-count but app-relevant manual term.
    // Assert the app-relevant manual term ranks first for Cursor/work requests.
}
```

Use concrete fixtures:

- `legacyTerm`: `use_count=40`, no app/context affinity
- `skill`: `use_count=5`, `source=manual`, `app_affinity["Cursor"]=3`, `scenario_affinity["work"]=4`

Expected ordering: `skill` before `legacyTerm`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_ranked_hotwords_prefer_manual_and_contextual_matches_over_raw_count --lib
```

Expected: FAIL because ranking still sorts primarily by `use_count`.

- [ ] **Step 3: Add scoring helpers**

In `src-tauri/src/managers/hotword.rs`, add a small internal scoring function:

```rust
fn contextual_score(
    hotword: &Hotword,
    app_name: Option<&str>,
    scenario: Option<HotwordScenario>,
    current_document: Option<&str>,
    spoken_instruction: Option<&str>,
) -> i64
```

Scoring guidelines:

- `manual source`: `+100`
- target hit in current document: `+120`
- target hit in spoken instruction: `+140`
- alias hit in current document: `+90`
- alias hit in spoken instruction: `+110`
- app affinity hit: `+min(app_count * 10, 60)`
- scenario affinity hit: `+min(scenario_count * 8, 48)`
- recent use count: `+min(recent_use_count * 4, 40)`
- total frequency: `+(log2(use_count + 1) * 6) as i64`
- false positive penalty: `-(false_positive_count * 15)`

Do **not** use raw linear `use_count`.

- [ ] **Step 4: Add ranked retrieval API**

Add:

```rust
pub fn get_ranked_hotwords(
    &self,
    scenario: HotwordScenario,
    app_name: Option<&str>,
    current_document: Option<&str>,
    spoken_instruction: Option<&str>,
) -> Result<Vec<Hotword>>
```

This should:

- load contextual hotwords
- compute score
- sort descending by score
- keep deterministic tiebreakers on `target`

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_ranked_hotwords_prefer_manual_and_contextual_matches_over_raw_count --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add /Users/zac/code/github/asr/Handy/src-tauri/src/managers/hotword.rs
git commit -m "feat: rank hotwords by context and relevance"
```

## Task 4: Replace Noisy Injection With Grouped Prompt Context

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs`
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs` (add local unit tests at bottom if absent)

- [ ] **Step 1: Write failing grouped-reference tests**

Add tests near the bottom of `pipeline.rs`:

```rust
#[test]
fn test_build_rewrite_term_reference_groups_terms_and_limits_noise() {
    let rendered = build_rewrite_term_reference_from_ranked(
        vec![
            mock_hotword("skill", vec!["scale"], "term", "manual", 5, 1),
            mock_hotword("Nate", vec![], "person", "manual", 2, 1),
        ],
        "当前 skill 的状态",
        "把 scale 改成 skill",
        &["OAuth".to_string()],
    );

    assert!(rendered.contains("[当前文稿术语]"));
    assert!(rendered.contains("[术语缩写类热词]"));
    assert!(rendered.contains("skill（常见误识别：scale）"));
    assert!(!rendered.contains("无关热词"));
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_build_rewrite_term_reference_groups_terms_and_limits_noise --lib
```

Expected: FAIL because the helper still builds from raw flat lists.

- [ ] **Step 3: Split prompt injection into grouped sections**

Refactor `build_rewrite_term_reference` in `src-tauri/src/actions/post_process/pipeline.rs` so it:

- gets ranked hotwords from `HotwordManager::get_ranked_hotwords`
- always shows:
  - `[当前文稿术语]`
  - `[本次口述术语]`
- conditionally shows:
  - `[人名类热词]`
  - `[产品品牌类热词]`
  - `[术语缩写类热词]`
  - `[其他热词]`

Rules:

- manual hotwords stay eligible even if current hit score is low
- aliases are only rendered for top-scoring items
- each bucket has a hard limit:
  - document terms: 8
  - spoken terms: 8
  - person: 4
  - product: 4
  - domain/abbreviation: 8
  - other: 4

- [ ] **Step 4: Keep manual hotwords visible without full-dump behavior**

In the same helper, reserve a short `[必须保真的术语]` bucket for user-created manual hotwords that are either:

- matched in current text
- matched in spoken instruction
- or belong to the current app/scenario with non-zero affinity

This prevents user-added words from disappearing while still avoiding full-table prompt dumps.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_build_rewrite_term_reference_groups_terms_and_limits_noise --lib
```

Expected: PASS.

- [ ] **Step 6: Run prompt/regression tests**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test prompt_builder --lib
cargo test reference_resolver --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add /Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs
git commit -m "feat: group hotword prompt injection by contextual relevance"
```

## Task 5: Extend Standard Post-Processing to Use Ranked Hotwords

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/prompt_builder.rs`
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/prompt_builder.rs`

- [ ] **Step 1: Write a failing post-process injection test**

Add a test that verifies prompt builder receives a compact ranked injection instead of a full unsorted list.

```rust
#[test]
fn test_post_process_prompt_uses_ranked_hotword_injection() {
    // Build prompt with contextual hotwords and assert only relevant grouped entries remain.
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_post_process_prompt_uses_ranked_hotword_injection --lib
```

Expected: FAIL because normal post-processing still uses `build_injection`.

- [ ] **Step 3: Route normal post-process hotword loading through ranked retrieval**

In `src-tauri/src/actions/post_process/pipeline.rs`, replace the existing `build_injection` call used by normal post-processing with a ranked/filtering adapter:

```rust
let ranked_hotwords = hotword_manager.get_ranked_hotwords(
    effective_scenario,
    app_name.as_deref(),
    Some(&current_input_content),
    Some(transcription),
)?;
```

Then convert the ranked subset into the existing `HotwordInjection` shape used by `PromptBuilder`.

- [ ] **Step 4: Update prompt builder expectations**

In `src-tauri/src/actions/post_process/prompt_builder.rs`, keep the current section rendering but ensure ranked entries can be passed through without expanding huge alias sets. Limit alias rendering for each entry to `take(3)`.

- [ ] **Step 5: Run focused and regression tests**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo test test_post_process_prompt_uses_ranked_hotword_injection --lib
cargo test prompt_builder --lib
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add /Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs /Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/prompt_builder.rs
git commit -m "feat: apply ranked hotword loading to post-processing prompts"
```

## Task 6: Verify End-to-End Hotword Behavior

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/docs/superpowers/specs/2026-03-28-votype-selection-and-review-rewrite-design.md` (only if implementation behavior diverges)
- Test: manual verification only

- [ ] **Step 1: Run full backend verification**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri
cargo fmt --check
cargo test --lib
```

Expected: PASS.

- [ ] **Step 2: Run frontend formatting verification if prompt/render contracts changed**

Run:

```bash
cd /Users/zac/code/github/asr/Handy
bunx prettier --check src/review/ReviewWindow.tsx src/review/ReviewWindow.css src/bindings.ts
```

Expected: PASS.

- [ ] **Step 3: Manual test in review window with term correction**

Scenario:

- Current text: `我们对于 Jason 数据，还有 skill 的能力，都应该准确地表达出来。`
- Voice instruction: `把这段话里的 Jason 改成 GSON`

Expected:

- rewrite output changes `Jason` to `GSON`
- `[term_reference]` in logs shows only a short grouped set, not a full-table dump
- logs show the matched hotword being recorded after final output

- [ ] **Step 4: Manual test in review window with non-terminology formatting**

Scenario:

- Current text: `继续测试当前模型的状态。`
- Voice instruction: `不要标点符号`

Expected:

- prompt term reference is minimal
- output removes punctuation
- no noisy unrelated hotwords dominate the request

- [ ] **Step 5: Manual test in app-context-sensitive paths**

Scenario:

- In `Cursor` or `Code`, test a term like `skill`
- In a browser window, test a browser-centric term already present in hotwords

Expected:

- app-relevant term ranks higher than unrelated high-count terms
- usage stats increment after successful final output

- [ ] **Step 6: Commit**

```bash
git add /Users/zac/code/github/asr/Handy/docs/superpowers/specs/2026-03-28-votype-selection-and-review-rewrite-design.md
git commit -m "docs: sync hotword contextual loading behavior"
```

## Self-Review

- Spec coverage:
  - user-added hotwords keep strong effect: covered by Tasks 3-4
  - app/scenario relevance: covered by Tasks 2-3
  - final-output feedback loop: covered by Task 2
  - compact grouped prompt injection: covered by Tasks 4-5
- Placeholder scan:
  - No `TODO`, `TBD`, or vague “handle edge cases” steps remain.
- Type consistency:
  - New telemetry fields are consistently named `recent_use_count`, `app_affinity`, `scenario_affinity`
  - ranking API names stay consistent across tasks: `record_output_hits`, `get_contextual_hotwords`, `get_ranked_hotwords`

Plan complete and saved to `/Users/zac/code/github/asr/Handy/docs/superpowers/plans/2026-03-28-hotword-contextual-loading.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
