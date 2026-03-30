# Model Preset Parameters Design

## Overview

Dynamically adjust LLM parameters (temperature, top_p, etc.) based on usage scenario and model family. The system ships built-in recommended parameter presets per model family, automatically matches them at runtime based on the active skill and model, and allows user override.

## Motivation

- Different skills need different parameter profiles: grammar correction needs low randomness, creative writing needs high randomness.
- Different model families respond differently to the same temperature value (e.g., Qwen3 defaults to 0.6 while GPT-4 defaults to 1.0).
- Current system only supports manual JSON `extra_params` per model — no scenario awareness or intelligent defaults.

## Design

### 1. Resource File: `model_presets.json`

Located at `src-tauri/resources/model_presets.json`. Users can override by placing a copy in their app data directory (same mechanism as prompt files).

The `version` field tracks schema evolution. When the app ships a newer version than the user's override file, it logs a warning but still loads the user file. This allows future structural changes without breaking user customizations.

The `presets` top-level array enumerates all valid preset names. The UI uses this to populate dropdown options and validate skill `param_preset` values.

The `families` field uses an **ordered array** (not a map) to ensure deterministic match priority — more specific patterns are listed first. During matching, the first family whose pattern matches wins.

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
    }
  ]
}
```

### 2. Data Model Changes

#### 2.1 CachedModel — new `model_family` field

```rust
pub struct CachedModel {
    // ... existing fields ...
    pub model_family: Option<String>,  // e.g. "qwen3", "gpt-4o", "claude"
    pub extra_params: Option<HashMap<String, serde_json::Value>>,
    // ...
}
```

Auto-detection logic when adding a model:

1. Check `custom_label` first (higher priority — user-set alias is more accurate)
2. Fall back to `model_id`
3. Lowercase the string, match against `match_patterns` from each family in `model_presets.json`
4. Return first match, or `None` if no match

Re-trigger detection when user edits `custom_label`. User can also manually override `model_family` in UI.

#### 2.2 Skill — new `param_preset` field

Both `SkillFrontmatter` (in `src-tauri/src/managers/skill.rs`) and `Skill` (in `src-tauri/src/settings.rs`) structs must add a `param_preset: Option<String>` field. The frontmatter parser reads the value and propagates it to the `Skill` struct used at runtime.

Added to YAML frontmatter:

```yaml
id: "grammar_fix"
name: "语法修正"
output_mode: polish
param_preset: "accurate"
```

Skill-to-preset mapping:

| Skill                | param_preset | Rationale                          |
| -------------------- | ------------ | ---------------------------------- |
| `default_correction` | `accurate`   | Core polishing, needs faithfulness |
| `grammar_fix`        | `accurate`   | Grammar correction, no creativity  |
| `translation`        | `accurate`   | Translation needs precision        |
| `smart_compose`      | `creative`   | Continuation needs creativity      |
| `reply_suggestion`   | `creative`   | Reply suggestions need diversity   |
| `style_reply`        | `balanced`   | Stylized replies, balance needed   |
| `memo`               | `balanced`   | Memo formatting, moderate polish   |
| `summarize`          | `accurate`   | Summarization needs faithfulness   |
| `code_generate`      | `accurate`   | Code generation needs precision    |
| `code_explain`       | `balanced`   | Explanation allows expression      |
| `ai_chat`            | `balanced`   | General conversation               |
| `votype_command`     | `accurate`   | Command execution needs precision  |

### 3. Runtime Parameter Resolution

#### 3.1 Threading the skill through the pipeline

Currently, `execute_llm_request()` and `execute_llm_request_with_messages()` in `core.rs` do not receive a `Skill` reference. The preset resolution must happen **upstream in the pipeline** (`pipeline.rs`), where both the skill and the cached model are available. The resolved preset params are then passed down to the LLM request functions as part of the already-merged `extra_params`.

Concretely: `maybe_post_process_transcription()` in `pipeline.rs` resolves the preset params, merges them with the model's `extra_params` (user wins), and passes the merged result to `execute_llm_request()`. The existing `extra_params` merge code in `core.rs` continues to work as-is — it just receives pre-merged params.

#### 3.2 Resolution flow

```
Skill.param_preset + CachedModel.model_family + model_presets.json
    → resolve_preset_params()
    → merge with user extra_params (user wins)
    → final LLM request params
```

#### 3.3 Core function

```rust
fn resolve_preset_params(
    skill: &Skill,
    model: &CachedModel,
    presets_config: &ModelPresetsConfig,
) -> HashMap<String, Value> {
    // 1. Determine model family
    let family = model.model_family
        .or_else(|| detect_from_model_id(&model.model_id));

    // 2. Unknown family → return empty (no injection), log warning
    let family = match family {
        Some(f) => f,
        None => {
            log::debug!("No model family for '{}', skipping preset params", model.model_id);
            return HashMap::new();
        }
    };

    // 3. Find family config (iterate ordered array)
    let family_config = match presets_config.families.iter().find(|f| f.id == family) {
        Some(fc) => fc,
        None => {
            log::warn!("Model family '{}' not found in presets config", family);
            return HashMap::new();
        }
    };

    // 4. Determine preset name, with fallback chain
    let preset_name = skill.param_preset
        .as_deref()
        .unwrap_or(&family_config.default_preset);

    // 5. Look up preset params; if preset name not found, fall back to family default_preset
    let params = family_config.presets.get(preset_name)
        .or_else(|| {
            log::warn!("Preset '{}' not found for family '{}', falling back to '{}'",
                preset_name, family, family_config.default_preset);
            family_config.presets.get(&family_config.default_preset)
        });

    // 6. Log resolved preset for observability
    log::info!("Resolved preset: family='{}', preset='{}', params={:?}", family, preset_name, params);

    params.cloned().unwrap_or_default()
}
```

#### 3.4 Merge logic

```rust
fn build_final_params(
    preset_params: HashMap<String, Value>,
    user_extra_params: Option<HashMap<String, Value>>,
) -> HashMap<String, Value> {
    let mut base = preset_params;
    if let Some(user_params) = user_extra_params {
        base.extend(user_params);  // user params override preset
    }
    base
}
```

#### 3.5 Priority (high to low)

```
User manual extra_params (CachedModel.extra_params)  >  Preset params (from model_presets.json)
```

Two levels only. If the user has set `extra_params` on a model, those keys override the corresponding preset keys. Keys not present in `extra_params` are filled from the preset.

#### 3.6 Resource loading

- Load `model_presets.json` at startup, cache in memory
- Check user app data directory first, fall back to built-in resources
- Consistent with existing prompt file loading mechanism

### 4. UI Changes

#### 4.1 Model edit panel (ModelConfigurationPanel)

In the existing "Advanced Settings" area, add:

- **Model Family dropdown**: auto-detected + manually selectable. Options from `model_presets.json` family keys + "Unknown/Custom"
- **Active preset display** (read-only): shows current preset name and resolved parameter values
- **Hint text** under Extra Params: "Manually set parameters will override preset values"

#### 4.2 Add model flow

- After model selection, auto-detect `model_family` and display
- If known family detected, show hint: "Identified as Qwen3 series, recommended parameters will be applied automatically"

#### 4.3 No changes needed

- Skill editing UI — `param_preset` is pre-configured for built-in skills, external skills can add it manually in file
- Length routing UI — unaffected (routing selects model, preset selects params, orthogonal)
- Prompt configuration UI — unaffected

### 5. Migration

On first launch after upgrade, run `detect_model_family()` on all existing `CachedModel` entries that have `model_family: None`. This ensures existing users get the benefit immediately without needing to re-add their models. The detection is non-destructive — it only sets `model_family` if a match is found, and never overwrites a user-set value.

### 6. Files Changed

| Layer       | File                                             | Change                                      |
| ----------- | ------------------------------------------------ | ------------------------------------------- |
| Resource    | `src-tauri/resources/model_presets.json`         | **New**: family × preset → params mapping   |
| Data        | `src-tauri/src/settings.rs`                      | Add `model_family` to CachedModel           |
| Data        | `src/lib/types.ts`                               | Add `model_family` to CachedModelSchema     |
| Detection   | `src-tauri/src/settings.rs`                      | New `detect_model_family()` function        |
| Skill       | `src-tauri/resources/skills/builtin/*.skill.md`  | Add `param_preset` to each skill            |
| Skill parse | Skill parsing Rust code                          | Parse `param_preset` field                  |
| Core        | `src-tauri/src/actions/post_process/core.rs`     | New `resolve_preset_params()` + merge logic |
| Loading     | Resource loading code                            | Load and cache `model_presets.json`         |
| Pipeline    | `src-tauri/src/actions/post_process/pipeline.rs` | Call resolution, pass preset params         |
| UI          | `ModelsConfiguration.tsx`                        | Auto-detect model_family on add             |
| UI          | `ModelConfigurationPanel.tsx`                    | Show model_family dropdown + preset info    |
| Bindings    | `src/bindings.ts`                                | Sync TypeScript types                       |

### 7. Out of Scope

- UI editor for custom presets
- UI editing of `param_preset` in skills
- Dynamic A/B testing or auto parameter tuning
