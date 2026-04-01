# Model Fallback Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fallback model to every model selection point so that a single API failure never kills the whole operation.

**Architecture:** Introduce a `ModelChain` struct (primary + optional fallback + strategy) that replaces all `Option<String>` model ID fields. A single generic `execute_with_fallback()` async function handles Serial/Staggered/Race strategies. Frontend gets two UIs: a unified Dialog for LLM models in Settings, and a lightweight `+ 备用` popover for ASR in Footer.

**Tech Stack:** Rust (serde, tokio), React, TypeScript, Zod, Radix UI, Tailwind CSS, Tauri IPC

---

## File Structure

**New files:**

- `src-tauri/src/fallback.rs` — `ModelChain`, `ModelChainStrategy`, `FallbackResult`, `execute_with_fallback()`, serde compat deserializer
- `src/components/ui/ModelChainSelector.tsx` — Reusable LLM model chain selector (Dialog with left/right click)
- `src/components/model-selector/AsrFallbackSelector.tsx` — ASR `+ 备用` popover component

**Modified files:**

- `src-tauri/src/settings.rs` — Replace 5 `Option<String>` fields with `Option<ModelChain>`, update `cleanup_stale_model_references`
- `src-tauri/src/lib.rs` — Add `mod fallback;`
- `src-tauri/src/actions/post_process/routing.rs` — `resolve_intent_routing_model` and `resolve_effective_model` accept `ModelChain`
- `src-tauri/src/actions/post_process/pipeline.rs` — Wire fallback into LitePolish, FullPolish, length routing, rewrite paths
- `src-tauri/src/actions/post_process/core.rs` — No structural change, consumed via closures
- `src-tauri/src/actions/post_process/manual.rs` — Wire fallback into direct polish
- `src-tauri/src/actions/transcribe.rs` — Wire fallback into online ASR
- `src-tauri/src/managers/llm_metrics.rs` — Add `is_fallback` field to `LlmCallRecord`
- `src/lib/types.ts` — Add `ModelChain` Zod schema, update Settings fields
- `src/components/settings/post-processing/IntentModelSelection.tsx` — Use `ModelChainSelector`
- `src/components/settings/post-processing/PromoteModelSelection.tsx` — Use `ModelChainSelector`
- `src/components/settings/post-processing/LengthRoutingSettings.tsx` — Use `ModelChainSelector`
- `src/components/model-selector/ModelDropdown.tsx` — Integrate `AsrFallbackSelector`
- `src/stores/settingsStore.ts` — Add `updateModelChain` action
- `src/i18n/locales/zh/translation.json` — New keys
- `src/i18n/locales/en/translation.json` — New keys

---

### Task 1: `ModelChain` Type & Serde Compat (Rust)

**Files:**

- Create: `src-tauri/src/fallback.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `fallback.rs` with types**

```rust
// src-tauri/src/fallback.rs
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModelChainStrategy {
    Serial,
    Staggered,
    Race,
}

impl Default for ModelChainStrategy {
    fn default() -> Self {
        Self::Serial
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ModelChain {
    pub primary_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_id: Option<String>,
    #[serde(default)]
    pub strategy: ModelChainStrategy,
}

// Backward-compat: deserialize from either a plain string or a ModelChain object.
impl<'de> Deserialize<'de> for ModelChain {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde::de;

        struct ModelChainVisitor;

        impl<'de> de::Visitor<'de> for ModelChainVisitor {
            type Value = ModelChain;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a string (legacy model ID) or a ModelChain object")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(ModelChain {
                    primary_id: v.to_string(),
                    fallback_id: None,
                    strategy: ModelChainStrategy::Serial,
                })
            }

            fn visit_map<A: de::MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
                // Delegate to the derived deserializer via a helper struct.
                #[derive(Deserialize)]
                struct Inner {
                    primary_id: String,
                    #[serde(default)]
                    fallback_id: Option<String>,
                    #[serde(default)]
                    strategy: ModelChainStrategy,
                }
                let inner =
                    Inner::deserialize(de::value::MapAccessDeserializer::new(map))?;
                Ok(ModelChain {
                    primary_id: inner.primary_id,
                    fallback_id: inner.fallback_id,
                    strategy: inner.strategy,
                })
            }
        }

        deserializer.deserialize_any(ModelChainVisitor)
    }
}

/// Result of a fallback-aware execution.
pub struct FallbackResult<R> {
    pub result: R,
    pub actual_model_id: String,
    pub is_fallback: bool,
    pub primary_error: Option<String>,
}
```

- [ ] **Step 2: Register module in `lib.rs`**

In `src-tauri/src/lib.rs`, find the existing `mod` declarations and add:

```rust
pub mod fallback;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | head -20`
Expected: no errors related to `fallback` module

- [ ] **Step 4: Add unit tests for serde compat**

Append to `src-tauri/src/fallback.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_from_plain_string() {
        let json = r#""cached-model-abc""#;
        let chain: ModelChain = serde_json::from_str(json).unwrap();
        assert_eq!(chain.primary_id, "cached-model-abc");
        assert_eq!(chain.fallback_id, None);
        assert_eq!(chain.strategy, ModelChainStrategy::Serial);
    }

    #[test]
    fn deserialize_from_object_no_fallback() {
        let json = r#"{"primary_id": "model-a"}"#;
        let chain: ModelChain = serde_json::from_str(json).unwrap();
        assert_eq!(chain.primary_id, "model-a");
        assert_eq!(chain.fallback_id, None);
        assert_eq!(chain.strategy, ModelChainStrategy::Serial);
    }

    #[test]
    fn deserialize_from_full_object() {
        let json = r#"{"primary_id": "model-a", "fallback_id": "model-b", "strategy": "staggered"}"#;
        let chain: ModelChain = serde_json::from_str(json).unwrap();
        assert_eq!(chain.primary_id, "model-a");
        assert_eq!(chain.fallback_id, Some("model-b".to_string()));
        assert_eq!(chain.strategy, ModelChainStrategy::Staggered);
    }

    #[test]
    fn serialize_roundtrip() {
        let chain = ModelChain {
            primary_id: "model-a".to_string(),
            fallback_id: Some("model-b".to_string()),
            strategy: ModelChainStrategy::Race,
        };
        let json = serde_json::to_string(&chain).unwrap();
        let back: ModelChain = serde_json::from_str(&json).unwrap();
        assert_eq!(chain, back);
    }

    #[test]
    fn deserialize_option_null() {
        let json = r#"null"#;
        let chain: Option<ModelChain> = serde_json::from_str(json).unwrap();
        assert!(chain.is_none());
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test fallback::tests -- --nocapture`
Expected: all 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/fallback.rs src-tauri/src/lib.rs
git commit -m "feat: add ModelChain type with backward-compatible serde"
```

---

### Task 2: `execute_with_fallback()` Implementation (Rust)

**Files:**

- Modify: `src-tauri/src/fallback.rs`

- [ ] **Step 1: Add execution tests**

Append to the `tests` module in `src-tauri/src/fallback.rs`:

```rust
    #[tokio::test]
    async fn serial_primary_succeeds() {
        let chain = ModelChain {
            primary_id: "a".into(),
            fallback_id: Some("b".into()),
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            Ok::<String, String>(format!("ok-{}", model_id))
        })
        .await;
        assert_eq!(result.result.unwrap(), "ok-a");
        assert_eq!(result.actual_model_id, "a");
        assert!(!result.is_fallback);
        assert!(result.primary_error.is_none());
    }

    #[tokio::test]
    async fn serial_primary_fails_fallback_succeeds() {
        let chain = ModelChain {
            primary_id: "a".into(),
            fallback_id: Some("b".into()),
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            if model_id == "a" {
                Err("timeout".to_string())
            } else {
                Ok(format!("ok-{}", model_id))
            }
        })
        .await;
        assert_eq!(result.result.unwrap(), "ok-b");
        assert_eq!(result.actual_model_id, "b");
        assert!(result.is_fallback);
        assert_eq!(result.primary_error.as_deref(), Some("timeout"));
    }

    #[tokio::test]
    async fn serial_both_fail() {
        let chain = ModelChain {
            primary_id: "a".into(),
            fallback_id: Some("b".into()),
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            Err::<String, String>(format!("fail-{}", model_id))
        })
        .await;
        assert!(result.result.is_err());
        assert_eq!(result.actual_model_id, "b");
        assert!(result.is_fallback);
        assert_eq!(result.primary_error.as_deref(), Some("fail-a"));
    }

    #[tokio::test]
    async fn serial_no_fallback_primary_fails() {
        let chain = ModelChain {
            primary_id: "a".into(),
            fallback_id: None,
            strategy: ModelChainStrategy::Serial,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            Err::<String, String>(format!("fail-{}", model_id))
        })
        .await;
        assert!(result.result.is_err());
        assert_eq!(result.actual_model_id, "a");
        assert!(!result.is_fallback);
    }

    #[tokio::test]
    async fn race_fastest_wins() {
        let chain = ModelChain {
            primary_id: "slow".into(),
            fallback_id: Some("fast".into()),
            strategy: ModelChainStrategy::Race,
        };
        let result = execute_with_fallback(&chain, |model_id| async move {
            if model_id == "slow" {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            Ok::<String, String>(format!("ok-{}", model_id))
        })
        .await;
        assert_eq!(result.result.unwrap(), "ok-fast");
        assert_eq!(result.actual_model_id, "fast");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test fallback::tests -- --nocapture 2>&1 | tail -10`
Expected: compilation error — `execute_with_fallback` not defined

- [ ] **Step 3: Implement `execute_with_fallback()`**

Add above the `#[cfg(test)]` block in `src-tauri/src/fallback.rs`:

```rust
use std::future::Future;
use std::time::Duration;

const STAGGERED_DELAY_MS: u64 = 2000;

/// Result of a fallback-aware execution.
/// `R` is typically `Result<T, String>` from the caller's perspective,
/// but we wrap it to track which model was actually used.
pub struct FallbackResult<R> {
    pub result: R,
    pub actual_model_id: String,
    pub is_fallback: bool,
    pub primary_error: Option<String>,
}

/// Execute an async operation with fallback support.
///
/// `execute_fn` receives a model_id (&str) and returns a Future resolving to
/// `Result<T, String>`.  The `ModelChain` determines whether/how the fallback
/// model is invoked.
pub async fn execute_with_fallback<T, F, Fut>(
    chain: &ModelChain,
    execute_fn: F,
) -> FallbackResult<Result<T, String>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>> + Send + 'static,
    T: Send + 'static,
{
    let primary_id = chain.primary_id.clone();

    match (&chain.fallback_id, &chain.strategy) {
        // No fallback configured — just run primary.
        (None, _) => {
            let result = execute_fn(primary_id.clone()).await;
            FallbackResult {
                is_fallback: false,
                actual_model_id: primary_id,
                primary_error: result.as_ref().err().cloned(),
                result,
            }
        }

        // Serial: run primary first, on failure run fallback.
        (Some(fallback_id), ModelChainStrategy::Serial) => {
            let fallback_id = fallback_id.clone();
            match execute_fn(primary_id.clone()).await {
                Ok(val) => FallbackResult {
                    result: Ok(val),
                    actual_model_id: primary_id,
                    is_fallback: false,
                    primary_error: None,
                },
                Err(primary_err) => {
                    log::warn!(
                        "[Fallback] Primary model {} failed: {}, trying fallback {}",
                        primary_id,
                        primary_err,
                        fallback_id
                    );
                    let result = execute_fn(fallback_id.clone()).await;
                    FallbackResult {
                        is_fallback: true,
                        actual_model_id: fallback_id,
                        primary_error: Some(primary_err),
                        result,
                    }
                }
            }
        }

        // Race: run both concurrently, take the first Ok result.
        (Some(fallback_id), ModelChainStrategy::Race) => {
            let fallback_id = fallback_id.clone();
            let primary_fut = tokio::spawn(execute_fn(primary_id.clone()));
            let fallback_fut = tokio::spawn(execute_fn(fallback_id.clone()));

            tokio::select! {
                res = primary_fut => {
                    match res {
                        Ok(Ok(val)) => FallbackResult {
                            result: Ok(val),
                            actual_model_id: primary_id,
                            is_fallback: false,
                            primary_error: None,
                        },
                        _ => {
                            // Primary failed or panicked, wait for fallback.
                            let primary_err = res.map_err(|e| e.to_string()).and_then(|r| r).err();
                            match fallback_fut.await {
                                Ok(result) => FallbackResult {
                                    result,
                                    actual_model_id: fallback_id,
                                    is_fallback: true,
                                    primary_error: primary_err,
                                },
                                Err(e) => FallbackResult {
                                    result: Err(e.to_string()),
                                    actual_model_id: fallback_id,
                                    is_fallback: true,
                                    primary_error: primary_err,
                                },
                            }
                        }
                    }
                }
                res = fallback_fut => {
                    match res {
                        Ok(Ok(val)) => FallbackResult {
                            result: Ok(val),
                            actual_model_id: fallback_id,
                            is_fallback: true,
                            primary_error: None,
                        },
                        _ => {
                            // Fallback failed first, wait for primary.
                            match primary_fut.await {
                                Ok(result) => FallbackResult {
                                    result,
                                    actual_model_id: primary_id,
                                    is_fallback: false,
                                    primary_error: None,
                                },
                                Err(e) => FallbackResult {
                                    result: Err(e.to_string()),
                                    actual_model_id: primary_id,
                                    is_fallback: false,
                                    primary_error: None,
                                },
                            }
                        }
                    }
                }
            }
        }

        // Staggered: run primary, if not done in STAGGERED_DELAY_MS also start fallback.
        (Some(fallback_id), ModelChainStrategy::Staggered) => {
            let fallback_id = fallback_id.clone();
            let primary_fut = tokio::spawn(execute_fn(primary_id.clone()));

            tokio::select! {
                res = &mut primary_fut => {
                    // Primary finished before delay — use it if Ok.
                    match res {
                        Ok(Ok(val)) => FallbackResult {
                            result: Ok(val),
                            actual_model_id: primary_id,
                            is_fallback: false,
                            primary_error: None,
                        },
                        _ => {
                            let primary_err = res.map_err(|e| e.to_string()).and_then(|r| r).err();
                            log::warn!(
                                "[Fallback] Primary {} failed fast, starting fallback {}",
                                primary_id,
                                fallback_id
                            );
                            let result = execute_fn(fallback_id.clone()).await;
                            FallbackResult {
                                result,
                                actual_model_id: fallback_id,
                                is_fallback: true,
                                primary_error: primary_err,
                            }
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(STAGGERED_DELAY_MS)) => {
                    // Primary hasn't finished in time — also start fallback.
                    log::info!(
                        "[Fallback] Primary {} slow (>{}ms), starting fallback {}",
                        primary_id,
                        STAGGERED_DELAY_MS,
                        fallback_id
                    );
                    let fallback_fut = tokio::spawn(execute_fn(fallback_id.clone()));

                    tokio::select! {
                        res = primary_fut => {
                            match res {
                                Ok(Ok(val)) => FallbackResult {
                                    result: Ok(val),
                                    actual_model_id: primary_id,
                                    is_fallback: false,
                                    primary_error: None,
                                },
                                _ => {
                                    let primary_err = res.map_err(|e| e.to_string()).and_then(|r| r).err();
                                    match fallback_fut.await {
                                        Ok(result) => FallbackResult {
                                            result,
                                            actual_model_id: fallback_id,
                                            is_fallback: true,
                                            primary_error: primary_err,
                                        },
                                        Err(e) => FallbackResult {
                                            result: Err(e.to_string()),
                                            actual_model_id: fallback_id,
                                            is_fallback: true,
                                            primary_error: primary_err,
                                        },
                                    }
                                }
                            }
                        }
                        res = fallback_fut => {
                            match res {
                                Ok(Ok(val)) => FallbackResult {
                                    result: Ok(val),
                                    actual_model_id: fallback_id,
                                    is_fallback: true,
                                    primary_error: None,
                                },
                                _ => {
                                    match primary_fut.await {
                                        Ok(result) => FallbackResult {
                                            result,
                                            actual_model_id: primary_id,
                                            is_fallback: false,
                                            primary_error: None,
                                        },
                                        Err(e) => FallbackResult {
                                            result: Err(e.to_string()),
                                            actual_model_id: primary_id,
                                            is_fallback: false,
                                            primary_error: None,
                                        },
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

**Important:** Remove the earlier `FallbackResult` definition that was placed before this function — it's now part of this code block. Keep only one definition.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test fallback::tests -- --nocapture`
Expected: all tests pass (the 5 original serde tests + 5 new execution tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fallback.rs
git commit -m "feat: implement execute_with_fallback with serial/race/staggered strategies"
```

---

### Task 3: Migrate Settings Fields to `ModelChain` (Rust)

**Files:**

- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Add import and replace field types**

In `src-tauri/src/settings.rs`, add import at the top with other crate imports:

```rust
use crate::fallback::{ModelChain, ModelChainStrategy};
```

Replace the 5 field definitions in `AppSettings` struct. Each field changes from `Option<String>` to `Option<ModelChain>`:

Replace line ~836-837:

```rust
#[serde(default)]
pub post_process_intent_model_id: Option<String>,
```

with:

```rust
#[serde(default)]
pub post_process_intent_model: Option<ModelChain>,
```

Replace line ~860-861:

```rust
#[serde(default)]
pub selected_asr_model_id: Option<String>,
```

with:

```rust
#[serde(default)]
pub selected_asr_model: Option<ModelChain>,
```

Replace line ~862-863:

```rust
#[serde(default)]
pub selected_prompt_model_id: Option<String>,
```

with:

```rust
#[serde(default)]
pub selected_prompt_model: Option<ModelChain>,
```

Replace line ~923-924:

```rust
#[serde(default)]
pub length_routing_short_model_id: Option<String>,
```

with:

```rust
#[serde(default)]
pub length_routing_short_model: Option<ModelChain>,
```

Replace line ~925-926:

```rust
#[serde(default)]
pub length_routing_long_model_id: Option<String>,
```

with:

```rust
#[serde(default)]
pub length_routing_long_model: Option<ModelChain>,
```

- [ ] **Step 2: Add helper methods on `ModelChain`**

In `src-tauri/src/fallback.rs`, add a helper for extracting the primary ID (used throughout settings code):

```rust
impl ModelChain {
    /// Get the primary model ID as a reference. Used by code that only needs
    /// the primary ID (e.g., cleanup_stale_model_references).
    pub fn primary_id(&self) -> &str {
        &self.primary_id
    }

    /// Get all model IDs referenced by this chain (for stale reference checking).
    pub fn all_ids(&self) -> Vec<&str> {
        let mut ids = vec![self.primary_id.as_str()];
        if let Some(ref fid) = self.fallback_id {
            ids.push(fid.as_str());
        }
        ids
    }
}
```

- [ ] **Step 3: Update `cleanup_stale_model_references`**

In `src-tauri/src/settings.rs`, the current macro `clear_if_stale!` checks `Option<String>`. Replace it with a new macro and logic that handles `Option<ModelChain>`:

Replace the macro at lines ~1966-1976 and the field calls at lines ~1977-1982:

```rust
// Clear Option<ModelChain> fields if their model IDs are stale.
macro_rules! clear_chain_if_stale {
    ($field:expr) => {
        if let Some(ref mut chain) = $field {
            // Check primary
            if !valid_ids.contains(chain.primary_id.as_str()) {
                log::info!(
                    "[CleanupStale] Clearing stale model chain primary_id={}",
                    chain.primary_id
                );
                $field = None;
                changed = true;
            } else if chain
                .fallback_id
                .as_ref()
                .is_some_and(|fid| !valid_ids.contains(fid.as_str()))
            {
                // Primary is valid but fallback is stale — remove fallback only.
                log::info!(
                    "[CleanupStale] Clearing stale fallback_id={:?} from chain primary_id={}",
                    chain.fallback_id,
                    chain.primary_id
                );
                chain.fallback_id = None;
                changed = true;
            }
        }
    };
}

clear_chain_if_stale!(&mut settings.selected_prompt_model);
clear_chain_if_stale!(&mut settings.selected_asr_model);
clear_chain_if_stale!(&mut settings.post_process_intent_model);
clear_chain_if_stale!(&mut settings.length_routing_short_model);
clear_chain_if_stale!(&mut settings.length_routing_long_model);
```

Keep the existing `clear_if_stale!` macro for fields that remain `Option<String>` (e.g., `post_process_secondary_model_id`, `multi_model_preferred_id`).

- [ ] **Step 4: Update `get_default_settings()` for the 5 fields**

Change the defaults from `None` String to `None` ModelChain. Since both are `Option` defaulting to `None`, this should work without code changes, but verify the field names match.

- [ ] **Step 5: Fix all compiler errors**

The field rename will break many call sites across the codebase. Run `cargo check` and fix each one. The pattern for each call site:

Where code reads `settings.post_process_intent_model_id.as_ref()`, change to `settings.post_process_intent_model.as_ref().map(|c| c.primary_id())`. Do this for **every** compiler error.

**Key files that will have errors (fix in this order):**

1. `src-tauri/src/actions/post_process/routing.rs` — `resolve_intent_routing_model()` reads `post_process_intent_model_id`
2. `src-tauri/src/actions/post_process/pipeline.rs` — reads `length_routing_short_model_id`, `length_routing_long_model_id`, `selected_prompt_model_id`
3. `src-tauri/src/actions/post_process/manual.rs` — reads `selected_prompt_model_id`
4. `src-tauri/src/actions/transcribe.rs` — reads `selected_asr_model_id`
5. `src-tauri/src/shortcut/settings_cmds.rs` — Tauri commands that set these fields
6. Any other files reported by `cargo check`

**Important:** At this stage, only fix the compilation. Don't add fallback execution logic yet — that's Task 4. For now, all code should use `chain.primary_id` to get the same behavior as before.

Run: `cd src-tauri && cargo check 2>&1 | head -50`
Fix errors iteratively until clean.

- [ ] **Step 6: Update Tauri IPC commands**

In `src-tauri/src/shortcut/settings_cmds.rs`, the commands that set model IDs (e.g., `change_post_process_intent_model_id_setting`) need to accept either a `String` (set as primary, keep existing fallback) or a `ModelChain` (replace whole chain).

For now, keep accepting `String` and wrap it: when updating a field, if it already has a `ModelChain`, update `primary_id` only; if `None`, create a new `ModelChain`.

Add a new command for updating the full chain:

```rust
#[tauri::command]
pub fn update_model_chain(
    app: AppHandle,
    field: String,
    chain: Option<crate::fallback::ModelChain>,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE_PATH).map_err(|e| e.to_string())?;
    let mut settings = load_settings_from_store(&store);
    match field.as_str() {
        "post_process_intent_model" => settings.post_process_intent_model = chain,
        "selected_asr_model" => settings.selected_asr_model = chain,
        "selected_prompt_model" => settings.selected_prompt_model = chain,
        "length_routing_short_model" => settings.length_routing_short_model = chain,
        "length_routing_long_model" => settings.length_routing_long_model = chain,
        _ => return Err(format!("Unknown model chain field: {}", field)),
    }
    store_set_settings(&store, &settings);
    Ok(())
}
```

Register this command in `src-tauri/src/lib.rs` in the `invoke_handler` list.

- [ ] **Step 7: Run full check**

Run: `cd src-tauri && cargo check`
Expected: clean compilation

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/fallback.rs src-tauri/src/lib.rs \
  src-tauri/src/actions/ src-tauri/src/shortcut/settings_cmds.rs
git commit -m "refactor: migrate model ID settings fields to ModelChain type"
```

---

### Task 4: Wire Fallback Execution into LLM Call Sites (Rust)

**Files:**

- Modify: `src-tauri/src/actions/post_process/routing.rs`
- Modify: `src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `src-tauri/src/actions/post_process/manual.rs`

This task wraps existing LLM calls with `execute_with_fallback()` at the key call sites. The strategy: instead of changing the deep `execute_llm_request_with_messages()` function, wrap the model-resolution + execution as a closure passed to `execute_with_fallback()`.

- [ ] **Step 1: Update `resolve_intent_routing_model` to accept a model ID parameter**

In `src-tauri/src/actions/post_process/routing.rs`, the current function reads `settings.post_process_intent_model_id` directly. Refactor it to accept an explicit `model_id` parameter, so the fallback executor can call it with different model IDs:

At line ~672, change the signature from:

```rust
pub(crate) fn resolve_intent_routing_model<'a>(
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    fallback_prompt: &LLMPrompt,
) -> Option<(&'a PostProcessProvider, String, String)> {
```

to:

```rust
pub(crate) fn resolve_intent_routing_model_by_id<'a>(
    settings: &'a AppSettings,
    model_id: &str,
) -> Option<(&'a PostProcessProvider, String, String)> {
```

The body: look up `model_id` in `cached_models`, find provider, return `(provider, remote_model_id, api_key)`. This is the same logic as lines 677-712 but using the parameter instead of reading from settings.

Keep the old function name as a wrapper:

```rust
pub(crate) fn resolve_intent_routing_model<'a>(
    settings: &'a AppSettings,
    fallback_provider: &'a PostProcessProvider,
    fallback_prompt: &LLMPrompt,
) -> Option<(&'a PostProcessProvider, String, String)> {
    if let Some(ref chain) = settings.post_process_intent_model {
        if let Some(res) = resolve_intent_routing_model_by_id(settings, &chain.primary_id) {
            return Some(res);
        }
    }
    // Existing fallback to resolve_effective_model
    let (actual_provider, model) =
        resolve_effective_model(settings, fallback_provider, fallback_prompt)?;
    let api_key = settings
        .post_process_api_keys
        .get(&actual_provider.id)
        .cloned()
        .unwrap_or_default();
    Some((actual_provider, model, api_key))
}
```

- [ ] **Step 2: Add fallback wrapper for intent routing in `execute_smart_action_routing`**

In `routing.rs`, in `execute_smart_action_routing()` around line 30, replace the direct model resolution + LLM call with a fallback-wrapped version:

```rust
// If we have a ModelChain with fallback, use execute_with_fallback.
// Otherwise, existing single-call path.
if let Some(ref chain) = settings.post_process_intent_model {
    if chain.fallback_id.is_some() {
        let app = app_handle.clone();
        let s = settings.clone();
        let sys_prompt = system_prompt.clone();
        let text = transcription.to_string();

        let fb_result = crate::fallback::execute_with_fallback(chain, |model_id| {
            let app = app.clone();
            let s = s.clone();
            let sys_prompt = sys_prompt.clone();
            let text = text.clone();
            async move {
                let (provider, model, _api_key) =
                    resolve_intent_routing_model_by_id(&s, &model_id)
                        .ok_or_else(|| format!("Model {} not found", model_id))?;
                let (result, err, error_msg, token_count) =
                    super::core::execute_llm_request(/* ... same params ... */).await;
                if err {
                    Err(error_msg.unwrap_or_else(|| "Unknown error".into()))
                } else {
                    Ok((result, token_count))
                }
            }
        })
        .await;

        if fb_result.is_fallback {
            log::info!(
                "[SmartRouting] Used fallback model {} (primary error: {:?})",
                fb_result.actual_model_id,
                fb_result.primary_error
            );
        }

        // Continue with existing parsing logic using fb_result.result...
    }
}
```

The exact integration depends on the existing code structure — adapt the closure to match the actual parameters of `execute_llm_request`.

- [ ] **Step 3: Add fallback wrapper for single-model polish in `pipeline.rs`**

In `pipeline.rs`, the main polish execution at lines ~1679-1709 resolves a model then calls `execute_llm_request_with_messages`. Wrap this with fallback when the `selected_prompt_model` chain has a fallback.

The pattern is the same: create a closure that takes `model_id`, resolves the model, executes the LLM call, and returns `Result`. Pass this to `execute_with_fallback()`.

- [ ] **Step 4: Add fallback for LitePolish path in `pipeline.rs`**

Lines ~241-325 use `length_routing_short_model`. Apply the same pattern.

- [ ] **Step 5: Add fallback for manual polish in `manual.rs`**

Lines ~31-35 resolve model, lines ~196-212 execute. Wrap with same pattern.

- [ ] **Step 6: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/actions/post_process/
git commit -m "feat: wire execute_with_fallback into LLM post-processing call sites"
```

---

### Task 5: Wire Fallback into Online ASR (Rust)

**Files:**

- Modify: `src-tauri/src/actions/transcribe.rs`

- [ ] **Step 1: Refactor online ASR call into a reusable closure**

In `transcribe.rs` at lines ~556-602, the online ASR call resolves the model, finds the provider, and calls `client.transcribe()`. Extract this into a function that takes a `model_id` parameter:

```rust
fn build_online_asr_task(
    settings: &AppSettings,
    model_id: &str,
    samples: Vec<f32>,
    language: String,
) -> Result<tokio::task::JoinHandle<anyhow::Result<String>>, String> {
    let cached_model = settings
        .cached_models
        .iter()
        .find(|m| m.model_type == crate::settings::ModelType::Asr && m.id == model_id)
        .ok_or_else(|| format!("ASR model {} not found", model_id))?;

    let provider_info = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == cached_model.provider_id)
        .cloned()
        .ok_or_else(|| format!("Provider {} not found", cached_model.provider_id))?;

    let api_key = settings
        .post_process_api_keys
        .get(&cached_model.provider_id)
        .cloned();
    let remote_model_id = cached_model.model_id.clone();

    Ok(tokio::task::spawn_blocking(move || {
        let client = OnlineAsrClient::new(16000, std::time::Duration::from_secs(120));
        let lang = if language == "auto" { None } else { Some(language.as_str()) };
        client.transcribe(&provider_info, api_key, &remote_model_id, lang, &samples)
    }))
}
```

- [ ] **Step 2: Wrap with `execute_with_fallback` when chain has fallback**

Replace the existing online ASR call with:

```rust
if let Some(ref chain) = settings.selected_asr_model {
    if chain.fallback_id.is_some() {
        let fb_result = crate::fallback::execute_with_fallback(chain, |model_id| {
            let s = settings.clone();
            let samples = samples_for_online.clone();
            let lang = language.clone();
            async move {
                let handle = build_online_asr_task(&s, &model_id, samples, lang)
                    .map_err(|e| e.to_string())?;
                handle.await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
            }
        }).await;

        if fb_result.is_fallback {
            log::info!("[ASR] Used fallback model {}", fb_result.actual_model_id);
        }
        // Use fb_result.result...
    } else {
        // Existing single-model path using chain.primary_id
    }
}
```

- [ ] **Step 3: Ensure ASR fallback runs before local fallback**

The existing local fallback logic (lines ~687-739) should remain as a second layer. Structure:

1. Try online chain (primary → fallback via `execute_with_fallback`)
2. If online chain fails entirely, fall back to local (existing mechanism)

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs
git commit -m "feat: wire execute_with_fallback into online ASR transcription"
```

---

### Task 6: Metrics — Track Fallback Usage (Rust)

**Files:**

- Modify: `src-tauri/src/managers/llm_metrics.rs`

- [ ] **Step 1: Add `is_fallback` field to `LlmCallRecord`**

Find the `LlmCallRecord` struct and add:

```rust
#[serde(default)]
pub is_fallback: bool,
```

- [ ] **Step 2: Update the database schema**

In the `CREATE TABLE` statement for `llm_call_log`, add column:

```sql
is_fallback INTEGER NOT NULL DEFAULT 0
```

- [ ] **Step 3: Update insert statements**

Find the `INSERT INTO llm_call_log` SQL and add the `is_fallback` column.

- [ ] **Step 4: Update callers to pass `is_fallback`**

In `pipeline.rs` and `transcribe.rs`, where `LlmCallRecord` is constructed after a `FallbackResult`, set `is_fallback: fb_result.is_fallback`.

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/managers/llm_metrics.rs src-tauri/src/actions/
git commit -m "feat: track fallback usage in LLM call metrics"
```

---

### Task 7: Frontend — `ModelChain` Types & Store (TypeScript)

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add Zod schema for `ModelChain`**

In `src/lib/types.ts`, add near the other schema definitions:

```typescript
export const ModelChainStrategySchema = z.enum(["serial", "staggered", "race"]);
export type ModelChainStrategy = z.infer<typeof ModelChainStrategySchema>;

export const ModelChainSchema = z.object({
  primary_id: z.string(),
  fallback_id: z.string().nullable().optional().default(null),
  strategy: ModelChainStrategySchema.optional().default("serial"),
});
export type ModelChain = z.infer<typeof ModelChainSchema>;
```

- [ ] **Step 2: Update Settings schema fields**

Replace the 5 fields:

```typescript
// Before:
post_process_intent_model_id: z.string().nullable().optional().default(null),
selected_asr_model_id: z.string().nullable().optional(),
selected_prompt_model_id: z.string().nullable().optional(),
length_routing_short_model_id: z.string().nullable().optional().default(null),
length_routing_long_model_id: z.string().nullable().optional().default(null),

// After:
post_process_intent_model: ModelChainSchema.nullable().optional().default(null),
selected_asr_model: ModelChainSchema.nullable().optional().default(null),
selected_prompt_model: ModelChainSchema.nullable().optional().default(null),
length_routing_short_model: ModelChainSchema.nullable().optional().default(null),
length_routing_long_model: ModelChainSchema.nullable().optional().default(null),
```

- [ ] **Step 3: Add `updateModelChain` action to store**

In `src/stores/settingsStore.ts`, add:

```typescript
updateModelChain: async (field: string, chain: ModelChain | null) => {
  const { setUpdating, refreshSettings } = get();
  setUpdating(field, true);
  try {
    await invoke("update_model_chain", { field, chain });
    await refreshSettings();
  } finally {
    setUpdating(field, false);
  }
},
```

- [ ] **Step 4: Fix TypeScript compilation errors**

Run: `cd /Users/zac/code/github/asr/Handy && npx tsc --noEmit 2>&1 | head -30`

Fix all references to the old field names throughout the frontend code. Pattern: `settings.post_process_intent_model_id` → `settings.post_process_intent_model?.primary_id`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/stores/settingsStore.ts
git commit -m "feat: add ModelChain TypeScript types and store action"
```

---

### Task 8: Frontend — LLM ModelChainSelector Dialog Component

**Files:**

- Create: `src/components/ui/ModelChainSelector.tsx`
- Modify: `src/i18n/locales/zh/translation.json`
- Modify: `src/i18n/locales/en/translation.json`

- [ ] **Step 1: Add i18n keys**

In `src/i18n/locales/zh/translation.json`, add under `settings.postProcessing`:

```json
"modelChain": {
  "primary": "主模型",
  "fallback": "备选",
  "leftClickPrimary": "左键选择主模型",
  "rightClickFallback": "右键选择备选模型",
  "strategy": "策略",
  "serial": "串行",
  "staggered": "延迟",
  "race": "竞速",
  "serialHint": "主模型失败后再调备选",
  "staggeredHint": "主模型慢时自动启动备选",
  "raceHint": "同时调用，取最快",
  "noPrimary": "未选择模型",
  "selectModel": "选择模型"
}
```

Add corresponding English keys in `en/translation.json`.

- [ ] **Step 2: Create `ModelChainSelector` component**

```tsx
// src/components/ui/ModelChainSelector.tsx
import { useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { ModelChain, ModelChainStrategy, Settings } from "@/lib/types";

interface ModelChainSelectorProps {
  chain: ModelChain | null;
  onChange: (chain: ModelChain | null) => void;
  /** Filter cached models — e.g. only "text" type */
  modelFilter?: (model: Settings["cached_models"][number]) => boolean;
  /** Default strategy when fallback is first selected */
  defaultStrategy?: ModelChainStrategy;
  disabled?: boolean;
}

export function ModelChainSelector({
  chain,
  onChange,
  modelFilter,
  defaultStrategy = "serial",
  disabled,
}: ModelChainSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // ... Component implementation:
  //
  // Collapsed state:
  //   Shows primary model name (normal style)
  //   Below it: fallback model name in muted text + strategy badge
  //   If no chain: shows placeholder "未选择模型"
  //   onClick → setOpen(true)
  //
  // Dialog (open state):
  //   Lists all cached models grouped by provider
  //   Left click (onClick) → set as primary (● marker)
  //   Right click (onContextMenu, preventDefault) → set as fallback (○ marker)
  //   Click on already-selected → deselect
  //   Bottom bar: strategy pills (only shown when fallback is set)
  //   Close → call onChange with new ModelChain
}
```

The component reads `cached_models` from settings store, groups by `provider_id`, and renders model cards. Each card shows:

- Model name (custom_label or model_id)
- Provider badge
- ● if primary, ○ if fallback

- [ ] **Step 3: Verify it renders**

Run: `bun dev` and navigate to a settings page that uses the component (will be wired in Task 9).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ModelChainSelector.tsx src/i18n/locales/
git commit -m "feat: add ModelChainSelector dialog component with left/right click"
```

---

### Task 9: Frontend — Replace Settings Model Selectors with ModelChainSelector

**Files:**

- Modify: `src/components/settings/post-processing/IntentModelSelection.tsx`
- Modify: `src/components/settings/post-processing/PromoteModelSelection.tsx`
- Modify: `src/components/settings/post-processing/LengthRoutingSettings.tsx`

- [ ] **Step 1: Replace IntentModelSelection**

Replace the Dropdown in `IntentModelSelection.tsx` with `ModelChainSelector`:

```tsx
import { ModelChainSelector } from "@/components/ui/ModelChainSelector";

// In the component:
<ModelChainSelector
  chain={settings?.post_process_intent_model ?? null}
  onChange={(chain) => updateModelChain("post_process_intent_model", chain)}
  modelFilter={(m) => m.model_type === "text"}
  defaultStrategy="serial"
  disabled={!settings?.post_process_enabled}
/>;
```

- [ ] **Step 2: Replace PromoteModelSelection**

Same pattern, using `selected_prompt_model` field with `defaultStrategy="staggered"`.

- [ ] **Step 3: Replace LengthRoutingSettings model selectors**

Replace the short model and long model dropdowns with `ModelChainSelector`, using `length_routing_short_model` (defaultStrategy="serial") and `length_routing_long_model` (defaultStrategy="staggered").

- [ ] **Step 4: Verify UI renders correctly**

Run: `bun dev`, open Settings → Post-Processing. Check each selector shows correctly.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/post-processing/
git commit -m "feat: replace settings model dropdowns with ModelChainSelector"
```

---

### Task 10: Frontend — ASR Fallback Selector in Footer

**Files:**

- Create: `src/components/model-selector/AsrFallbackSelector.tsx`
- Modify: `src/components/model-selector/ModelDropdown.tsx`

- [ ] **Step 1: Add ASR-specific i18n keys**

In `src/i18n/locales/zh/translation.json`, add under `modelSelector`:

```json
"asrFallback": {
  "add": "+ 备用",
  "remove": "移除备用",
  "label": "备用"
}
```

- [ ] **Step 2: Create `AsrFallbackSelector` component**

```tsx
// src/components/model-selector/AsrFallbackSelector.tsx
import { useState } from "react";
import { Popover } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { ModelChain, ModelChainStrategy } from "@/lib/types";

interface AsrFallbackSelectorProps {
  chain: ModelChain | null;
  onUpdate: (chain: ModelChain | null) => void;
  asrModels: Array<{ id: string; name: string; provider_id: string }>;
}

export function AsrFallbackSelector({
  chain,
  onUpdate,
  asrModels,
}: AsrFallbackSelectorProps) {
  const { t } = useTranslation();
  // ... Component implementation:
  //
  // If no fallback set: show dashed border box "＋ 备用"
  //   Only visible when asrModels.length >= 2
  //   Click → Popover from bottom with available ASR models (excluding primary)
  //   Popover bottom: strategy pills
  //
  // If fallback set: show solid box with model name + strategy badge + ✕ clear button
  //   ✕ click → clear fallback_id from chain, call onUpdate
}
```

- [ ] **Step 3: Integrate into `ModelDropdown.tsx`**

In `ModelDropdown.tsx`, after the ASR model list section (around line 387), add the `AsrFallbackSelector`:

```tsx
{
  onlineEnabled && asrModels.length >= 2 && (
    <AsrFallbackSelector
      chain={settings?.selected_asr_model ?? null}
      onUpdate={(chain) => updateModelChain("selected_asr_model", chain)}
      asrModels={asrModels.filter((m) => m.id !== selectedAsrModelId)}
    />
  );
}
```

- [ ] **Step 4: Verify UI renders**

Run: `bun dev`, check the footer model selector. If you have 2+ online ASR models, the `+ 备用` box should appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/model-selector/
git commit -m "feat: add ASR fallback selector with popover in footer"
```

---

### Task 11: End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass including new fallback tests

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: no type errors

- [ ] **Step 3: Build full app**

Run: `bun tauri build --debug 2>&1 | tail -20`
Expected: successful build

- [ ] **Step 4: Manual smoke test**

1. Launch the app
2. Open Settings → Post-Processing
3. Verify IntentModelSelection shows ModelChainSelector
4. Left-click to set primary, right-click to set fallback
5. Verify strategy pills appear when fallback is set
6. Close dialog → collapsed view shows primary + fallback in muted text
7. Check Footer ASR selector: `+ 备用` visible with 2+ online models
8. Select ASR fallback, verify it persists
9. Close and reopen app → settings preserved (backward compat)

- [ ] **Step 5: Test with old settings file**

Manually edit the settings JSON to have old format (`"post_process_intent_model_id": "some-id"`), restart the app, verify it loads correctly and shows the model.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end verification fixes for model fallback chain"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-01-model-fallback-chain.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
