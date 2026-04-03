# Dual Credentials & Global Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple API keys per provider with round-robin rotation + error cooldown, and add global proxy support with per-provider override.

**Architecture:** Replace `SecretMap(HashMap<String, String>)` with `SecretKeyRing(HashMap<String, Vec<KeyEntry>>)` using backward-compatible deserialization. Add `KeySelector` as Tauri managed state for runtime rotation. Centralize all `reqwest::Client` construction through a shared `build_http_client()` helper that injects proxy when configured. Add proxy settings to `AppSettings` and `PostProcessProvider`.

**Tech Stack:** Rust (serde custom deserialize, reqwest proxy), React (Radix UI, Zustand), Tauri 2.x commands

---

## Task 1: SecretKeyRing Data Type

**Files:**

- Modify: `src-tauri/src/settings.rs:680-708` (replace SecretMap)

- [ ] **Step 1: Define KeyEntry and SecretKeyRing types**

Add after line 679 in `settings.rs`, replacing the existing `SecretMap` definition (lines 680-708):

```rust
/// A single API key entry with metadata
#[derive(Clone, Serialize, Deserialize, Type)]
pub struct KeyEntry {
    pub key: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub label: Option<String>,
}

/// A map of provider_id → list of API key entries.
/// Backward-compatible: deserializes from old `HashMap<String, String>` format
/// by converting each single string value to a one-element Vec<KeyEntry>.
#[derive(Clone, Serialize, Type)]
#[serde(transparent)]
pub struct SecretKeyRing(pub HashMap<String, Vec<KeyEntry>>);

impl fmt::Debug for SecretKeyRing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let redacted: HashMap<&String, usize> = self
            .0
            .iter()
            .map(|(k, v)| (k, v.iter().filter(|e| !e.key.is_empty()).count()))
            .collect();
        write!(f, "SecretKeyRing({:?})", redacted)
    }
}

impl std::ops::Deref for SecretKeyRing {
    type Target = HashMap<String, Vec<KeyEntry>>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for SecretKeyRing {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
```

- [ ] **Step 2: Add custom Deserialize impl for backward compatibility**

Add below the SecretKeyRing definition:

```rust
impl<'de> Deserialize<'de> for SecretKeyRing {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de;

        // Try to deserialize as the new format first
        let value = serde_json::Value::deserialize(deserializer)?;

        match value {
            serde_json::Value::Object(map) => {
                let mut result = HashMap::new();
                for (key, val) in map {
                    match val {
                        // Old format: provider_id → single string
                        serde_json::Value::String(s) => {
                            if s.is_empty() {
                                result.insert(key, Vec::new());
                            } else {
                                result.insert(
                                    key,
                                    vec![KeyEntry {
                                        key: s,
                                        enabled: true,
                                        label: None,
                                    }],
                                );
                            }
                        }
                        // New format: provider_id → array of KeyEntry
                        serde_json::Value::Array(_) => {
                            let entries: Vec<KeyEntry> =
                                serde_json::from_value(val).map_err(de::Error::custom)?;
                            result.insert(key, entries);
                        }
                        _ => {
                            result.insert(key, Vec::new());
                        }
                    }
                }
                Ok(SecretKeyRing(result))
            }
            _ => Ok(SecretKeyRing(HashMap::new())),
        }
    }
}
```

- [ ] **Step 3: Update AppSettings field type**

Change line 822-823 from:

```rust
#[serde(default = "default_post_process_api_keys")]
pub post_process_api_keys: SecretMap,
```

To:

```rust
#[serde(default = "default_post_process_api_keys")]
pub post_process_api_keys: SecretKeyRing,
```

- [ ] **Step 4: Update default_post_process_api_keys()**

Change lines 1153-1159 from:

```rust
fn default_post_process_api_keys() -> SecretMap {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(provider.id, String::new());
    }
    SecretMap(map)
}
```

To:

```rust
fn default_post_process_api_keys() -> SecretKeyRing {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(provider.id, Vec::new());
    }
    SecretKeyRing(map)
}
```

- [ ] **Step 5: Add helper method to SecretKeyRing for getting first enabled key**

```rust
impl SecretKeyRing {
    /// Get the first enabled, non-empty key for a provider (convenience for single-key usage)
    pub fn first_key(&self, provider_id: &str) -> Option<&str> {
        self.0
            .get(provider_id)
            .and_then(|keys| keys.iter().find(|k| k.enabled && !k.key.is_empty()))
            .map(|k| k.key.as_str())
    }

    /// Get all enabled, non-empty keys for a provider
    pub fn enabled_keys(&self, provider_id: &str) -> Vec<&KeyEntry> {
        self.0
            .get(provider_id)
            .map(|keys| keys.iter().filter(|k| k.enabled && !k.key.is_empty()).collect())
            .unwrap_or_default()
    }
}
```

- [ ] **Step 6: Fix all compilation errors from SecretMap → SecretKeyRing**

Update callers that used `settings.post_process_api_keys.get(&provider.id).cloned().unwrap_or_default()`:

**`src-tauri/src/actions/post_process/core.rs:444-448`** — change:

```rust
let api_key = settings
    .post_process_api_keys
    .get(&provider.id)
    .cloned()
    .unwrap_or_default();
```

To:

```rust
let api_key = settings
    .post_process_api_keys
    .first_key(&provider.id)
    .unwrap_or("")
    .to_string();
```

**`src-tauri/src/actions/post_process/extensions.rs:652-656`** — same change pattern.

**`src-tauri/src/shortcut/settings_cmds.rs:87`** — change:

```rust
settings.post_process_api_keys.insert(provider_id, api_key);
```

To:

```rust
settings.post_process_api_keys.insert(
    provider_id,
    vec![KeyEntry {
        key: api_key,
        enabled: true,
        label: None,
    }],
);
```

Search for any other `.post_process_api_keys` usages and update accordingly.

- [ ] **Step 7: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -50`

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/extensions.rs src-tauri/src/shortcut/settings_cmds.rs
git commit -m "Replace SecretMap with SecretKeyRing for multi-key support

Backward-compatible deserialization converts old single-string format
to Vec<KeyEntry> automatically. Adds first_key() and enabled_keys()
helpers."
```

---

## Task 2: KeySelector Runtime State

**Files:**

- Create: `src-tauri/src/key_selector.rs`
- Modify: `src-tauri/src/lib.rs` (register managed state + mod declaration)

- [ ] **Step 1: Create key_selector.rs**

Create `src-tauri/src/key_selector.rs`:

```rust
use crate::settings::KeyEntry;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// Cooldown duration for rate-limited keys (429)
const RATE_LIMIT_COOLDOWN_SECS: u64 = 60;
/// Cooldown duration for auth-failed keys (401/403)
const AUTH_FAIL_COOLDOWN_SECS: u64 = 300;

struct ProviderState {
    index: usize,
    /// Per-key cooldown expiry (None = not in cooldown)
    cooldowns: Vec<Option<Instant>>,
}

/// Thread-safe key rotator with round-robin and error-based cooldown.
/// Registered as Tauri managed state.
pub struct KeySelector {
    state: Mutex<HashMap<String, ProviderState>>,
}

impl KeySelector {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(HashMap::new()),
        }
    }

    /// Select the next available key using round-robin.
    /// Skips disabled and cooled-down keys.
    /// Returns (key_index_in_enabled_list, api_key_string).
    /// If all keys are in cooldown, returns the one closest to expiry.
    pub fn next_key<'a>(&self, provider_id: &str, keys: &'a [KeyEntry]) -> Option<(usize, &'a str)> {
        let enabled: Vec<(usize, &KeyEntry)> = keys
            .iter()
            .enumerate()
            .filter(|(_, k)| k.enabled && !k.key.is_empty())
            .collect();

        if enabled.is_empty() {
            return None;
        }

        let mut state = self.state.lock().unwrap();
        let provider_state = state.entry(provider_id.to_string()).or_insert_with(|| {
            ProviderState {
                index: 0,
                cooldowns: vec![None; keys.len()],
            }
        });

        // Ensure cooldowns vec matches keys length
        provider_state.cooldowns.resize(keys.len(), None);

        let now = Instant::now();
        let count = enabled.len();

        // Try round-robin, skipping cooled-down keys
        for offset in 0..count {
            let pos = (provider_state.index + offset) % count;
            let (original_idx, entry) = enabled[pos];

            let is_cooled_down = provider_state
                .cooldowns
                .get(original_idx)
                .and_then(|c| *c)
                .map(|expiry| now < expiry)
                .unwrap_or(false);

            if !is_cooled_down {
                provider_state.index = (pos + 1) % count;
                return Some((original_idx, &entry.key));
            }
        }

        // All keys in cooldown — pick the one expiring soonest
        let mut best: Option<(usize, &str, Instant)> = None;
        for &(original_idx, entry) in &enabled {
            if let Some(Some(expiry)) = provider_state.cooldowns.get(original_idx) {
                match &best {
                    None => best = Some((original_idx, &entry.key, *expiry)),
                    Some((_, _, best_expiry)) if expiry < best_expiry => {
                        best = Some((original_idx, &entry.key, *expiry));
                    }
                    _ => {}
                }
            }
        }

        best.map(|(idx, key, _)| (idx, key))
    }

    /// Put a key into cooldown after an error.
    pub fn mark_error(&self, provider_id: &str, key_index: usize, status_code: u16) {
        let cooldown_secs = match status_code {
            429 => RATE_LIMIT_COOLDOWN_SECS,
            401 | 403 => AUTH_FAIL_COOLDOWN_SECS,
            _ => RATE_LIMIT_COOLDOWN_SECS,
        };

        let mut state = self.state.lock().unwrap();
        if let Some(provider_state) = state.get_mut(provider_id) {
            if key_index < provider_state.cooldowns.len() {
                provider_state.cooldowns[key_index] =
                    Some(Instant::now() + std::time::Duration::from_secs(cooldown_secs));
            }
        }
    }

    /// Reset state for a provider (call when keys are reconfigured).
    pub fn reset(&self, provider_id: &str) {
        let mut state = self.state.lock().unwrap();
        state.remove(provider_id);
    }
}
```

- [ ] **Step 2: Register module and managed state**

In `src-tauri/src/lib.rs`, add module declaration after line 15 (`mod llm_client;`):

```rust
mod key_selector;
```

In the setup block (around line 193, after `app_handle.manage(free_models_cache.clone());`), add:

```rust
app_handle.manage(key_selector::KeySelector::new());
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/key_selector.rs src-tauri/src/lib.rs
git commit -m "Add KeySelector for round-robin API key rotation with cooldown"
```

---

## Task 3: Integrate KeySelector into LLM Request Pipeline

**Files:**

- Modify: `src-tauri/src/actions/post_process/core.rs:444-448, 690-693`
- Modify: `src-tauri/src/actions/post_process/extensions.rs:652-656, 855-858`

- [ ] **Step 1: Update core.rs to use KeySelector**

In `core.rs`, the function `execute_llm_request_inner` needs to accept `AppHandle` to access managed state. Check the existing function signature — it likely already has access to `app` or `settings`.

Find where `api_key` is retrieved (line 444-448) and replace with:

```rust
// Get key via rotation
let key_selector = app.state::<crate::key_selector::KeySelector>();
let keys = settings
    .post_process_api_keys
    .get(&provider.id)
    .cloned()
    .unwrap_or_default();
let (key_index, api_key) = match key_selector.next_key(&provider.id, &keys) {
    Some((idx, key)) => (idx, key.to_string()),
    None => (0, String::new()),
};
```

Then in the error handling path (where `LlmError::ApiError` is returned), add cooldown marking. Find the status code check and add:

```rust
// After detecting status code for error response
if matches!(status_code, 429 | 401 | 403) {
    key_selector.mark_error(&provider.id, key_index, status_code);
}
```

- [ ] **Step 2: Update extensions.rs to use KeySelector**

Same pattern as core.rs. In `execute_single_model_post_process` (around line 652), replace the api_key retrieval:

```rust
let key_selector = app.state::<crate::key_selector::KeySelector>();
let keys = settings
    .post_process_api_keys
    .get(&provider.id)
    .cloned()
    .unwrap_or_default();
let (key_index, api_key) = match key_selector.next_key(&provider.id, &keys) {
    Some((idx, key)) => (idx, key.to_string()),
    None => (0, String::new()),
};
```

And add error cooldown where the HTTP error status is detected (around line 875):

```rust
if !resp.status().is_success() {
    let status = resp.status();
    if matches!(status.as_u16(), 429 | 401 | 403) {
        key_selector.mark_error(&provider.id, key_index, status.as_u16());
    }
    // ... existing error handling
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/extensions.rs
git commit -m "Integrate KeySelector into LLM request pipeline for key rotation"
```

---

## Task 4: Proxy Configuration Types & Settings

**Files:**

- Modify: `src-tauri/src/settings.rs` (add ProxyOverride enum, new fields)

- [ ] **Step 1: Add ProxyOverride enum**

Add after the `PostProcessProvider` definition (around line 230):

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProxyOverride {
    #[default]
    FollowGlobal,
    ForceEnabled,
    ForceDisabled,
}
```

- [ ] **Step 2: Add proxy_override to PostProcessProvider**

Add a new field to the `PostProcessProvider` struct (after `custom_headers`):

```rust
/// Per-provider proxy override: follow global, force on, or force off
#[serde(default)]
pub proxy_override: ProxyOverride,
```

- [ ] **Step 3: Add global proxy fields to AppSettings**

Add after `post_process_provider_id` field (around line 819):

```rust
/// Global proxy URL (e.g. "http://127.0.0.1:7890", "socks5://...")
#[serde(default)]
pub proxy_url: Option<String>,
/// Whether proxy is enabled globally by default
#[serde(default)]
pub proxy_global_enabled: bool,
```

- [ ] **Step 4: Add resolve_proxy helper**

Add as a standalone function in `settings.rs`:

```rust
/// Resolve effective proxy URL for a provider based on global and per-provider settings.
pub fn resolve_proxy(settings: &AppSettings, provider: &PostProcessProvider) -> Option<String> {
    let proxy_url = settings.proxy_url.as_deref().filter(|u| !u.is_empty())?;

    let use_proxy = match provider.proxy_override {
        ProxyOverride::ForceEnabled => true,
        ProxyOverride::ForceDisabled => false,
        ProxyOverride::FollowGlobal => settings.proxy_global_enabled,
    };

    if use_proxy {
        Some(proxy_url.to_string())
    } else {
        None
    }
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "Add ProxyOverride enum and global proxy settings fields"
```

---

## Task 5: Centralized HTTP Client Builder

**Files:**

- Create: `src-tauri/src/http_client.rs`
- Modify: `src-tauri/src/lib.rs` (add mod declaration)

- [ ] **Step 1: Create http_client.rs**

Create `src-tauri/src/http_client.rs`:

```rust
use log::debug;
use reqwest::header::HeaderMap;
use std::time::Duration;

/// Build a reqwest HTTP client with optional proxy support.
/// All HTTP client creation should go through this function.
pub fn build_http_client(
    proxy_url: Option<&str>,
    timeout: Duration,
    default_headers: HeaderMap,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .default_headers(default_headers)
        .timeout(timeout);

    if let Some(url) = proxy_url {
        if !url.is_empty() {
            debug!("[HttpClient] Using proxy: {}", url);
            let proxy = reqwest::Proxy::all(url)
                .map_err(|e| format!("Invalid proxy URL '{}': {}", url, e))?;
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Build a blocking reqwest HTTP client with optional proxy support.
/// Used for online ASR (which uses reqwest::blocking).
pub fn build_blocking_http_client(
    proxy_url: Option<&str>,
    timeout: Duration,
) -> Result<reqwest::blocking::Client, String> {
    let mut builder = reqwest::blocking::Client::builder().timeout(timeout);

    if let Some(url) = proxy_url {
        if !url.is_empty() {
            debug!("[HttpClient] Using blocking proxy: {}", url);
            let proxy = reqwest::Proxy::all(url)
                .map_err(|e| format!("Invalid proxy URL '{}': {}", url, e))?;
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build blocking HTTP client: {}", e))
}
```

- [ ] **Step 2: Add module declaration in lib.rs**

Add after the `key_selector` mod declaration:

```rust
pub mod http_client;
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/http_client.rs src-tauri/src/lib.rs
git commit -m "Add centralized http_client module with proxy support"
```

---

## Task 6: Replace All reqwest::Client::builder() Call Sites

**Files:**

- Modify: `src-tauri/src/llm_client.rs:24-28, 69-72`
- Modify: `src-tauri/src/actions/post_process/core.rs:690-693`
- Modify: `src-tauri/src/actions/post_process/extensions.rs:855-858`
- Modify: `src-tauri/src/shortcut/provider_cmds.rs:211, 296`
- Modify: `src-tauri/src/managers/free_models.rs:94`
- Modify: `src-tauri/src/managers/model.rs:1098`
- Modify: `src-tauri/src/online_asr.rs:52-54`

- [ ] **Step 1: Update llm_client.rs create_client()**

Change `create_client` signature to accept proxy_url:

```rust
pub fn create_client(
    provider: &PostProcessProvider,
    api_key: String,
    proxy_url: Option<&str>,
) -> Result<Client<OpenAIConfig>, String> {
```

Replace lines 24-28:

```rust
let http_client = reqwest::Client::builder()
    .default_headers(headers)
    .timeout(std::time::Duration::from_secs(30))
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
```

With:

```rust
let http_client = crate::http_client::build_http_client(
    proxy_url,
    std::time::Duration::from_secs(30),
    headers,
)?;
```

- [ ] **Step 2: Update llm_client.rs fetch_models()**

Change `fetch_models` signature to accept proxy_url:

```rust
pub async fn fetch_models(
    provider: &PostProcessProvider,
    api_key: String,
    proxy_url: Option<&str>,
) -> Result<Vec<String>, String> {
```

Replace lines 69-72:

```rust
let client = reqwest::Client::builder()
    .default_headers(headers)
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
```

With:

```rust
let client = crate::http_client::build_http_client(
    proxy_url,
    std::time::Duration::from_secs(30),
    headers,
)?;
```

Also update `send_chat_completion_with_params` (line 246-250) the same way — add `proxy_url: Option<&str>` parameter and use `build_http_client`.

- [ ] **Step 3: Update core.rs**

Replace lines 690-693 in `execute_llm_request_inner`:

```rust
let http_client = reqwest::Client::builder()
    .default_headers(headers)
    .timeout(std::time::Duration::from_secs(60))
    .build();
```

With:

```rust
let effective_proxy = crate::settings::resolve_proxy(&settings, provider);
let http_client = crate::http_client::build_http_client(
    effective_proxy.as_deref(),
    std::time::Duration::from_secs(timeout_secs),
    headers,
);
```

(The `timeout_secs` variable should already exist from the thinking-model timeout logic.)

- [ ] **Step 4: Update extensions.rs**

Replace lines 855-858:

```rust
let http_client = match reqwest::Client::builder()
    .default_headers(headers)
    .timeout(std::time::Duration::from_secs(timeout_secs))
    .build()
```

With:

```rust
let effective_proxy = crate::settings::resolve_proxy(&settings, provider);
let http_client = match crate::http_client::build_http_client(
    effective_proxy.as_deref(),
    std::time::Duration::from_secs(timeout_secs),
    headers,
)
```

- [ ] **Step 5: Update provider_cmds.rs (avatar + favicon)**

For both `reqwest::Client::builder()` calls (around lines 211 and 296), replace with `crate::http_client::build_http_client(None, ...)`. These are cosmetic downloads — no proxy needed.

- [ ] **Step 6: Update free_models.rs**

Replace the builder call (around line 94):

```rust
let client = crate::http_client::build_http_client(
    None,
    std::time::Duration::from_secs(15),
    reqwest::header::HeaderMap::new(),
)?;
```

- [ ] **Step 7: Update model.rs**

Replace `reqwest::Client::new()` at line 1098. Since model downloads may benefit from proxy, accept proxy_url if available:

```rust
let client = crate::http_client::build_http_client(
    None, // model downloads don't use provider proxy
    std::time::Duration::from_secs(300),
    reqwest::header::HeaderMap::new(),
).map_err(|e| anyhow::anyhow!(e))?;
```

- [ ] **Step 8: Update online_asr.rs**

Replace lines 52-55 (blocking client). The OnlineAsr struct needs access to proxy settings. Add proxy_url field or pass it in. Replace:

```rust
let client = Client::builder()
    .timeout(self.timeout)
    .build()
    .context("failed to build HTTP client")?;
```

With:

```rust
let client = crate::http_client::build_blocking_http_client(
    self.proxy_url.as_deref(),
    self.timeout,
).map_err(|e| anyhow::anyhow!(e))?;
```

This requires adding a `proxy_url: Option<String>` field to the OnlineAsr struct and populating it from settings when constructing.

- [ ] **Step 9: Fix all callers of modified function signatures**

Search for all calls to `create_client`, `fetch_models`, `send_chat_completion_with_params` and update them to pass the new `proxy_url` parameter. Use `resolve_proxy(&settings, &provider).as_deref()` where settings and provider are available, or `None` where proxy is not applicable.

- [ ] **Step 10: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -50`

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/llm_client.rs src-tauri/src/actions/post_process/core.rs src-tauri/src/actions/post_process/extensions.rs src-tauri/src/shortcut/provider_cmds.rs src-tauri/src/managers/free_models.rs src-tauri/src/managers/model.rs src-tauri/src/online_asr.rs
git commit -m "Route all HTTP clients through centralized builder with proxy support"
```

---

## Task 7: Backend Commands for Multi-Key & Proxy

**Files:**

- Modify: `src-tauri/src/shortcut/settings_cmds.rs:80-90`
- Modify: `src-tauri/src/lib.rs` (register new commands)

- [ ] **Step 1: Update existing API key command to handle multi-key**

Replace `change_post_process_api_key_setting` (lines 80-90) with commands for multi-key management:

```rust
#[tauri::command]
#[specta::specta]
pub fn change_post_process_api_key_setting(
    app: AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    // Backward-compat: set as single key (replaces all keys for this provider)
    let mut settings = settings::get_settings(&app);
    super::validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_api_keys.insert(
        provider_id.clone(),
        if api_key.is_empty() {
            Vec::new()
        } else {
            vec![settings::KeyEntry {
                key: api_key,
                enabled: true,
                label: None,
            }]
        },
    );
    settings::write_settings(&app, settings);
    // Reset key selector state
    if let Ok(selector) = app.try_state::<crate::key_selector::KeySelector>() {
        selector.reset(&provider_id);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_api_keys(
    app: AppHandle,
    provider_id: String,
    keys: Vec<settings::KeyEntry>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    super::validate_provider_exists(&settings, &provider_id)?;
    settings.post_process_api_keys.insert(provider_id.clone(), keys);
    settings::write_settings(&app, settings);
    // Reset key selector state
    if let Ok(selector) = app.try_state::<crate::key_selector::KeySelector>() {
        selector.reset(&provider_id);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_post_process_api_keys(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<settings::KeyEntry>, String> {
    let settings = settings::get_settings(&app);
    Ok(settings
        .post_process_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default())
}
```

- [ ] **Step 2: Add proxy settings commands**

Add to `settings_cmds.rs`:

```rust
#[tauri::command]
#[specta::specta]
pub fn set_proxy_settings(
    app: AppHandle,
    url: Option<String>,
    global_enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.proxy_url = url;
    settings.proxy_global_enabled = global_enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_provider_proxy_override(
    app: AppHandle,
    provider_id: String,
    proxy_override: settings::ProxyOverride,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    if let Some(provider) = settings
        .post_process_providers
        .iter_mut()
        .find(|p| p.id == provider_id)
    {
        provider.proxy_override = proxy_override;
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err(format!("Provider not found: {}", provider_id))
    }
}
```

- [ ] **Step 3: Register new commands in lib.rs**

Add the new command functions to both `invoke_handler` blocks in `lib.rs` (there are two — one for each platform target). Add alongside existing `change_post_process_api_key_setting`:

```rust
shortcut::settings_cmds::set_post_process_api_keys,
shortcut::settings_cmds::get_post_process_api_keys,
shortcut::settings_cmds::set_proxy_settings,
shortcut::settings_cmds::set_provider_proxy_override,
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/shortcut/settings_cmds.rs src-tauri/src/lib.rs
git commit -m "Add backend commands for multi-key management and proxy settings"
```

---

## Task 8: Frontend — Multi-Key List UI

**Files:**

- Modify: `src/components/settings/post-processing/ApiSettings.tsx`
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add multi-key store actions**

In `src/stores/settingsStore.ts`, add new actions to the store interface and implementation:

Add to interface (around line 41):

```typescript
getPostProcessApiKeys: (providerId: string) => Promise<KeyEntry[]>;
setPostProcessApiKeys: (providerId: string, keys: KeyEntry[]) => Promise<void>;
```

Add type near the top of the file:

```typescript
export interface KeyEntry {
  key: string;
  enabled: boolean;
  label: string | null;
}
```

Add implementations:

```typescript
getPostProcessApiKeys: async (providerId) => {
  const keys: KeyEntry[] = await invoke("get_post_process_api_keys", { providerId });
  return keys;
},

setPostProcessApiKeys: async (providerId, keys) => {
  await invoke("set_post_process_api_keys", { providerId, keys });
  // Clear cached models
  set((state) => ({
    postProcessModelOptions: {
      ...state.postProcessModelOptions,
      [providerId]: [],
    },
  }));
  await get().refreshSettings();
},
```

- [ ] **Step 2: Create ApiKeyList component in ApiSettings.tsx**

Replace the single API key `TextField` (around lines 1031-1087) with a multi-key list. Add a new component within or alongside ApiSettings:

```tsx
interface ApiKeyListProps {
  providerId: string;
}

const ApiKeyList: React.FC<ApiKeyListProps> = ({ providerId }) => {
  const { t } = useTranslation();
  const { getPostProcessApiKeys, setPostProcessApiKeys } = useSettings();
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});

  useEffect(() => {
    getPostProcessApiKeys(providerId).then(setKeys);
  }, [providerId]);

  const updateKeys = async (newKeys: KeyEntry[]) => {
    setKeys(newKeys);
    await setPostProcessApiKeys(providerId, newKeys);
  };

  const addKey = () => {
    updateKeys([...keys, { key: "", enabled: true, label: null }]);
  };

  const removeKey = (index: number) => {
    updateKeys(keys.filter((_, i) => i !== index));
  };

  const updateKey = (index: number, updates: Partial<KeyEntry>) => {
    const newKeys = keys.map((k, i) =>
      i === index ? { ...k, ...updates } : k,
    );
    setKeys(newKeys); // optimistic local update
  };

  const persistKeys = () => {
    setPostProcessApiKeys(providerId, keys);
  };

  return (
    <Flex direction="column" gap="2">
      {keys.map((entry, index) => (
        <Flex key={index} align="center" gap="2">
          <TextField.Root
            type={showKeys[index] ? "text" : "password"}
            value={entry.key}
            onChange={(e) => updateKey(index, { key: e.target.value })}
            onBlur={persistKeys}
            placeholder="sk-..."
            className="flex-1"
          >
            <TextField.Slot side="right">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={() =>
                  setShowKeys({ ...showKeys, [index]: !showKeys[index] })
                }
              >
                {showKeys[index] ? (
                  <IconEyeOff size={14} />
                ) : (
                  <IconEye size={14} />
                )}
              </IconButton>
            </TextField.Slot>
          </TextField.Root>
          <TextField.Root
            value={entry.label || ""}
            onChange={(e) =>
              updateKey(index, { label: e.target.value || null })
            }
            onBlur={persistKeys}
            placeholder={t(
              "settings.postProcessing.api.providers.fields.keyLabel",
              "Label",
            )}
            className="w-24"
          />
          <Switch
            size="1"
            checked={entry.enabled}
            onCheckedChange={(checked) => {
              const newKeys = keys.map((k, i) =>
                i === index ? { ...k, enabled: checked } : k,
              );
              updateKeys(newKeys);
            }}
          />
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            onClick={() => removeKey(index)}
          >
            <IconTrash size={14} />
          </IconButton>
        </Flex>
      ))}
      {keys.length === 0 && (
        <Flex align="center" gap="2">
          <TextField.Root
            type="password"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                updateKeys([
                  { key: e.target.value, enabled: true, label: null },
                ]);
              }
            }}
            placeholder="sk-..."
            className="flex-1"
          />
        </Flex>
      )}
      {keys.length > 0 && (
        <Button size="1" variant="soft" onClick={addKey} className="w-fit">
          <IconPlus size={14} />
          {t("settings.postProcessing.api.providers.fields.addKey", "Add Key")}
        </Button>
      )}
    </Flex>
  );
};
```

Replace the old single-key input section in the parent component with `<ApiKeyList providerId={state.selectedProviderId} />`.

- [ ] **Step 3: Import needed components**

Add to imports in ApiSettings.tsx:

```tsx
import { IconTrash, IconPlus } from "@tabler/icons-react";
import { Switch } from "@radix-ui/themes";
import type { KeyEntry } from "@/stores/settingsStore";
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd /Users/zac/code/github/asr/Handy && bun build 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/post-processing/ApiSettings.tsx src/stores/settingsStore.ts
git commit -m "Add multi-key list UI for API key management per provider"
```

---

## Task 9: Frontend — Proxy Settings UI

**Files:**

- Modify: `src/components/settings/post-processing/AdvancedSettings.tsx`
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/components/settings/post-processing/ApiSettings.tsx` (per-provider override dropdown)

- [ ] **Step 1: Add proxy store actions**

In `settingsStore.ts`, add:

```typescript
// Interface
setProxySettings: (url: string | null, globalEnabled: boolean) => Promise<void>;
setProviderProxyOverride: (providerId: string, override: ProxyOverride) =>
  Promise<void>;
```

Add type:

```typescript
export type ProxyOverride =
  | "follow_global"
  | "force_enabled"
  | "force_disabled";
```

Add implementations:

```typescript
setProxySettings: async (url, globalEnabled) => {
  await invoke("set_proxy_settings", { url, globalEnabled });
  await get().refreshSettings();
},

setProviderProxyOverride: async (providerId, proxyOverride) => {
  await invoke("set_provider_proxy_override", { providerId, proxyOverride });
  await get().refreshSettings();
},
```

- [ ] **Step 2: Add proxy section to AdvancedSettings.tsx**

Add a proxy configuration section inside the collapsible advanced area. After the models endpoint section:

```tsx
{
  /* Proxy Settings */
}
<Flex direction="column" gap="2" mt="3">
  <Text size="2" weight="medium" color="gray">
    {t("settings.postProcessing.api.proxy.title", "Proxy")}
  </Text>
  <TextField.Root
    value={proxyUrl}
    onChange={(e) => setLocalProxyUrl(e.target.value)}
    onBlur={() => onProxyChange(localProxyUrl, proxyGlobalEnabled)}
    placeholder="http://127.0.0.1:7890"
    variant="surface"
  />
  <Flex align="center" gap="2">
    <Switch
      size="1"
      checked={proxyGlobalEnabled}
      onCheckedChange={(checked) => onProxyChange(proxyUrl, checked)}
    />
    <Text size="2" color="gray">
      {t("settings.postProcessing.api.proxy.globalEnabled", "Enable globally")}
    </Text>
  </Flex>
</Flex>;
```

Update the AdvancedSettings props:

```tsx
export interface AdvancedSettingsProps {
  modelsEndpoint: string;
  onModelsEndpointChange: (value: string) => void;
  providerId?: string;
  proxyUrl: string;
  proxyGlobalEnabled: boolean;
  onProxyChange: (url: string, globalEnabled: boolean) => void;
}
```

- [ ] **Step 3: Add per-provider proxy override in ApiSettings.tsx**

Add a small dropdown near the provider settings area:

```tsx
<Flex align="center" gap="2">
  <Text size="2" color="gray">
    {t("settings.postProcessing.api.proxy.override", "Proxy")}:
  </Text>
  <Select.Root
    value={providerProxyOverride}
    onValueChange={(val) =>
      setProviderProxyOverride(state.selectedProviderId, val as ProxyOverride)
    }
  >
    <Select.Trigger variant="soft" size="1" />
    <Select.Content>
      <Select.Item value="follow_global">
        {t("settings.postProcessing.api.proxy.followGlobal", "Follow Global")}
      </Select.Item>
      <Select.Item value="force_enabled">
        {t("settings.postProcessing.api.proxy.forceOn", "Force On")}
      </Select.Item>
      <Select.Item value="force_disabled">
        {t("settings.postProcessing.api.proxy.forceOff", "Force Off")}
      </Select.Item>
    </Select.Content>
  </Select.Root>
</Flex>
```

- [ ] **Step 4: Wire up props from parent component**

Ensure the parent of AdvancedSettings passes the proxy props. Read `proxy_url` and `proxy_global_enabled` from settings and pass them through.

- [ ] **Step 5: Verify frontend builds**

Run: `cd /Users/zac/code/github/asr/Handy && bun build 2>&1 | tail -10`

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/post-processing/AdvancedSettings.tsx src/stores/settingsStore.ts src/components/settings/post-processing/ApiSettings.tsx
git commit -m "Add proxy settings UI in advanced settings and per-provider override"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Full compilation check**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`

- [ ] **Step 2: Frontend build check**

Run: `cd /Users/zac/code/github/asr/Handy && bun build 2>&1 | tail -10`

- [ ] **Step 3: Fix any remaining warnings**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep warning`

Fix all warnings before committing.

- [ ] **Step 4: Test backward compatibility**

Verify that the app starts correctly with existing settings (old single-key format should auto-migrate to SecretKeyRing).

Run: `cd /Users/zac/code/github/asr/Handy && bun tauri dev`

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "Fix compilation warnings and verify end-to-end functionality"
```
