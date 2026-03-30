# Model Preset Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically apply optimal LLM parameters (temperature, top_p, etc.) based on the active skill's intent and the model family, with user override support.

**Architecture:** A resource file (`model_presets.json`) maps model family × preset name to concrete parameters. Each skill declares a `param_preset` (e.g., "accurate"). At runtime, the pipeline resolves preset params from the resource file, merges with user `extra_params` (user wins), and passes the result to the LLM request. A `model_family` field on `CachedModel` enables auto-detection.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), serde_json, Zod

**Spec:** `docs/superpowers/specs/2026-03-27-model-preset-params-design.md`

---

## File Structure

| File                                                                  | Responsibility                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src-tauri/resources/model_presets.json`                              | **New.** Model family × preset → parameter mapping                                                           |
| `src-tauri/src/managers/model_preset.rs`                              | **New.** Load, cache, and query `model_presets.json`; `detect_model_family()`                                |
| `src-tauri/src/managers/mod.rs`                                       | Expose `model_preset` module                                                                                 |
| `src-tauri/src/settings.rs`                                           | Add `model_family` to `CachedModel`; add `param_preset` to `Skill`                                           |
| `src-tauri/src/managers/skill.rs`                                     | Add `param_preset` to `SkillFrontmatter`; propagate to `Skill`                                               |
| `src-tauri/src/actions/post_process/pipeline.rs`                      | Resolve preset params upstream; pass merged params to `execute_llm_request_with_messages()`                  |
| `src-tauri/src/actions/post_process/core.rs`                          | Accept optional pre-merged `override_extra_params`; use them instead of model's `extra_params` when provided |
| `src-tauri/src/actions/post_process/extensions.rs`                    | Same preset resolution for multi-model path                                                                  |
| `src-tauri/src/actions/post_process/manual.rs`                        | Update call site to pass `None` for `override_extra_params`                                                  |
| `src-tauri/resources/skills/builtin/*.skill.md`                       | Add `param_preset` to each skill's frontmatter                                                               |
| `src/lib/types.ts`                                                    | Add `model_family` to `CachedModelSchema`                                                                    |
| `src/bindings.ts`                                                     | Regenerate TypeScript bindings                                                                               |
| `src/components/settings/post-processing/ModelConfigurationPanel.tsx` | Show model_family dropdown + preset info                                                                     |
| `src/components/settings/post-processing/ModelsConfiguration.tsx`     | Auto-detect model_family on add                                                                              |

---

### Task 1: Create `model_presets.json` Resource File

**Files:**

- Create: `src-tauri/resources/model_presets.json`

- [ ] **Step 1: Create the resource file**

```json
{
  "version": 1,
  "presets": ["accurate", "balanced", "creative"],
  "families": [
    {
      "id": "qwen3",
      "match_patterns": ["qwen3", "qwen-3"],
      "default_preset": "balanced",
      "presets": {
        "accurate": { "temperature": 0.2, "top_p": 0.7, "top_k": 20 },
        "balanced": { "temperature": 0.6, "top_p": 0.95, "top_k": 20 },
        "creative": { "temperature": 0.9, "top_p": 0.95, "top_k": 20 }
      }
    },
    {
      "id": "qwen2.5",
      "match_patterns": ["qwen2.5", "qwen-2.5"],
      "default_preset": "balanced",
      "presets": {
        "accurate": {
          "temperature": 0.2,
          "top_p": 0.7,
          "top_k": 20,
          "repetition_penalty": 1.05
        },
        "balanced": {
          "temperature": 0.7,
          "top_p": 0.8,
          "top_k": 20,
          "repetition_penalty": 1.05
        },
        "creative": { "temperature": 0.9, "top_p": 0.95, "top_k": 20 }
      }
    },
    {
      "id": "gpt-4o",
      "match_patterns": ["gpt-4o"],
      "default_preset": "balanced",
      "presets": {
        "accurate": { "temperature": 0.3, "top_p": 0.7 },
        "balanced": { "temperature": 0.7, "top_p": 0.9 },
        "creative": { "temperature": 1.0, "top_p": 0.95 }
      }
    },
    {
      "id": "gpt",
      "match_patterns": ["gpt"],
      "default_preset": "balanced",
      "presets": {
        "accurate": { "temperature": 0.3, "top_p": 0.7 },
        "balanced": { "temperature": 0.7, "top_p": 0.9 },
        "creative": { "temperature": 1.0, "top_p": 0.95 }
      }
    },
    {
      "id": "claude",
      "match_patterns": ["claude"],
      "default_preset": "balanced",
      "presets": {
        "accurate": { "temperature": 0.3, "top_p": 0.7 },
        "balanced": { "temperature": 0.7, "top_p": 0.9 },
        "creative": { "temperature": 1.0, "top_p": 0.95 }
      }
    },
    {
      "id": "deepseek",
      "match_patterns": ["deepseek"],
      "default_preset": "balanced",
      "presets": {
        "accurate": { "temperature": 0.3, "top_p": 0.7 },
        "balanced": { "temperature": 0.7, "top_p": 0.9 },
        "creative": { "temperature": 1.0, "top_p": 0.95 }
      }
    },
    {
      "id": "gemini",
      "match_patterns": ["gemini"],
      "default_preset": "balanced",
      "presets": {
        "accurate": { "temperature": 0.3, "top_p": 0.7 },
        "balanced": { "temperature": 0.7, "top_p": 0.9 },
        "creative": { "temperature": 1.0, "top_p": 0.95 }
      }
    }
  ]
}
```

Note: `gpt-4o` is listed before generic `gpt` so it matches first (more specific). Same principle applies to all families — ordered from most-specific to least-specific.

- [ ] **Step 2: Commit**

```bash
git add src-tauri/resources/model_presets.json
git commit -m "feat: add model_presets.json resource file"
```

---

### Task 2: Create `model_preset` Manager Module

**Files:**

- Create: `src-tauri/src/managers/model_preset.rs`
- Modify: `src-tauri/src/managers/mod.rs`

- [ ] **Step 1: Define types and loader in `model_preset.rs`**

Create the new module with:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A single model family entry in model_presets.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFamilyConfig {
    pub id: String,
    pub match_patterns: Vec<String>,
    pub default_preset: String,
    pub presets: HashMap<String, HashMap<String, serde_json::Value>>,
}

/// Top-level structure of model_presets.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPresetsConfig {
    pub version: u32,
    pub presets: Vec<String>,
    pub families: Vec<ModelFamilyConfig>,
}

impl ModelPresetsConfig {
    /// Load from a JSON file path
    pub fn load_from_file(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read model_presets.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse model_presets.json: {}", e))
    }

    /// Find a family config by family id
    pub fn find_family(&self, family_id: &str) -> Option<&ModelFamilyConfig> {
        self.families.iter().find(|f| f.id == family_id)
    }

    /// Get all family ids (for UI dropdown)
    pub fn family_ids(&self) -> Vec<String> {
        self.families.iter().map(|f| f.id.clone()).collect()
    }
}

/// Detect model family from a model identifier string.
/// Checks against match_patterns in order (first match wins).
pub fn detect_model_family(
    model_identifier: &str,
    config: &ModelPresetsConfig,
) -> Option<String> {
    let lower = model_identifier.to_lowercase();
    for family in &config.families {
        for pattern in &family.match_patterns {
            if lower.contains(pattern) {
                return Some(family.id.clone());
            }
        }
    }
    None
}

/// Detect model family with custom_label priority.
/// Checks custom_label first, then model_id.
pub fn detect_model_family_with_label(
    model_id: &str,
    custom_label: Option<&str>,
    config: &ModelPresetsConfig,
) -> Option<String> {
    // Check custom_label first (user-set, higher priority)
    if let Some(label) = custom_label {
        if let Some(family) = detect_model_family(label, config) {
            return Some(family);
        }
    }
    // Fall back to model_id
    detect_model_family(model_id, config)
}

/// Resolve preset parameters for a given skill preset and model family.
/// Returns empty HashMap if family or preset not found.
pub fn resolve_preset_params(
    param_preset: Option<&str>,
    model_family: Option<&str>,
    config: &ModelPresetsConfig,
) -> HashMap<String, serde_json::Value> {
    let family_id = match model_family {
        Some(f) => f,
        None => {
            log::debug!("No model family, skipping preset params");
            return HashMap::new();
        }
    };

    let family_config = match config.find_family(family_id) {
        Some(fc) => fc,
        None => {
            log::warn!("Model family '{}' not found in presets config", family_id);
            return HashMap::new();
        }
    };

    let preset_name = param_preset.unwrap_or(&family_config.default_preset);

    let params = family_config.presets.get(preset_name).or_else(|| {
        log::warn!(
            "Preset '{}' not found for family '{}', falling back to '{}'",
            preset_name,
            family_id,
            family_config.default_preset
        );
        family_config.presets.get(&family_config.default_preset)
    });

    log::info!(
        "Resolved preset: family='{}', preset='{}'",
        family_id,
        preset_name
    );

    params.cloned().unwrap_or_default()
}

/// Merge preset params with user extra_params. User params take priority.
pub fn merge_params(
    preset_params: HashMap<String, serde_json::Value>,
    user_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> HashMap<String, serde_json::Value> {
    let mut base = preset_params;
    if let Some(user_params) = user_extra_params {
        for (k, v) in user_params {
            base.insert(k.clone(), v.clone());
        }
    }
    base
}
```

- [ ] **Step 2: Register the module in `mod.rs`**

Open `src-tauri/src/managers/mod.rs` and add:

```rust
pub mod model_preset;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -5`
Expected: no errors related to `model_preset`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/managers/model_preset.rs src-tauri/src/managers/mod.rs
git commit -m "feat: add model_preset manager for loading presets and detecting model family"
```

---

### Task 3: Add `model_family` to `CachedModel` and `param_preset` to `Skill`

**Files:**

- Modify: `src-tauri/src/settings.rs:256-280` (CachedModel struct)
- Modify: `src-tauri/src/settings.rs:160-195` (Skill struct)
- Modify: `src-tauri/src/managers/skill.rs:8-24` (SkillFrontmatter struct)
- Modify: `src-tauri/src/managers/skill.rs:481-498` (no-frontmatter skill creation)
- Modify: `src-tauri/src/managers/skill.rs:522-539` (frontmatter skill creation)
- Modify: `src/lib/types.ts:135-153` (CachedModelSchema)

- [ ] **Step 1: Add `model_family` to `CachedModel` in `settings.rs`**

After the `is_thinking_model` field (around line 268), add:

```rust
    /// 模型族标识，用于自动匹配参数预设
    /// 例如: "qwen3", "gpt-4o", "claude", "deepseek"
    #[serde(default)]
    pub model_family: Option<String>,
```

- [ ] **Step 2: Add `param_preset` to `Skill` struct in `settings.rs`**

After the `locked` field (around line 192), add:

```rust
    /// 参数预设标识，用于匹配模型族的预设参数
    /// 例如: "accurate", "balanced", "creative"
    #[serde(default)]
    pub param_preset: Option<String>,
```

- [ ] **Step 3: Add `param_preset` to `SkillFrontmatter` in `skill.rs`**

After the `confidence_threshold` field (line 23), add:

```rust
    param_preset: Option<String>,
```

- [ ] **Step 4: Propagate `param_preset` in skill creation (frontmatter path)**

In `parse_skill_file()` at the `Some(Skill { ... })` block (around line 522-539), add the field:

```rust
    param_preset: fm.param_preset,
```

- [ ] **Step 5: Set `param_preset: None` in no-frontmatter skill creation**

In the no-frontmatter path (around line 481-498), add:

```rust
    param_preset: None,
```

- [ ] **Step 6: Update TypeScript CachedModelSchema**

In `src/lib/types.ts`, add after `is_thinking_model`:

```typescript
  model_family: z.string().optional(),
```

- [ ] **Step 7: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -10`
Expected: no errors. There may be warnings about unused fields — that's fine at this stage.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/managers/skill.rs src/lib/types.ts
git commit -m "feat: add model_family to CachedModel and param_preset to Skill"
```

---

### Task 4: Add `param_preset` to All Built-in Skill Files

**Files:**

- Modify: `src-tauri/resources/skills/builtin/default_correction.skill.md`
- Modify: `src-tauri/resources/skills/builtin/grammar_fix.skill.md`
- Modify: `src-tauri/resources/skills/builtin/smart_compose.skill.md`
- Modify: `src-tauri/resources/skills/builtin/reply_suggestion.skill.md`
- Modify: `src-tauri/resources/skills/builtin/style_reply.skill.md`
- Modify: `src-tauri/resources/skills/builtin/memo.skill.md`
- Modify: `src-tauri/resources/skills/builtin/votype_command.skill.md`
- Modify: `src-tauri/resources/skills/builtin/ai_chat.skill.md`
- Modify: `src-tauri/resources/skills/builtin/code_explain.skill.md`
- Modify: `src-tauri/resources/skills/builtin/code_generate.skill.md`
- Modify: `src-tauri/resources/skills/builtin/summarize.skill.md`
- Modify: `src-tauri/resources/skills/builtin/translation.skill.md`

- [ ] **Step 1: Add `param_preset` to each skill frontmatter**

For each skill file, add a `param_preset` line in the YAML frontmatter (between the `---` delimiters). Use the following mapping:

| File                          | param_preset |
| ----------------------------- | ------------ |
| `default_correction.skill.md` | `accurate`   |
| `grammar_fix.skill.md`        | `accurate`   |
| `translation.skill.md`        | `accurate`   |
| `summarize.skill.md`          | `accurate`   |
| `code_generate.skill.md`      | `accurate`   |
| `votype_command.skill.md`     | `accurate`   |
| `smart_compose.skill.md`      | `creative`   |
| `reply_suggestion.skill.md`   | `creative`   |
| `style_reply.skill.md`        | `balanced`   |
| `memo.skill.md`               | `balanced`   |
| `code_explain.skill.md`       | `balanced`   |
| `ai_chat.skill.md`            | `balanced`   |

Example — for `grammar_fix.skill.md`, the frontmatter becomes:

```yaml
---
id: "grammar_fix"
name: "语法修正"
description: "修正语法错误..."
output_mode: polish
icon: "IconSparkles"
locked: false
confidence_check_enabled: false
param_preset: "accurate"
---
```

- [ ] **Step 2: Verify skills still parse**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/resources/skills/builtin/
git commit -m "feat: add param_preset to all built-in skill files"
```

---

### Task 5: Load `model_presets.json` at Startup

**Files:**

- Modify: `src-tauri/src/managers/model_preset.rs` (add resource resolution)
- Check: `src-tauri/src/lib.rs` or wherever app state is initialized

This task adds the ability to load the presets config from the Tauri resource path (with user override support) and store it in app state.

- [ ] **Step 1: Add a load function with Tauri resource resolution**

Add to `model_preset.rs`:

```rust
const CURRENT_VERSION: u32 = 1;

/// Load model presets config, checking user data dir first, then built-in resources.
pub fn load_model_presets(app_handle: &tauri::AppHandle) -> Result<ModelPresetsConfig, String> {
    // 1. Check user app data directory for override
    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let user_path = data_dir.join("model_presets.json");
        if user_path.exists() {
            log::info!("Loading user model_presets.json from {:?}", user_path);
            let user_config = ModelPresetsConfig::load_from_file(&user_path)?;
            // Version check: warn if user file is older than built-in
            if user_config.version < CURRENT_VERSION {
                log::warn!(
                    "User model_presets.json (v{}) is older than built-in (v{}). User file takes precedence.",
                    user_config.version, CURRENT_VERSION
                );
            }
            return Ok(user_config);
        }
    }

    // 2. Fall back to built-in resource
    let resource_rel = "resources/model_presets.json";
    if let Ok(path) = app_handle
        .path()
        .resolve(resource_rel, tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            log::info!("Loading built-in model_presets.json from {:?}", path);
            return ModelPresetsConfig::load_from_file(&path);
        }
    }

    // 3. Development fallback
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .map(|dir| dir.join("../../resources/model_presets.json"))
        .and_then(|p| p.canonicalize().ok())
    {
        log::info!("Loading dev model_presets.json from {:?}", path);
        return ModelPresetsConfig::load_from_file(&path);
    }

    Err("model_presets.json not found in any location".to_string())
}
```

- [ ] **Step 2: Store in Tauri managed state**

Find where app state is initialized (likely `src-tauri/src/lib.rs` in the `setup` closure or `Builder` chain). Add the `ModelPresetsConfig` as managed state:

```rust
use managers::model_preset;

// In setup or builder:
let presets_config = model_preset::load_model_presets(&app_handle)
    .unwrap_or_else(|e| {
        log::warn!("Failed to load model presets: {}. Using empty config.", e);
        model_preset::ModelPresetsConfig {
            version: 0,
            presets: vec![],
            families: vec![],
        }
    });
app.manage(std::sync::Arc::new(presets_config));
```

Note: Check how the project manages other state (e.g., `AppSettings`) — follow the same pattern. If state is stored in a `Mutex<AppSettings>` or similar, the presets config can be stored alongside or separately.

- [ ] **Step 3: Verify it compiles and loads**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -10`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/managers/model_preset.rs src-tauri/src/lib.rs
git commit -m "feat: load model_presets.json at startup with user override support"
```

---

### Task 6: Integrate Preset Resolution into Pipeline

**Files:**

- Modify: `src-tauri/src/actions/post_process/core.rs:146-158` (function signature)
- Modify: `src-tauri/src/actions/post_process/core.rs:265-326` (extra_params merge)
- Modify: `src-tauri/src/actions/post_process/pipeline.rs:600-634` (call site)

This is the core integration. The pipeline resolves preset params and passes them down.

- [ ] **Step 1: Add `override_extra_params` parameter to `execute_llm_request_with_messages`**

In `core.rs`, modify the function signature (around line 146) to accept an optional override:

```rust
pub async fn execute_llm_request_with_messages(
    app_handle: &AppHandle,
    settings: &AppSettings,
    provider: &PostProcessProvider,
    model: &str,
    cached_model_id: Option<&str>,
    system_prompts: &[String],
    user_message: Option<&str>,
    _app_name: Option<String>,
    _window_title: Option<String>,
    _match_pattern: Option<String>,
    _match_type: Option<crate::settings::TitleMatchType>,
    override_extra_params: Option<&HashMap<String, serde_json::Value>>,  // NEW
) -> (Option<String>, bool, Option<String>)
```

- [ ] **Step 2: Use `override_extra_params` when merging in `core.rs`**

In the extra_params merge section (around lines 265-326), change the logic:

```rust
// Resolve CachedModel (existing code, keep as-is)
let cached_model = cached_model_id.and_then(|id| { ... });
let cached_model = cached_model.or_else(|| { ... });

// Use override if provided, otherwise fall back to model's extra_params
let extra_params = override_extra_params
    .or_else(|| cached_model.and_then(|m| m.extra_params.as_ref()));
let extra_headers = cached_model.and_then(|m| m.extra_headers.as_ref());
```

- [ ] **Step 3: Resolve preset params in `pipeline.rs`**

Before the call to `execute_llm_request_with_messages` (around line 622), add preset resolution:

```rust
// Resolve preset parameters
let presets_config = app_handle.try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>();
let merged_extra_params = if let Some(config) = presets_config {
    let cached_model = cached_model_id.and_then(|id| {
        settings.cached_models.iter().find(|m| m.id == id)
    }).or_else(|| {
        settings.cached_models.iter().find(|m| m.model_id == model && m.provider_id == actual_provider.id)
    });

    let preset_params = crate::managers::model_preset::resolve_preset_params(
        prompt.param_preset.as_deref(),
        cached_model.and_then(|m| m.model_family.as_deref()),
        &config,
    );

    if preset_params.is_empty() {
        None
    } else {
        let merged = crate::managers::model_preset::merge_params(
            preset_params,
            cached_model.and_then(|m| m.extra_params.as_ref()),
        );
        Some(merged)
    }
} else {
    None
};
```

Then update the call:

```rust
let llm_future = super::core::execute_llm_request_with_messages(
    app_handle,
    settings,
    actual_provider,
    &model,
    cached_model_id,
    &built.system_messages,
    built.user_message.as_deref(),
    app_name.clone(),
    window_title.clone(),
    match_pattern.clone(),
    match_type,
    merged_extra_params.as_ref(),  // NEW
);
```

- [ ] **Step 4: Update all other call sites**

The following call sites must be updated:

1. **`core.rs:130`** — `execute_llm_request()` wrapper calls `execute_llm_request_with_messages()` internally. Add `None` as the last argument. Do NOT change the wrapper's own signature — callers of the wrapper (`commands/text.rs`, 4 call sites) should not be affected.
2. **`manual.rs:153`** — calls `execute_llm_request_with_messages()` directly. Add `None` as the last argument.

Verify no other call sites exist:
Run: `grep -rn "execute_llm_request_with_messages" src-tauri/src/`
Expected: only `pipeline.rs` (updated in Step 3), `core.rs:130` (this step), `manual.rs:153` (this step), and the function definition itself.

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -15`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/pipeline.rs
git commit -m "feat: integrate preset parameter resolution into post-processing pipeline"
```

---

### Task 7: Integrate Preset Resolution into Multi-Model Path

**Files:**

- Modify: `src-tauri/src/actions/post_process/extensions.rs:554-586`

The multi-model path (`execute_single_model_post_process`) also resolves `extra_params` independently. It needs the same preset resolution logic.

- [ ] **Step 1: Add preset resolution in `extensions.rs`**

In `execute_single_model_post_process` (around lines 554-586), before building the request body, add preset resolution similar to pipeline.rs:

```rust
// After resolving cached_model (existing code)
let cached_model = settings.cached_models.iter().find(|m| m.id == item.id)
    .or_else(|| { ... });

// NEW: Resolve preset params
let presets_config = _app_handle.try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>();
let effective_extra_params = if let Some(config) = presets_config {
    let preset_params = crate::managers::model_preset::resolve_preset_params(
        prompt.param_preset.as_deref(),  // prompt is &LLMPrompt, not Option
        cached_model.and_then(|m| m.model_family.as_deref()),
        &config,
    );
    if preset_params.is_empty() {
        cached_model.and_then(|m| m.extra_params.clone())
    } else {
        Some(crate::managers::model_preset::merge_params(
            preset_params,
            cached_model.and_then(|m| m.extra_params.as_ref()),
        ))
    }
} else {
    cached_model.and_then(|m| m.extra_params.clone())
};

// Use effective_extra_params instead of cached_model.extra_params
let extra_params = effective_extra_params.as_ref();
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/actions/post_process/extensions.rs
git commit -m "feat: add preset parameter resolution to multi-model post-processing"
```

---

### Task 8: Auto-Detect `model_family` on Model Add and Migration

**Files:**

- Modify: Backend command that handles `add_cached_model` (search for this command name)
- Modify: Startup/migration logic

- [ ] **Step 1: Add auto-detection when adding a model**

The `add_cached_model` command is at `src-tauri/src/shortcut/settings_cmds.rs:419`. In this function, after receiving the `CachedModel` parameter, detect the family before saving:

```rust
// After building the CachedModel
let presets_config = app_handle.try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>();
if let Some(config) = presets_config {
    if model.model_family.is_none() {
        model.model_family = crate::managers::model_preset::detect_model_family_with_label(
            &model.model_id,
            model.custom_label.as_deref(),
            &config,
        );
        if let Some(ref family) = model.model_family {
            log::info!("Auto-detected model family '{}' for model '{}'", family, model.model_id);
        }
    }
}
```

- [ ] **Step 2: Add migration for existing models**

In the app startup sequence (after loading settings and presets config), iterate existing models:

```rust
// Migration: detect model_family for existing models
if let Some(config) = presets_config_arc.as_ref() {
    let mut updated = false;
    for model in &mut settings.cached_models {
        if model.model_family.is_none() {
            model.model_family = crate::managers::model_preset::detect_model_family_with_label(
                &model.model_id,
                model.custom_label.as_deref(),
                config,
            );
            if model.model_family.is_some() {
                updated = true;
            }
        }
    }
    if updated {
        log::info!("Migrated model_family for existing cached models");
        // Save updated settings
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/
git commit -m "feat: auto-detect model_family on add and migrate existing models"
```

---

### Task 9: Add Tauri Commands for Frontend

**Files:**

- Create or modify: Backend command file (where model-related commands live)

The frontend needs commands to:

1. Get the list of available model families (for dropdown)
2. Detect model family for a given model_id + custom_label
3. Get preset params for a given family + preset (for display)

- [ ] **Step 1: Add Tauri commands**

All commands need both `#[tauri::command]` and `#[specta::specta]` attributes (project uses `tauri-specta` for auto-generated TypeScript bindings). Place these in a new file or in `shortcut/settings_cmds.rs` alongside existing model commands.

```rust
#[tauri::command]
#[specta::specta]
pub fn get_model_families(
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let config = app_handle
        .try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>()
        .ok_or("Model presets not loaded")?;
    Ok(config.family_ids())
}

#[tauri::command]
#[specta::specta]
pub fn detect_model_family_cmd(
    app_handle: tauri::AppHandle,
    model_id: String,
    custom_label: Option<String>,
) -> Option<String> {
    let config = app_handle
        .try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>()?;
    crate::managers::model_preset::detect_model_family_with_label(
        &model_id,
        custom_label.as_deref(),
        &config,
    )
}

#[tauri::command]
#[specta::specta]
pub fn get_preset_params(
    app_handle: tauri::AppHandle,
    family_id: String,
    preset_name: String,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let config = app_handle
        .try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>()
        .ok_or("Model presets not loaded")?;
    let family = config
        .find_family(&family_id)
        .ok_or(format!("Family '{}' not found", family_id))?;
    Ok(family
        .presets
        .get(&preset_name)
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
#[specta::specta]
pub fn get_available_presets(
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let config = app_handle
        .try_state::<std::sync::Arc<crate::managers::model_preset::ModelPresetsConfig>>()
        .ok_or("Model presets not loaded")?;
    Ok(config.presets.clone())
}
```

- [ ] **Step 2: Register commands in `lib.rs`**

Add the new commands to the `collect_commands!` macro at `src-tauri/src/lib.rs:312`. Add entries like:

```rust
get_model_families,
detect_model_family_cmd,
get_preset_params,
get_available_presets,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/
git commit -m "feat: add Tauri commands for model family detection and preset queries"
```

---

### Task 10: Frontend — Model Family in Add/Edit Model UI

**Files:**

- Modify: `src/components/settings/post-processing/ModelsConfiguration.tsx`
- Modify: `src/components/settings/post-processing/ModelConfigurationPanel.tsx`
- Modify: `src/bindings.ts` (if using specta for type generation, regenerate; otherwise manually update)

- [ ] **Step 1: Regenerate TypeScript bindings**

The project uses `tauri-specta` for auto-generating `src/bindings.ts`. After adding the new commands with `#[specta::specta]` in Task 9, the bindings will be auto-generated on the next dev build. Run:

```bash
cd /Users/zac/code/github/asr/Handy && bun tauri dev
# Wait for it to start, then Ctrl+C — bindings will be regenerated
```

Verify the new functions appear in `src/bindings.ts`: `getModelFamilies`, `detectModelFamilyCmd`, `getPresetParams`, `getAvailablePresets`.

- [ ] **Step 2: Add model_family to Add Model flow in `ModelsConfiguration.tsx`**

In the Add Model dialog, after model selection (around where `get_thinking_config` is called, line ~146):

1. Call `detectModelFamily(modelId, customLabel)` to auto-detect
2. Store in local state
3. Show a hint below the model selector: "已识别为 {family} 系列"
4. Add a dropdown for manual override (populated from `getModelFamilies()`)

- [ ] **Step 3: Add model_family display + preset info to Edit Model in `ModelConfigurationPanel.tsx`**

In the edit model dialog (around the "Advanced Settings" section):

1. Add a `Select` dropdown for `model_family` (populated from `getModelFamilies()` + "未知" option)
2. Below it, add a read-only section showing the current preset params:
   - Call `getPresetParams(model.model_family, "balanced")` (or whichever preset the default skill uses)
   - Display as: `temperature: 0.6 | top_p: 0.95 | top_k: 20`
3. Add hint text under Extra Params: "手动设置的参数将覆盖预设值"

- [ ] **Step 4: Verify the frontend compiles**

Run: `cd /Users/zac/code/github/asr/Handy && bun build 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/post-processing/ src/bindings.ts src/lib/types.ts
git commit -m "feat: add model family detection and preset display to model configuration UI"
```

---

### Task 11: End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: Build the full app**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check -p handy && bun build`
Expected: both backend and frontend compile without errors

- [ ] **Step 2: Manual verification checklist**

If running in dev mode (`bun tauri dev`):

1. Open Settings → Post Processing → Models
2. Add a new Qwen3 model → verify `model_family` auto-detected as "qwen3"
3. Add a GPT-4o model → verify `model_family` auto-detected as "gpt-4o"
4. Edit a model → verify model_family dropdown shows, preset info displays correctly
5. Set a custom label "my-qwen" on a model → verify family re-detects
6. Transcribe with "语法修正" skill active → check logs for `Resolved preset: family='qwen3', preset='accurate'`
7. Transcribe with "智能续写" skill active → check logs for `Resolved preset: family='qwen3', preset='creative'`
8. Set manual `extra_params` `{"temperature": 0.5}` on a model → verify it overrides the preset temperature but keeps other preset params

- [ ] **Step 3: Commit any fixes**

If issues found, fix and commit.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final adjustments for model preset params feature"
```
