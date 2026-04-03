# ASR Corrections Prompt Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject high-confidence ASR correction pairs (originals → target) into the polish prompt so the LLM knows which words are likely misrecognized and should be replaced.

**Architecture:** Extend `HotwordInjection` with a `correction_pairs` field populated from `Hotword.originals` + `use_count`/`user_override`. Add a new `[asr-corrections]` section to the user message in `prompt_builder.rs`, with star ratings indicating replacement confidence. Filter to only pairs whose originals appear in the current input text.

**Tech Stack:** Rust (Tauri backend)

---

### Task 1: Add `CorrectionPair` struct and extend `HotwordInjection`

**Files:**

- Modify: `src-tauri/src/managers/hotword.rs:97-109`

- [ ] **Step 1: Add `CorrectionPair` struct and extend `HotwordInjection`**

Add right after the existing `HotwordInjection` struct (line 103):

```rust
/// A confirmed ASR misrecognition → correction mapping with confidence score.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorrectionPair {
    /// The misrecognized form (e.g. "scale")
    pub original: String,
    /// The correct form (e.g. "skill")
    pub target: String,
    /// Star rating: 1 = low, 2 = medium, 3 = high confidence
    pub stars: u8,
}
```

Add a new field to `HotwordInjection`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HotwordInjection {
    pub person_names: Vec<HotwordEntry>,
    pub product_names: Vec<HotwordEntry>,
    pub domain_terms: Vec<HotwordEntry>,
    pub hotwords: Vec<HotwordEntry>,
    pub correction_pairs: Vec<CorrectionPair>,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p votype-app-lib 2>&1 | head -20`
Expected: compiles clean (no new references to `correction_pairs` yet)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/managers/hotword.rs
git commit -m "Add CorrectionPair struct and correction_pairs field to HotwordInjection"
```

---

### Task 2: Populate `correction_pairs` in `build_injection_from_ranked`

**Files:**

- Modify: `src-tauri/src/managers/hotword.rs:931-976` (`build_injection_from_ranked`)

- [ ] **Step 1: Add star-rating helper**

Add a private helper function before `build_injection_from_ranked`:

```rust
/// Compute star rating for a correction pair based on usage evidence.
fn correction_star_rating(use_count: i64, user_override: bool) -> u8 {
    if user_override || use_count >= 5 {
        3
    } else if use_count >= 2 {
        2
    } else {
        1
    }
}
```

- [ ] **Step 2: Populate `correction_pairs` inside `build_injection_from_ranked`**

After the existing `for ranked_hotword in ranked` loop (before `injection` is returned at line 975), add:

```rust
// Collect correction pairs from hotwords that have originals
for ranked_hotword in ranked {
    let hw = &ranked_hotword.hotword;
    if hw.originals.is_empty() || hw.status != "active" {
        continue;
    }
    let stars = correction_star_rating(hw.use_count, hw.user_override);
    for orig in &hw.originals {
        injection.correction_pairs.push(CorrectionPair {
            original: orig.clone(),
            target: hw.target.clone(),
            stars,
        });
    }
}
// Sort by stars descending, then alphabetically for stability
injection.correction_pairs.sort_by(|a, b| {
    b.stars.cmp(&a.stars).then_with(|| a.original.cmp(&b.original))
});
// Cap at 15 pairs
injection.correction_pairs.truncate(15);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p votype-app-lib 2>&1 | head -20`
Expected: compiles clean

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/managers/hotword.rs
git commit -m "Populate correction_pairs from hotword originals with star ratings"
```

---

### Task 3: Add `[asr-corrections]` rendering in `prompt_builder.rs`

**Files:**

- Modify: `src-tauri/src/actions/post_process/prompt_builder.rs`

- [ ] **Step 1: Import `CorrectionPair` at the top**

Add to the existing import at line 1:

```rust
use crate::managers::hotword::{CorrectionPair, HotwordEntry, HotwordInjection};
```

- [ ] **Step 2: Add `AsrCorrections` to `FieldTag` enum**

Add `AsrCorrections` variant to the `FieldTag` enum (after `AsrReference`, before `InputText`):

```rust
AsrCorrections,
```

Add its `description` match arm:

```rust
FieldTag::AsrCorrections => "asr-corrections: known ASR misrecognition patterns with confidence ratings (★★★ = very likely ASR error, always replace; ★★ = likely; ★ = possible). When input-text contains a word matching the left side, strongly prefer replacing it with the right side",
```

Add its `placeholder` match arm:

```rust
FieldTag::AsrCorrections => "{{asr-corrections}}",
```

- [ ] **Step 3: Add `render_correction_block` function**

Add after the existing `render_asr_reference_block` function (around line 265):

```rust
fn render_correction_block(pairs: &[CorrectionPair], input_text: &str) -> Option<String> {
    if pairs.is_empty() {
        return None;
    }
    // Only include pairs whose original appears in the input text (case-insensitive)
    let input_lower = input_text.to_lowercase();
    let relevant: Vec<&CorrectionPair> = pairs
        .iter()
        .filter(|p| input_lower.contains(&p.original.to_lowercase()))
        .collect();
    if relevant.is_empty() {
        return None;
    }
    let lines: Vec<String> = relevant
        .iter()
        .map(|p| {
            let stars = "★".repeat(p.stars as usize);
            format!("- {} → {} {}", p.original, p.target, stars)
        })
        .collect();
    Some(format!("[asr-corrections]\n{}", lines.join("\n")))
}

fn render_plain_corrections(pairs: &[CorrectionPair], input_text: &str) -> Option<String> {
    if pairs.is_empty() {
        return None;
    }
    let input_lower = input_text.to_lowercase();
    let relevant: Vec<&CorrectionPair> = pairs
        .iter()
        .filter(|p| input_lower.contains(&p.original.to_lowercase()))
        .collect();
    if relevant.is_empty() {
        return None;
    }
    let lines: Vec<String> = relevant
        .iter()
        .map(|p| {
            let stars = "★".repeat(p.stars as usize);
            format!("- {} → {} {}", p.original, p.target, stars)
        })
        .collect();
    Some(lines.join("\n"))
}
```

- [ ] **Step 4: Wire `AsrCorrections` into `PromptBuilder::build()`**

In the `build()` method, after extracting `hotwords` from the injection (around line 454), add:

```rust
let correction_pairs = hotword_injection
    .as_ref()
    .map(|h| h.correction_pairs.clone())
    .unwrap_or_default();
```

After the `if !asr_reference_items.is_empty()` block that pushes `FieldTag::AsrReference` (around line 479), add:

```rust
if !correction_pairs.is_empty() {
    present_fields.push(FieldTag::AsrCorrections);
}
```

In the explicit field references match block (around line 492-510), add the `AsrCorrections` arm:

```rust
FieldTag::AsrCorrections => render_plain_corrections(&correction_pairs, transcription),
```

In the input protocol processing rules (function `build_input_protocol_note`, around line 77-87), add after the hotword reference rules:

```rust
if fields.iter().any(|f| *f == FieldTag::AsrCorrections) {
    rules.push(
        "- asr-corrections lists known ASR misrecognition patterns with confidence ratings (★★★ = very likely, ★★ = likely, ★ = possible); when input-text contains a word matching the left side, strongly prefer replacing it with the right side".to_string(),
    );
}
```

- [ ] **Step 5: Wire `AsrCorrections` into the fallback (non-explicit) section rendering**

In the user message section building (around line 606-610), after the `render_asr_reference_block` block, add:

```rust
if !explicit_field_references.contains(&FieldTag::AsrCorrections) {
    if let Some(block) = render_correction_block(&correction_pairs, transcription) {
        sections.push(block);
    }
}
```

- [ ] **Step 6: Add `[asr-corrections]` to `sanitize_history_entry` filter**

In `sanitize_history_entry` (line 179-209), add a filter line:

```rust
&& !trimmed.starts_with("[asr-corrections]")
```

- [ ] **Step 7: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p votype-app-lib 2>&1 | head -20`
Expected: compiles clean

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/actions/post_process/prompt_builder.rs
git commit -m "Add [asr-corrections] section to polish prompt with star-rated correction pairs"
```

---

### Task 4: Add tests for the new correction block rendering

**Files:**

- Modify: `src-tauri/src/actions/post_process/prompt_builder.rs` (tests module, starting ~line 639)

- [ ] **Step 1: Write test for `render_correction_block` filtering**

```rust
#[test]
fn test_render_correction_block_filters_by_input() {
    let pairs = vec![
        CorrectionPair { original: "scale".to_string(), target: "skill".to_string(), stars: 3 },
        CorrectionPair { original: "cloud code".to_string(), target: "Claude Code".to_string(), stars: 3 },
        CorrectionPair { original: "brolet".to_string(), target: "blocklet".to_string(), stars: 2 },
    ];
    // Only "scale" appears in input
    let result = render_correction_block(&pairs, "上次那个 scale 我又忘记了");
    assert!(result.is_some());
    let block = result.unwrap();
    assert!(block.contains("[asr-corrections]"));
    assert!(block.contains("scale → skill ★★★"));
    assert!(!block.contains("cloud code"));
    assert!(!block.contains("brolet"));
}
```

- [ ] **Step 2: Write test for empty corrections when no match**

```rust
#[test]
fn test_render_correction_block_returns_none_when_no_match() {
    let pairs = vec![
        CorrectionPair { original: "scale".to_string(), target: "skill".to_string(), stars: 3 },
    ];
    let result = render_correction_block(&pairs, "今天天气不错");
    assert!(result.is_none());
}
```

- [ ] **Step 3: Write integration test for full prompt build with corrections**

```rust
#[test]
fn test_build_with_correction_pairs_in_injection() {
    let prompt = make_prompt("# Expert\nProcess input.");

    let built = PromptBuilder::new(&prompt, "上次那个 scale 我又忘记了")
        .hotword_injection(Some(HotwordInjection {
            person_names: vec![],
            product_names: vec![],
            domain_terms: vec![HotwordEntry {
                target: "skill".to_string(),
                aliases: vec![],
            }],
            hotwords: vec![],
            correction_pairs: vec![
                CorrectionPair { original: "scale".to_string(), target: "skill".to_string(), stars: 3 },
                CorrectionPair { original: "brolet".to_string(), target: "blocklet".to_string(), stars: 2 },
            ],
        }))
        .build();

    let input = built.user_message.unwrap();
    // scale appears in input, so correction shows
    assert!(input.contains("[asr-corrections]"));
    assert!(input.contains("scale → skill ★★★"));
    // brolet not in input, so filtered out
    assert!(!input.contains("brolet"));
    // domain-terms still present
    assert!(input.contains("[domain-terms] skill"));
    // system prompt has the protocol note
    assert!(input.contains("[input-text]"));
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/zac/code/github/asr/Handy && cargo test -p votype-app-lib prompt_builder 2>&1 | tail -30`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/post_process/prompt_builder.rs
git commit -m "Add tests for asr-corrections prompt rendering and filtering"
```

---

### Task 5: Full compilation and existing test verification

**Files:** None (verification only)

- [ ] **Step 1: Run full project compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p votype-app-lib 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 2: Run all existing tests to check for regressions**

Run: `cd /Users/zac/code/github/asr/Handy && cargo test -p votype-app-lib 2>&1 | tail -30`
Expected: all tests pass, no regressions

- [ ] **Step 3: Fix any warnings**

Address any compiler warnings introduced by the changes. Common: unused imports, dead code.
