# Dual Credentials & Global Proxy Support

**Date:** 2026-04-03
**Status:** Approved

## Intent

1. Allow multiple API keys per provider with round-robin rotation and error-based cooldown
2. Add global proxy support with per-provider override capability

## Constraints

- Backward compatible with existing single-key `SecretMap` serialization
- Proxy injection centralized — no scattered `reqwest::Client::builder()` patterns
- Minimal UI footprint — multi-key as list in existing API settings, proxy in advanced settings

---

## Design

### 1. Multi-Key Storage (SecretKeyRing)

**New types in `settings.rs`:**

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct KeyEntry {
    pub key: String,
    pub enabled: bool,
    pub label: Option<String>, // e.g. "Personal", "Work"
}

#[derive(Clone, Serialize, Type)]
pub struct SecretKeyRing(pub HashMap<String, Vec<KeyEntry>>);
```

**Backward-compatible deserialization:** Custom `Deserialize` impl that detects old format (`HashMap<String, String>`) and converts each value to `vec![KeyEntry { key: value, enabled: true, label: None }]`. New format deserializes directly.

**Field replacement in AppSettings:**

```rust
// Old: pub post_process_api_keys: SecretMap
// New:
pub post_process_api_keys: SecretKeyRing,
```

### 2. Runtime Key Selector

**New file: `src-tauri/src/key_selector.rs`**

```rust
pub struct KeySelectorState {
    index: usize,
    cooldowns: Vec<Option<Instant>>, // per-key cooldown expiry
}

pub struct KeySelector {
    state: Mutex<HashMap<String, KeySelectorState>>,
}
```

**API:**

- `next_key(provider_id, keys: &[KeyEntry]) -> Option<(usize, &str)>` — Round-robin, skip disabled + cooled-down keys. If all in cooldown, return the one closest to expiry.
- `mark_error(provider_id, key_index, cooldown_secs: u64)` — Put key into cooldown (default 60s for 429, 300s for 401/403).
- `reset(provider_id)` — Clear state when keys are reconfigured.

**Managed state:** Registered as `app.manage(KeySelector::new())` in Tauri setup.

### 3. Proxy Configuration

**New fields in `AppSettings`:**

```rust
#[serde(default)]
pub proxy_url: Option<String>,        // e.g. "http://127.0.0.1:7890"
#[serde(default)]
pub proxy_global_enabled: bool,       // default: false
```

**New field in `PostProcessProvider`:**

```rust
#[serde(default)]
pub proxy_override: ProxyOverride,    // default: FollowGlobal
```

**ProxyOverride enum:**

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Default, Type)]
pub enum ProxyOverride {
    #[default]
    FollowGlobal,
    ForceEnabled,
    ForceDisabled,
}
```

**Resolution logic:**
| `proxy_global_enabled` | `proxy_override` | Effective |
|---|---|---|
| true | FollowGlobal | Use proxy |
| true | ForceDisabled | No proxy |
| false | FollowGlobal | No proxy |
| false | ForceEnabled | Use proxy |
| any | any | No proxy if `proxy_url` is None |

### 4. Centralized HTTP Client Builder

**New file: `src-tauri/src/http_client.rs`**

```rust
pub fn build_http_client(
    proxy_url: Option<&str>,
    timeout: Duration,
    default_headers: HeaderMap,
) -> Result<reqwest::Client, String>
```

Replaces all 8 `reqwest::Client::builder()` call sites:

- `llm_client.rs` (2 sites: create_client, fetch_models)
- `core.rs` (1 site: LLM request)
- `extensions.rs` (1 site: multi-model)
- `provider_cmds.rs` (2 sites: avatar, favicon)
- `free_models.rs` (1 site: refresh)
- `model.rs` (1 site: download)

### 5. Integration Points

**core.rs `execute_llm_request_inner()`:**

1. Get `KeySelector` from managed state
2. Call `next_key(provider_id, keys)` instead of single key lookup
3. On `LlmError::ApiError { status: 429 | 401 | 403 }`, call `mark_error()`
4. Resolve effective proxy from provider + global settings
5. Use `build_http_client()` with resolved proxy

**extensions.rs multi-model:**
Same key selection + proxy injection pattern.

**llm_client.rs:**
Accept optional proxy URL parameter, pass to `build_http_client()`.

### 6. Tauri Commands (Backend API)

```rust
// Key management
#[tauri::command]
fn get_api_keys(provider_id: String) -> Vec<KeyEntry>
#[tauri::command]
fn set_api_keys(provider_id: String, keys: Vec<KeyEntry>)
#[tauri::command]
fn add_api_key(provider_id: String, key: String, label: Option<String>)
#[tauri::command]
fn remove_api_key(provider_id: String, index: usize)

// Proxy
#[tauri::command]
fn get_proxy_settings() -> ProxySettings
#[tauri::command]
fn set_proxy_settings(url: Option<String>, global_enabled: bool)
#[tauri::command]
fn set_provider_proxy_override(provider_id: String, override: ProxyOverride)
```

### 7. Frontend UI

**Multi-Key List (in ApiSettings.tsx):**

- Replace single `TextField` with a list component
- Each row: masked key input + label input + enable toggle + delete button
- "Add Key" button at bottom
- First key auto-labeled as primary

**Proxy Settings (in post-processing AdvancedSettings.tsx):**

- New "Proxy" group:
  - URL input field (placeholder: `http://127.0.0.1:7890`)
  - Global enable toggle with description
- Per-provider: dropdown in ApiSettings.tsx next to custom headers area

---

## Boundaries

### Allowed Files

- `src-tauri/src/settings.rs` — new types, field changes
- `src-tauri/src/key_selector.rs` — new file
- `src-tauri/src/http_client.rs` — new file
- `src-tauri/src/llm_client.rs` — use centralized builder
- `src-tauri/src/actions/post_process/core.rs` — key rotation + proxy
- `src-tauri/src/actions/post_process/extensions.rs` — key rotation + proxy
- `src-tauri/src/shortcut/provider_cmds.rs` — proxy injection
- `src-tauri/src/managers/free_models.rs` — proxy injection
- `src-tauri/src/managers/model.rs` — proxy injection
- `src-tauri/src/lib.rs` — register new commands + managed state
- `src-tauri/src/commands/` — new command handlers
- `src/components/settings/post-processing/ApiSettings.tsx` — multi-key UI
- `src/components/settings/post-processing/AdvancedSettings.tsx` — proxy UI
- `src/stores/settingsStore.ts` — new settings fields
- `src/hooks/useSettings.ts` — new hooks

### Forbidden

- Do not modify prompt files or AI logic
- Do not change transcription pipeline
- Do not alter review window behavior
