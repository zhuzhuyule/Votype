# Smart Token Optimization Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce LLM token consumption on the real-time recording path by 50-80% through local pre-filtering, tiered prompt strategy, English-first system prompts, and context budget control.

**Architecture:** Insert a lightweight `TranscriptionClassifier` before any LLM logic. It classifies input into three modes — Skip (0 tokens), Lite AI (minimal prompt), Full AI (current full pipeline with English prompts + budget). PromptBuilder gains a token budget that trims context injection. Built-in system prompts are converted to English. User Skills gain an optional `instructions_en` field with one-click translation.

**Tech Stack:** Rust (new `classifier` module, PromptBuilder changes), external `.md` prompt files, React/TypeScript (Skill editor bilingual UI), existing `tiktoken-rs` for token estimation.

---

## File Map

| File                                                                             | Responsibility                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src-tauri/src/actions/post_process/classifier.rs`                               | **New** — TranscriptionClassifier: Mode 0/1/2 classification |
| `src-tauri/src/actions/post_process/mod.rs`                                      | Register classifier module, export types                     |
| `src-tauri/src/actions/post_process/pipeline.rs`                                 | Insert classifier at entry, apply Lite/Full strategy         |
| `src-tauri/src/actions/post_process/extensions.rs`                               | Insert classifier at multi-model entry                       |
| `src-tauri/src/actions/post_process/prompt_builder.rs`                           | Add token budget control, context trimming                   |
| `src-tauri/src/actions/post_process/pipeline.rs`                                 | Replace VotypeRewrite inline prompt with English version     |
| `src-tauri/resources/prompts/system_skill_routing.md`                            | Rewrite in English                                           |
| `src-tauri/resources/prompts/system_confidence_check.md`                         | Rewrite in English                                           |
| `src-tauri/resources/prompts/system_correction_analysis.md`                      | Rewrite in English                                           |
| `src-tauri/resources/prompts/system_lite_polish.md`                              | **New** — Lite mode English prompt template                  |
| `src-tauri/src/settings.rs`                                                      | Add `instructions_en` to Skill struct                        |
| `src-tauri/src/commands/text.rs`                                                 | Add `translate_skill_instructions` command                   |
| `src/components/settings/post-processing/prompts/components/ResizableEditor.tsx` | Bilingual view toggle + translate button                     |
| `src/components/settings/post-processing/prompts/components/PromptEditor.tsx`    | Pass bilingual props                                         |

---

## Task 1: TranscriptionClassifier Module

**Files:**

- Create: `src-tauri/src/actions/post_process/classifier.rs`
- Modify: `src-tauri/src/actions/post_process/mod.rs`

- [ ] **Step 1: Create classifier module with types**

Create `src-tauri/src/actions/post_process/classifier.rs`:

```rust
/// Classification result for transcription input.
/// Determines the LLM processing tier to minimize token consumption.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionMode {
    /// No LLM needed — output raw transcription as-is (0 tokens).
    Skip,
    /// Lightweight polish — minimal English system prompt, hotwords only, no history/references.
    Lite,
    /// Full pipeline — complete English prompt with budget-controlled context injection.
    Full,
}

/// Classify a transcription to determine the appropriate processing mode.
///
/// Decision logic (evaluated in order):
/// 1. Mode::Skip — pure filler words, repeated chars, ASR noise, no real content
/// 2. Mode::Lite — simple content, no proper nouns, no instructions/questions, ≤15 chars as boost
/// 3. Mode::Full — everything else (default)
pub fn classify(
    transcription: &str,
    streaming_transcription: Option<&str>,
) -> TranscriptionMode {
    let text = transcription.trim();

    // Empty or whitespace-only
    if text.is_empty() {
        return TranscriptionMode::Skip;
    }

    // Strip all whitespace/punctuation to get "core" content
    let core: String = text
        .chars()
        .filter(|c| c.is_alphanumeric() || *c > '\u{2E7F}') // keep CJK + alphanumeric
        .collect();

    if core.is_empty() {
        return TranscriptionMode::Skip;
    }

    // --- Mode 0: Skip rules ---

    // Pure filler / interjection (Chinese)
    if is_chinese_filler(&core) {
        return TranscriptionMode::Skip;
    }

    // Pure filler / interjection (English)
    if is_english_filler(&core) {
        return TranscriptionMode::Skip;
    }

    // Repeated character pattern: same char 3+ times (e.g. "好好好", "hhh")
    if is_repeated_chars(&core) {
        return TranscriptionMode::Skip;
    }

    // ASR noise markers
    if is_asr_noise(text) {
        return TranscriptionMode::Skip;
    }

    // --- Mode 1: Lite rules (all must hold) ---

    let char_count = text.chars().count();
    let has_proper_noun_signal = has_proper_noun_features(text);
    let has_instruction_signal = has_instruction_features(text);
    let has_complex_structure = has_complex_sentence_features(text);

    // Lite mode: simple, short, no special features
    if !has_proper_noun_signal
        && !has_instruction_signal
        && !has_complex_structure
        && char_count <= 15
    {
        return TranscriptionMode::Lite;
    }

    // --- Default: Full ---
    TranscriptionMode::Full
}

/// Chinese filler words: 啊嗯哦哈呃嗨噢额呀吧嘛哎唉
fn is_chinese_filler(core: &str) -> bool {
    if core.is_empty() {
        return false;
    }
    core.chars()
        .all(|c| "啊嗯哦哈呃嗨噢额呀吧嘛哎唉嘞呗喂诶".contains(c))
}

/// English filler: um, uh, hmm, ah, oh, huh, mhm, etc.
fn is_english_filler(core: &str) -> bool {
    let lower = core.to_lowercase();
    // Check if core is composed entirely of filler syllables
    let fillers = [
        "um", "uh", "hmm", "ah", "oh", "huh", "mhm", "uhh", "umm", "ahh",
        "hmm", "er", "erm", "hm", "ok", "okay", "yeah", "yep", "nah", "nope",
    ];
    fillers.iter().any(|f| lower == *f)
}

/// Repeated character: "好好好", "哈哈哈", "hhh", etc.
fn is_repeated_chars(core: &str) -> bool {
    if core.chars().count() < 3 {
        return false;
    }
    let first = core.chars().next().unwrap();
    core.chars().all(|c| c == first)
}

/// ASR noise: [NR], [BLANK], standalone punctuation
fn is_asr_noise(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed == "[NR]"
        || trimmed == "[BLANK]"
        || trimmed == "[ Silence ]"
        || trimmed == "[silence]"
        || trimmed.chars().all(|c| c.is_ascii_punctuation() || c.is_whitespace())
}

/// Detect proper noun signals: uppercase-starting words, CJK+Latin mix entities, number+unit
fn has_proper_noun_features(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();

    // Uppercase-starting word (not sentence start) — e.g. "meeting with John"
    if words.len() > 1 {
        for word in &words[1..] {
            if word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
                && word.len() > 1
            {
                return true;
            }
        }
    }

    // CJK + Latin mix in close proximity — e.g. "用React做" or "API接口"
    let chars: Vec<char> = text.chars().collect();
    for window in chars.windows(2) {
        let a_cjk = window[0] > '\u{2E7F}';
        let b_latin = window[1].is_ascii_alphanumeric();
        let a_latin = window[0].is_ascii_alphanumeric();
        let b_cjk = window[1] > '\u{2E7F}';
        if (a_cjk && b_latin) || (a_latin && b_cjk) {
            return true;
        }
    }

    // Number + unit pattern — e.g. "3点", "5个", "10分钟"
    let has_digit = text.chars().any(|c| c.is_ascii_digit());
    let has_unit = text.contains('点') || text.contains('个') || text.contains('分')
        || text.contains('小时') || text.contains('天');
    if has_digit && has_unit {
        return true;
    }

    false
}

/// Detect instruction/question signals
fn has_instruction_features(text: &str) -> bool {
    // Question marks
    if text.contains('？') || text.contains('?') {
        return true;
    }

    // Chinese instruction prefixes
    let cn_triggers = ["帮我", "请", "麻烦", "能不能", "可以", "怎么", "如何", "什么"];
    for trigger in &cn_triggers {
        if text.contains(trigger) {
            return true;
        }
    }

    // English instruction prefixes (case-insensitive check on first word)
    let lower = text.to_lowercase();
    let en_triggers = [
        "help ", "please ", "translate ", "summarize ", "explain ", "fix ",
        "can you", "could you", "how to", "what is", "write ",
    ];
    for trigger in &en_triggers {
        if lower.starts_with(trigger) || lower.contains(&format!(" {}", trigger.trim())) {
            return true;
        }
    }

    false
}

/// Detect complex sentence structure
fn has_complex_sentence_features(text: &str) -> bool {
    // Multiple clauses (Chinese comma/semicolons)
    let clause_separators = text.chars().filter(|c| {
        *c == '，' || *c == '；' || *c == '、' || *c == ',' || *c == ';'
    }).count();
    if clause_separators >= 2 {
        return true;
    }

    // List patterns
    if text.contains("第一") || text.contains("第二")
        || text.contains("首先") || text.contains("其次")
        || text.contains("1.") || text.contains("2.")
    {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Mode 0: Skip ---

    #[test]
    fn test_empty_input() {
        assert_eq!(classify("", None), TranscriptionMode::Skip);
        assert_eq!(classify("   ", None), TranscriptionMode::Skip);
    }

    #[test]
    fn test_chinese_filler() {
        assert_eq!(classify("啊啊啊", None), TranscriptionMode::Skip);
        assert_eq!(classify("嗯嗯", None), TranscriptionMode::Skip);
        assert_eq!(classify("哦", None), TranscriptionMode::Skip);
        assert_eq!(classify("哈哈哈", None), TranscriptionMode::Skip);
    }

    #[test]
    fn test_english_filler() {
        assert_eq!(classify("um", None), TranscriptionMode::Skip);
        assert_eq!(classify("uh", None), TranscriptionMode::Skip);
        assert_eq!(classify("hmm", None), TranscriptionMode::Skip);
        assert_eq!(classify("okay", None), TranscriptionMode::Skip);
    }

    #[test]
    fn test_repeated_chars() {
        assert_eq!(classify("好好好", None), TranscriptionMode::Skip);
        assert_eq!(classify("对对对", None), TranscriptionMode::Skip);
        assert_eq!(classify("hhh", None), TranscriptionMode::Skip);
    }

    #[test]
    fn test_asr_noise() {
        assert_eq!(classify("[NR]", None), TranscriptionMode::Skip);
        assert_eq!(classify("[BLANK]", None), TranscriptionMode::Skip);
        assert_eq!(classify("...", None), TranscriptionMode::Skip);
        assert_eq!(classify("。", None), TranscriptionMode::Skip);
    }

    // --- Mode 1: Lite ---

    #[test]
    fn test_simple_short_text() {
        assert_eq!(classify("好的", None), TranscriptionMode::Lite);
        assert_eq!(classify("收到", None), TranscriptionMode::Lite);
        assert_eq!(classify("明天开会", None), TranscriptionMode::Lite);
        assert_eq!(classify("下午见", None), TranscriptionMode::Lite);
    }

    // --- Mode 2: Full ---

    #[test]
    fn test_instruction_triggers_full() {
        assert_eq!(classify("帮我翻译一下", None), TranscriptionMode::Full);
        assert_eq!(classify("请总结", None), TranscriptionMode::Full);
        assert_eq!(classify("这是什么", None), TranscriptionMode::Full);
    }

    #[test]
    fn test_proper_noun_triggers_full() {
        assert_eq!(classify("用React做", None), TranscriptionMode::Full);
        assert_eq!(classify("和John开会", None), TranscriptionMode::Full);
        assert_eq!(classify("下午3点开会", None), TranscriptionMode::Full);
    }

    #[test]
    fn test_long_text_triggers_full() {
        assert_eq!(
            classify("今天下午讨论一下项目进度和后续安排", None),
            TranscriptionMode::Full
        );
    }

    #[test]
    fn test_complex_structure_triggers_full() {
        assert_eq!(
            classify("第一做A，第二做B", None),
            TranscriptionMode::Full
        );
    }
}
```

- [ ] **Step 2: Register module in mod.rs**

Add to `src-tauri/src/actions/post_process/mod.rs` after existing module declarations:

```rust
pub(crate) mod classifier;
```

And add re-export:

```rust
pub use classifier::{classify as classify_transcription, TranscriptionMode};
```

- [ ] **Step 3: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classifier`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/classifier.rs src-tauri/src/actions/post_process/mod.rs
git commit -m "Add TranscriptionClassifier for Mode 0/1/2 input classification"
```

---

## Task 2: Lite Mode Prompt Template

**Files:**

- Create: `src-tauri/resources/prompts/system_lite_polish.md`

- [ ] **Step 1: Create the Lite prompt**

Create `src-tauri/resources/prompts/system_lite_polish.md`:

```markdown
You are a speech-to-text post-processor. Clean up the transcription:

- Fix obvious ASR errors and typos
- Normalize punctuation
- Keep the original meaning, tone, and language exactly
- Do not add, remove, or rephrase content
- Output only the corrected text, nothing else
```

This is ~40 English tokens vs the current ~500-2000 tokens for full Chinese prompts.

- [ ] **Step 2: Commit**

```bash
git add src-tauri/resources/prompts/system_lite_polish.md
git commit -m "Add lightweight English prompt for Lite mode polish"
```

---

## Task 3: Integrate Classifier into Single-Model Pipeline

**Files:**

- Modify: `src-tauri/src/actions/post_process/pipeline.rs`

- [ ] **Step 1: Add classifier call at entry**

In `pipeline.rs::maybe_post_process_transcription`, insert the classifier **after** the existing `__SKIP_POST_PROCESS__` check (line ~234) and **before** the length routing block (line ~237):

```rust
    // --- Smart Token Optimization: classify input ---
    let transcription_mode = super::classifier::classify(
        transcription,
        streaming_transcription,
    );

    if transcription_mode == super::classifier::TranscriptionMode::Skip {
        info!(
            "[PostProcess] Classifier: Skip — input classified as noise/filler (len={})",
            transcription.chars().count()
        );
        // Return original text directly, 0 token cost
        return (
            Some(transcription.to_string()),
            None,
            None,
            false,
            None,
            None,
            None,
        );
    }

    info!(
        "[PostProcess] Classifier: {:?} (len={})",
        transcription_mode,
        transcription.chars().count()
    );
```

- [ ] **Step 2: Apply Lite mode strategy in the main processing loop**

Inside the `loop { ... }` block (around line ~810), after the PromptBuilder is constructed but before `execute_llm_request_with_messages` is called, wrap the builder configuration to respect mode:

```rust
    // Apply tier strategy based on classifier result
    let mut builder = super::prompt_builder::PromptBuilder::new(&prompt, transcription_content)
        .streaming_transcription(streaming_transcription)
        .selected_text(selected_text.as_deref())
        .app_name(app_name.as_deref())
        .window_title(window_title.as_deref())
        .app_language(&settings.app_language);

    if transcription_mode == super::classifier::TranscriptionMode::Lite {
        // Lite mode: skip history and references, keep only hotwords
        builder = builder
            .hotword_injection(hotword_injection)
            .injection_policy(super::prompt_builder::InjectionPolicy {
                include_streaming_reference: false,
                include_history_context: false,
                include_hotword_reference: true,
            });
        // Override prompt to use lite template
        // (handled by PromptTierStrategy in Task 5)
    } else {
        builder = builder
            .history_entries(history_entries)
            .hotword_injection(hotword_injection)
            .resolved_references(refs_content)
            .injection_policy(super::prompt_builder::InjectionPolicy::for_post_process(
                settings,
            ));
    }

    builder = builder.raw_transcription(transcription_original);
    let built = builder.build();
```

- [ ] **Step 3: Skip intent routing for Lite mode**

In the intent detection block (around line ~495), add a guard:

```rust
    if !effective_skill_mode
        && !is_explicit
        && override_prompt_id.is_none()
        && !transcription.trim().is_empty()
        && has_selected_text
        && transcription_mode != super::classifier::TranscriptionMode::Lite  // Skip routing for Lite
    {
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Integrate TranscriptionClassifier into single-model pipeline"
```

---

## Task 4: Integrate Classifier into Multi-Model Path

**Files:**

- Modify: `src-tauri/src/actions/post_process/extensions.rs`

- [ ] **Step 1: Add classifier at multi-model entry**

In `extensions.rs::multi_post_process_transcription`, insert after the `items.is_empty()` check (around line ~90):

```rust
    // Smart Token Optimization: classify input for multi-model path
    let transcription_mode = super::classifier::classify(
        transcription,
        streaming_transcription,
    );

    if transcription_mode == super::classifier::TranscriptionMode::Skip {
        info!(
            "[MultiModel] Classifier: Skip — noise/filler input, returning empty results"
        );
        return Vec::new();
    }

    // For Lite mode in multi-model: reduce to single preferred model only
    let items = if transcription_mode == super::classifier::TranscriptionMode::Lite {
        info!(
            "[MultiModel] Classifier: Lite — reducing to single model for short input"
        );
        // Use only the preferred model or first item
        let preferred = preferred_model_id_for_lite(&settings, &items);
        vec![preferred]
    } else {
        items
    };
```

Add helper function:

```rust
fn preferred_model_id_for_lite<'a>(
    settings: &crate::settings::AppSettings,
    items: &[&'a crate::settings::MultiModelPostProcessItem],
) -> &'a crate::settings::MultiModelPostProcessItem {
    // Prefer the model with highest manual pick count, or first item
    if let Some(preferred_id) = &settings.multi_model_preferred_id {
        if let Some(item) = items.iter().find(|i| &i.id == preferred_id) {
            return item;
        }
    }
    items[0]
}
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/actions/post_process/extensions.rs
git commit -m "Integrate TranscriptionClassifier into multi-model path"
```

---

## Task 5: Convert Built-in Prompts to English

**Files:**

- Modify: `src-tauri/resources/prompts/system_skill_routing.md`
- Modify: `src-tauri/resources/prompts/system_confidence_check.md`
- Modify: `src-tauri/resources/prompts/system_correction_analysis.md`
- Modify: `src-tauri/src/actions/post_process/pipeline.rs` (VotypeRewrite inline prompt)

- [ ] **Step 1: Rewrite system_skill_routing.md in English**

Replace the entire file with an equivalent English version. Key requirements:

- Preserve all functional logic (confidence thresholds, routing rules, input_source decisions)
- Keep `{{SKILL_LIST}}` and `{{SELECTED_TEXT_NOTE}}` template variables
- Keep JSON output format specification
- Remove verbose Chinese examples, replace with compact English examples
- Target: ~800 words (~1000 tokens) vs current ~1800 chars (~2700 tokens)

````markdown
# Intent Router

Classify the user's speech transcription to determine which Skill should handle it, and decide the input source.

## Available Skills

{{SKILL_LIST}}{{SELECTED_TEXT_NOTE}}

## Routing Rules (by priority)

1. **Default first**: If the user is simply speaking, narrating, taking notes, writing code, thinking aloud, or making observations → return "default"

2. **Route only on clear action intent**: The user must use an imperative ("translate...", "summarize...", "help me...") or ask an explicit question ("what is...?", "how to...?") that closely matches a Skill's description → return that Skill ID

3. **When in doubt, return "default"**

## Input Source Decision

| Value     | When to use                                                  | Example                                                                      |
| --------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `select`  | User's instruction targets selected text                     | "translate this", "check this"                                               |
| `output`  | Use the full transcription                                   | Pure instruction or pure content                                             |
| `extract` | Speech mixes instruction + content; extract the content part | "translate: the weather is nice today" → extract "the weather is nice today" |

## Output Format

Return strict JSON only:

```json
{
  "skill_id": "exact id from Skills list, or default",
  "confidence": 0-100,
  "input_source": "select|output|extract",
  "extracted_content": "only when input_source is extract, else null"
}
```
````

## Important

- `skill_id` must exactly match an id from the Skills list
- Normal speech, note-taking, coding, thinking → always "default"
- If unsure → "default"

````

- [ ] **Step 2: Rewrite system_confidence_check.md in English**

Replace with English version. Target: ~600 words (~800 tokens) vs current ~1500 chars (~2200 tokens).

```markdown
# Polish Quality Assessment

Evaluate speech-to-text polish quality and extract word-level changes.

## Input

Original: {{source_text}}
Polished: {{target_text}}

## Task

1. Extract all word-level changes (A → B) between original and polished text
2. For each change, determine if it's an ASR recognition error (suitable for hotword table)
3. Provide overall confidence score

## Change Classification

### is_hotword = true
- Homophone, near-sound, or visually similar character substitution
- Proper noun recognition error (person, place, brand, technical term)
- English word/abbreviation/casing ASR error
- Semantically unrelated words that are clearly recognition errors

### is_hotword = false
- Grammar fixes, word order adjustments, expression improvements
- Punctuation, spacing, formatting normalization
- Filler word removal, repetition cleanup
- Synonym replacement, tone adjustment

## Rules
- Only output items where original ≠ corrected
- When uncertain, default to is_hotword = false
- Do not pad with unchanged content

## Output

Strict JSON only:

```json
{
  "confidence": 85,
  "changes": [
    {"original": "A", "corrected": "B", "is_hotword": true, "category": "term"},
    {"original": "C", "corrected": "D", "is_hotword": false}
  ]
}
````

- confidence: 0-100 overall quality score (90+: excellent, 70-89: good, 50-69: possible drift, <50: needs review)
- category (only when is_hotword=true): "person", "term", "brand", or "abbreviation"

````

- [ ] **Step 3: Rewrite system_correction_analysis.md in English**

Replace with English version. Target: ~500 words (~700 tokens) vs current ~1200 chars (~1800 tokens).

- [ ] **Step 4: Rewrite VotypeRewrite inline prompt to English**

In `pipeline.rs` line 76, replace the inline Chinese prompt with a compressed English version:

```rust
    let system_prompts = vec![
        "You are a high-fidelity document editor.\n\n\
        Task: interpret the user's spoken_instruction and edit current_document accordingly.\n\n\
        Inputs:\n\
        - current_document: the frozen latest document at recording start — edit this directly\n\
        - spoken_instruction: ASR-transcribed voice command — may contain speech errors, homophones, abbreviation errors\n\
        - term_reference: filtered terminology for error correction\n\n\
        Rules:\n\
        1. First normalize spoken_instruction: fix ASR noise, produce a clear edit intent\n\
        2. Apply normalized intent to current_document\n\
        3. current_document is the authoritative text — its terminology, casing, style override spoken_instruction\n\
        4. Match approximate terms in spoken_instruction to current_document entries using term_reference\n\
        5. term_reference is a correction aid, not a forced replacement table\n\
        6. Determine operation type: rewrite, expand, format, translate, or polish\n\
        7. Preserve document language unless explicit translation is requested\n\
        8. Make only intent-related changes; preserve unaffected content, structure, and tone\n\
        9. When ambiguous, choose the minimal edit that matches literal intent\n\
        10. Output only valid JSON, no explanation or markdown\n\n\
        Output JSON:\n\
        - normalized_instruction: corrected edit intent\n\
        - operation: rewrite|expand|format|translate|polish\n\
        - rewritten_text: the fully edited document\n\
        - changes: [{from, to, reason}]".to_string(),
    ];
````

Target: ~250 English words (~350 tokens) vs current ~1600 Chinese chars (~2400 tokens).

- [ ] **Step 5: Verify compilation and tests**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/resources/prompts/system_skill_routing.md \
  src-tauri/resources/prompts/system_confidence_check.md \
  src-tauri/resources/prompts/system_correction_analysis.md \
  src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Convert built-in system prompts to English for token efficiency"
```

---

## Task 6: PromptBuilder Token Budget Control

**Files:**

- Modify: `src-tauri/src/actions/post_process/prompt_builder.rs`

- [ ] **Step 1: Add budget fields to PromptBuilder**

Add to the `PromptBuilder` struct:

```rust
    /// Maximum number of hotword entries to inject (0 = unlimited).
    max_hotwords: usize,
    /// Maximum number of history entries to inject (0 = unlimited).
    max_history_entries: usize,
```

Add builder methods:

```rust
    pub fn max_hotwords(mut self, n: usize) -> Self {
        self.max_hotwords = n;
        self
    }

    pub fn max_history_entries(mut self, n: usize) -> Self {
        self.max_history_entries = n;
        self
    }
```

Default both to `0` (unlimited, preserving current behavior) in `new()`.

- [ ] **Step 2: Apply budget trimming in build()**

In the `build()` method, after hotword extraction (around line ~430), apply limits:

```rust
    // Apply hotword budget
    let person_names = if self.max_hotwords > 0 {
        person_names.into_iter().take(self.max_hotwords).collect()
    } else {
        person_names
    };
    let product_names = if self.max_hotwords > 0 {
        product_names.into_iter().take(self.max_hotwords).collect()
    } else {
        product_names
    };
    let domain_terms = if self.max_hotwords > 0 {
        domain_terms.into_iter().take(self.max_hotwords).collect()
    } else {
        domain_terms
    };
    let hotwords = if self.max_hotwords > 0 {
        hotwords.into_iter().take(self.max_hotwords).collect()
    } else {
        hotwords
    };
```

For history entries (around line ~406-413):

```rust
    let history_hint_items: Vec<String> = {
        let mut seen = BTreeSet::new();
        let limit = if self.max_history_entries > 0 {
            self.max_history_entries
        } else {
            usize::MAX
        };
        history_entries
            .iter()
            .filter_map(|entry| sanitize_history_entry(entry))
            .filter(|entry| seen.insert(entry.clone()))
            .take(limit)
            .collect()
    };
```

- [ ] **Step 3: Use budget in pipeline.rs for Lite mode**

Update the Lite mode builder in pipeline.rs (from Task 3) to set budgets:

```rust
    if transcription_mode == super::classifier::TranscriptionMode::Lite {
        builder = builder
            .hotword_injection(hotword_injection)
            .max_hotwords(10)        // Limit to 10 most relevant
            .max_history_entries(0)   // No history for Lite
            .injection_policy(super::prompt_builder::InjectionPolicy {
                include_streaming_reference: false,
                include_history_context: false,
                include_hotword_reference: true,
            });
    }
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors.

- [ ] **Step 5: Run existing tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml prompt_builder`
Expected: All existing tests pass (budget defaults to unlimited = no behavior change).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/prompt_builder.rs \
  src-tauri/src/actions/post_process/pipeline.rs
git commit -m "Add token budget control to PromptBuilder for context trimming"
```

---

## Task 7: Skill Bilingual Support (Backend)

**Files:**

- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/commands/text.rs`
- Modify: `src-tauri/src/lib.rs` (register command)

- [ ] **Step 1: Add instructions_en field to Skill struct**

In `settings.rs`, add to the `Skill` struct (after `instructions` field):

```rust
    /// English version of instructions for token-efficient LLM calls.
    /// When present, runtime prefers this over `instructions`.
    #[serde(default)]
    pub instructions_en: Option<String>,
```

- [ ] **Step 2: Add runtime resolution method**

Add method to `Skill`:

```rust
impl Skill {
    /// Returns the most token-efficient instructions available.
    /// Prefers English version when available, falls back to original.
    pub fn effective_instructions(&self) -> &str {
        self.instructions_en
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&self.instructions)
    }
}
```

- [ ] **Step 3: Use effective_instructions in PromptBuilder**

In `prompt_builder.rs::build()`, change the template source (line ~344):

```rust
    // Before:
    let template = &self.prompt.instructions;
    // After:
    let template = self.prompt.effective_instructions();
```

- [ ] **Step 4: Add translate command**

In `src-tauri/src/commands/text.rs`, add:

```rust
#[tauri::command]
pub async fn translate_skill_instructions(
    app: AppHandle,
    instructions: String,
) -> Result<String, String> {
    let settings = crate::settings::get_settings(&app);
    let provider = settings
        .active_post_process_provider()
        .ok_or("No post-process provider configured")?;
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    let model = settings
        .resolve_model_for_provider(&settings.post_process_provider_id)
        .unwrap_or_else(|| "gpt-4o-mini".to_string());

    let system_prompt = "Translate the following AI prompt instructions from Chinese to English. \
        Preserve all template variables like {{variable-name}} exactly as-is. \
        Keep the same structure, meaning, and formatting. \
        Output only the translated text, nothing else.";

    let (result, _err, _error_message, _token_count) =
        crate::actions::post_process::execute_llm_request(
            &app,
            &settings,
            provider,
            &model,
            None,
            system_prompt,
            &instructions,
            None,
            None,
            None,
            None,
            None,
        )
        .await;

    result.ok_or_else(|| "Translation failed".to_string())
}
```

- [ ] **Step 5: Register command in lib.rs**

Add `commands::text::translate_skill_instructions` to the invoke handler in `src-tauri/src/lib.rs`.

- [ ] **Step 6: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/commands/text.rs \
  src-tauri/src/lib.rs src-tauri/src/actions/post_process/prompt_builder.rs
git commit -m "Add Skill bilingual support with instructions_en field and translate command"
```

---

## Task 8: Skill Bilingual Support (Frontend)

**Files:**

- Modify: `src/components/settings/post-processing/prompts/components/PromptEditor.tsx`
- Modify: `src/components/settings/post-processing/prompts/components/ResizableEditor.tsx`
- Modify: `src/components/settings/post-processing/PromptsConfiguration.tsx`

- [ ] **Step 1: Add bilingual state to PromptsConfiguration**

In `PromptsConfiguration.tsx`, add state for the English version:

```typescript
const [draftContentEn, setDraftContentEn] = useState<string>("");
const [viewMode, setViewMode] = useState<"original" | "english" | "bilingual">(
  "original",
);
const [isTranslating, setIsTranslating] = useState(false);
```

Load `instructions_en` when selecting a skill:

```typescript
// In the skill selection handler
setDraftContentEn(selectedSkill.instructions_en ?? "");
```

Save `instructions_en` alongside `instructions`:

```typescript
// In the save handler
const updatedSkill = {
  ...skill,
  instructions: draftContent,
  instructions_en: draftContentEn || undefined,
};
```

- [ ] **Step 2: Add translate button and view toggle to PromptEditor**

In `PromptEditor.tsx`, add a toolbar row above the editor:

```tsx
<Flex gap="2" align="center" mb="2">
  <SegmentedControl.Root
    value={viewMode}
    onValueChange={(v) => setViewMode(v as any)}
    size="1"
  >
    <SegmentedControl.Item value="original">中文</SegmentedControl.Item>
    <SegmentedControl.Item value="english">English</SegmentedControl.Item>
    <SegmentedControl.Item value="bilingual">
      {t("skill.editor.bilingual")}
    </SegmentedControl.Item>
  </SegmentedControl.Root>

  {!draftContentEn && (
    <Button
      size="1"
      variant="soft"
      onClick={handleTranslate}
      disabled={isTranslating || !draftContent.trim()}
    >
      {isTranslating
        ? t("skill.editor.translating")
        : t("skill.editor.translateToEnglish")}
    </Button>
  )}
</Flex>
```

Translate handler:

```typescript
const handleTranslate = async () => {
  setIsTranslating(true);
  try {
    const result = await invoke<string>("translate_skill_instructions", {
      instructions: draftContent,
    });
    setDraftContentEn(result);
    setViewMode("english");
  } catch (e) {
    console.error("Translation failed:", e);
  } finally {
    setIsTranslating(false);
  }
};
```

- [ ] **Step 3: Render bilingual view**

In the editor area, conditionally render based on `viewMode`:

```tsx
{
  viewMode === "bilingual" ? (
    <Flex gap="3" style={{ height: "100%" }}>
      <Box style={{ flex: 1 }}>
        <Text size="1" weight="medium" mb="1">
          中文
        </Text>
        <ResizableEditor
          value={draftContent}
          onChange={setDraftContent}
          readOnly={false}
        />
      </Box>
      <Box style={{ flex: 1 }}>
        <Text size="1" weight="medium" mb="1">
          English
        </Text>
        <ResizableEditor
          value={draftContentEn}
          onChange={setDraftContentEn}
          readOnly={false}
        />
      </Box>
    </Flex>
  ) : (
    <ResizableEditor
      value={viewMode === "english" ? draftContentEn : draftContent}
      onChange={viewMode === "english" ? setDraftContentEn : setDraftContent}
      readOnly={false}
    />
  );
}
```

- [ ] **Step 4: Verify build**

Run: `bun build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/post-processing/
git commit -m "Add bilingual Skill editor with translate button and view toggle"
```

---

## Task 9: Integration Testing & Verification

**Files:**

- Modify: `src-tauri/src/actions/post_process/classifier.rs` (add edge case tests)

- [ ] **Step 1: Add edge case tests**

Add to classifier tests:

```rust
    // Edge cases that should NOT be filtered
    #[test]
    fn test_real_content_not_filtered() {
        // Short but meaningful
        assert_ne!(classify("API接口", None), TranscriptionMode::Skip);
        // Looks like filler but isn't
        assert_ne!(classify("嗯这个方案不行", None), TranscriptionMode::Skip);
        // Short with numbers
        assert_ne!(classify("3点开会", None), TranscriptionMode::Full); // proper noun signal
    }

    // Bilingual content
    #[test]
    fn test_mixed_language() {
        assert_eq!(classify("用React", None), TranscriptionMode::Full);
        assert_eq!(classify("async函数", None), TranscriptionMode::Full);
    }

    // Boundary: exactly 15 chars, simple
    #[test]
    fn test_boundary_15_chars() {
        // 15 simple Chinese chars, no special features
        let text = "今天天气还不错啊你觉得呢我也是";
        assert!(text.chars().count() == 15);
        // This has a question word 呢, so it triggers instruction features
        assert_eq!(classify(text, None), TranscriptionMode::Full);
    }
```

- [ ] **Step 2: Run full test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All tests pass.

- [ ] **Step 3: Final compilation check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml && bun build`
Expected: Both pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/classifier.rs
git commit -m "Add edge case tests for TranscriptionClassifier"
```
