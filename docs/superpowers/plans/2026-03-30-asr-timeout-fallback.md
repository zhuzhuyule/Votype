# ASR Timeout Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add intelligent timeout handling for online ASR — fall back to local results in 10s when a local model exists, or show an interactive timeout overlay after 30s when online-only.

**Architecture:** Wrap the existing parallel online+local ASR await in `tokio::time::timeout`. When local results are available and online exceeds 10s, use local immediately. When no local model exists, emit a new `asr-online-timeout` event after 30s so the overlay can show Continue/Retry/Cancel buttons. The frontend handles user choices via new Tauri commands.

**Tech Stack:** Rust (tokio::time::timeout), React (overlay event listener), Tauri commands

---

### Task 1: Backend — Hybrid mode timeout (local + online)

**Files:**

- Modify: `src-tauri/src/actions/transcribe.rs:645-661` (the await section after both tasks are spawned)

- [ ] **Step 1: Add tokio::time import**

At the top of `transcribe.rs`, ensure this import exists:

```rust
use tokio::time::timeout;
use std::time::Duration;
```

- [ ] **Step 2: Replace sequential await with timeout-based selection**

Replace lines 645-661 (the `primary_handle.await` / `secondary_handle.await` block) with timeout logic. The key change: when `use_parallel_online_secondary` is true (local model running in parallel), wrap the online await in a 10s timeout. If it times out, use the secondary result.

Replace this block:

```rust
let primary = match primary_handle.await {
    Ok(res) => res,
    Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
};
let secondary = if let Some(handle) = secondary_handle {
    match handle.await {
        Ok(res) => res,
        Err(e) => {
            log::warn!("Secondary transcription task failed: {}", e);
            None
        }
    }
} else {
    None
};

(primary, secondary)
```

With:

```rust
// Determine if we have a local fallback running in parallel
let has_local_fallback = secondary_handle.is_some();
const ONLINE_TIMEOUT_WITH_LOCAL: u64 = 10;

if has_local_fallback {
    // Race: wait up to 10s for online, otherwise use local
    let secondary_handle = secondary_handle.unwrap();

    match timeout(Duration::from_secs(ONLINE_TIMEOUT_WITH_LOCAL), primary_handle).await {
        Ok(join_result) => {
            // Online finished within timeout
            let primary = match join_result {
                Ok(res) => res,
                Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
            };
            // Still await secondary (it's likely done or almost done)
            let secondary = match secondary_handle.await {
                Ok(res) => res,
                Err(e) => {
                    log::warn!("Secondary transcription task failed: {}", e);
                    None
                }
            };
            (primary, secondary)
        }
        Err(_elapsed) => {
            // Online timed out — use local result
            log::info!(
                "[ASR] Online timeout ({}s), using local result",
                ONLINE_TIMEOUT_WITH_LOCAL
            );
            // Await the secondary (local) result
            let secondary = match secondary_handle.await {
                Ok(res) => res,
                Err(e) => {
                    log::warn!("Secondary transcription task failed: {}", e);
                    None
                }
            };
            // Return online as error so fallback logic picks up secondary
            (
                Err(anyhow::anyhow!(
                    "Online ASR timed out after {}s, fell back to local",
                    ONLINE_TIMEOUT_WITH_LOCAL
                )),
                secondary,
            )
        }
    }
} else {
    // No local fallback — await online normally (timeout handled in Task 2)
    let primary = match primary_handle.await {
        Ok(res) => res,
        Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
    };
    (primary, None)
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: no errors related to the timeout changes

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs
git commit -m "Add 10s timeout for online ASR when local model available"
```

---

### Task 2: Backend — Online-only mode timeout with event

**Files:**

- Modify: `src-tauri/src/actions/transcribe.rs` (the `else` branch from Task 1 where `has_local_fallback` is false)

- [ ] **Step 1: Add the online-only timeout logic with user interaction**

In the `else` branch (no local fallback), implement a 30s timeout that emits an event and waits for user response. Replace the simple `primary_handle.await` with:

```rust
// No local fallback — online-only mode with 30s timeout prompt
const ONLINE_TIMEOUT_NO_LOCAL: u64 = 30;

// First wait: 30 seconds
match timeout(Duration::from_secs(ONLINE_TIMEOUT_NO_LOCAL), &mut primary_handle).await {
    Ok(join_result) => {
        let primary = match join_result {
            Ok(res) => res,
            Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
        };
        (primary, None)
    }
    Err(_elapsed) => {
        // Timed out — notify frontend
        log::warn!(
            "[ASR] Online-only ASR timed out after {}s, prompting user",
            ONLINE_TIMEOUT_NO_LOCAL
        );
        let _ = app.emit("asr-online-timeout", serde_json::json!({
            "has_local_fallback": false
        }));

        // Wait for user decision via a oneshot channel
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        {
            let mut guard = app.state::<crate::AsrTimeoutResponse>().0.lock().unwrap();
            *guard = Some(tx);
        }

        match rx.await {
            Ok(action) => match action.as_str() {
                "continue" => {
                    log::info!("[ASR] User chose to continue waiting");
                    // Wait indefinitely for the original request
                    let primary = match primary_handle.await {
                        Ok(res) => res,
                        Err(e) => Err(anyhow::anyhow!("Online ASR task failed: {}", e)),
                    };
                    (primary, None)
                }
                "retry" => {
                    log::info!("[ASR] User chose to retry online ASR");
                    primary_handle.abort();
                    // Re-run online ASR
                    let retry_handle = tokio::task::spawn_blocking({
                        let samples = samples.clone();
                        let provider = settings.post_process_providers.iter()
                            .find(|p| p.id == cached_model_for_retry.as_ref().map(|c| c.provider_id.as_str()).unwrap_or(""))
                            .cloned();
                        let api_key = cached_model_for_retry.as_ref()
                            .and_then(|c| settings.post_process_api_keys.get(&c.provider_id).cloned());
                        let remote_model_id = cached_model_for_retry.as_ref()
                            .map(|c| c.model_id.clone())
                            .unwrap_or_default();
                        let language = settings.selected_language.clone();
                        move || -> anyhow::Result<String> {
                            let provider = provider.ok_or_else(|| anyhow::anyhow!("Provider not found for retry"))?;
                            let client = OnlineAsrClient::new(16000, Duration::from_secs(120));
                            let lang = if language == "auto" { None } else { Some(language.as_str()) };
                            client.transcribe(&provider, api_key, &remote_model_id, lang, &samples)
                        }
                    });
                    let primary = match retry_handle.await {
                        Ok(res) => res,
                        Err(e) => Err(anyhow::anyhow!("Online ASR retry failed: {}", e)),
                    };
                    (primary, None)
                }
                _ => {
                    // "cancel" or unknown
                    log::info!("[ASR] User cancelled online ASR");
                    primary_handle.abort();
                    (Err(anyhow::anyhow!("User cancelled online ASR")), None)
                }
            },
            Err(_) => {
                // Channel dropped — treat as cancel
                log::warn!("[ASR] Timeout response channel dropped, cancelling");
                primary_handle.abort();
                (Err(anyhow::anyhow!("ASR timeout response channel dropped")), None)
            }
        }
    }
}
```

Note: `primary_handle` needs to be `mut` — update the binding at the spawn site.

- [ ] **Step 2: Add the AsrTimeoutResponse state to the app**

In `src-tauri/src/lib.rs`, add a managed state for the oneshot channel:

```rust
pub struct AsrTimeoutResponse(pub std::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>>);
```

Register it in the app builder:

```rust
.manage(AsrTimeoutResponse(std::sync::Mutex::new(None)))
```

- [ ] **Step 3: Add the Tauri command for user response**

Create the command in `src-tauri/src/commands/` (find the appropriate commands file or add to an existing one):

```rust
#[tauri::command]
pub fn respond_asr_timeout(app: AppHandle, action: String) -> Result<(), String> {
    let sender = {
        let mut guard = app.state::<crate::AsrTimeoutResponse>().0.lock().unwrap();
        guard.take()
    };
    if let Some(tx) = sender {
        let _ = tx.send(action);
        Ok(())
    } else {
        Err("No pending ASR timeout".to_string())
    }
}
```

Register this command in the Tauri builder in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Prepare retry context**

Before the timeout block, clone the cached model info needed for retry:

```rust
let cached_model_for_retry = settings
    .cached_models
    .iter()
    .find(|m| {
        m.model_type == crate::settings::ModelType::Asr
            && m.id == online_model_id
    })
    .cloned();
```

This must be placed before the `if has_local_fallback` block so it's available in the online-only branch.

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/zac/code/github/asr/Handy && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs src-tauri/src/lib.rs src-tauri/src/commands/
git commit -m "Add 30s timeout for online-only ASR with user prompt"
```

---

### Task 3: Frontend — Add event constant and overlay timeout UI

**Files:**

- Modify: `src/lib/events.ts` (add new event constant)
- Modify: `src/overlay/RecordingOverlay.tsx` (listen for timeout event, render buttons)
- Modify: `src/i18n/locales/en/translation.json` (add English strings)
- Modify: `src/i18n/locales/zh/translation.json` (add Chinese strings)

- [ ] **Step 1: Add event constant**

In `src/lib/events.ts`, add after the existing overlay events:

```typescript
/** Online ASR timed out — overlay should show action buttons */
export const ASR_ONLINE_TIMEOUT = "asr-online-timeout";
```

Also add to the `TauriEvents` object:

```typescript
ASR_ONLINE_TIMEOUT,
```

- [ ] **Step 2: Add translation strings**

In `src/i18n/locales/en/translation.json`, inside the `overlay` object, add:

```json
"timeout": {
  "title": "Online transcription timed out",
  "continue": "Continue",
  "retry": "Retry",
  "cancel": "Cancel"
}
```

In `src/i18n/locales/zh/translation.json`, inside the `overlay` object, add:

```json
"timeout": {
  "title": "在线识别超时",
  "continue": "继续等待",
  "retry": "重试",
  "cancel": "取消"
}
```

- [ ] **Step 3: Add timeout state and event listener to RecordingOverlay**

In `RecordingOverlay.tsx`, add state:

```typescript
const [showTimeout, setShowTimeout] = useState(false);
const [timeoutFocused, setTimeoutFocused] = useState<
  "continue" | "retry" | "cancel"
>("continue");
```

Add event listener inside `setupEventListeners`:

```typescript
const unlistenTimeout = await listen<{ has_local_fallback: boolean }>(
  "asr-online-timeout",
  (event) => {
    if (!event.payload.has_local_fallback) {
      setShowTimeout(true);
      setTimeoutFocused("continue");
      // Request focus so keyboard works
      setTimeout(() => {
        invoke("focus_overlay").catch(() => {});
      }, 50);
    }
  },
);
if (disposed) {
  unlistenTimeout();
  return;
}
unlisteners.push(unlistenTimeout);
```

- [ ] **Step 4: Add keyboard handler for timeout buttons**

Add a `useEffect` for keyboard navigation (similar to the skill confirmation pattern):

```typescript
useEffect(() => {
  if (!showTimeout) return;

  const buttons = ["continue", "retry", "cancel"] as const;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setTimeoutFocused((prev) => {
        const idx = buttons.indexOf(prev);
        const next =
          e.key === "ArrowRight"
            ? (idx + 1) % buttons.length
            : (idx - 1 + buttons.length) % buttons.length;
        return buttons[next];
      });
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      invoke("respond_asr_timeout", { action: timeoutFocused });
      setShowTimeout(false);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      invoke("respond_asr_timeout", { action: "cancel" });
      setShowTimeout(false);
      return;
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [showTimeout, timeoutFocused]);
```

- [ ] **Step 5: Render timeout UI in the overlay**

In the JSX return, add the timeout UI block (inside `overlay-middle`, after the error text block):

```tsx
{
  showTimeout && state === "transcribing" && (
    <Flex direction="column" align="center" gap="2" className="timeout-prompt">
      <Text className="timeout-title">{t("overlay.timeout.title")}</Text>
      <Flex gap="2" className="timeout-buttons">
        {(["continue", "retry", "cancel"] as const).map((action) => (
          <button
            key={action}
            className={`timeout-btn ${timeoutFocused === action ? "focused" : ""}`}
            onClick={() => {
              invoke("respond_asr_timeout", { action });
              setShowTimeout(false);
            }}
          >
            {t(`overlay.timeout.${action}`)}
          </button>
        ))}
      </Flex>
    </Flex>
  );
}
```

- [ ] **Step 6: Reset timeout state on recording restart**

In the `show-overlay` listener, when `overlayState === "recording"`, also reset timeout:

```typescript
if (overlayState === "recording") {
  resetOverlayRecordingState();
  setShowTimeout(false);
}
```

- [ ] **Step 7: Add CSS for timeout buttons**

In `src/overlay/RecordingOverlay.css`, add styles for the timeout prompt:

```css
.timeout-prompt {
  padding: 4px 0;
}

.timeout-title {
  font-size: 11px;
  color: var(--gray-11);
  white-space: nowrap;
}

.timeout-buttons {
  gap: 6px;
}

.timeout-btn {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--gray-6);
  background: var(--gray-2);
  color: var(--gray-12);
  cursor: pointer;
  transition: all 0.15s;
}

.timeout-btn:hover,
.timeout-btn.focused {
  border-color: var(--overlay-accent-color);
  background: var(--gray-3);
}
```

- [ ] **Step 8: Verify frontend builds**

Run: `cd /Users/zac/code/github/asr/Handy && bun build 2>&1 | tail -10`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/lib/events.ts src/overlay/RecordingOverlay.tsx src/overlay/RecordingOverlay.css src/i18n/locales/en/translation.json src/i18n/locales/zh/translation.json
git commit -m "Add timeout overlay UI for online-only ASR with action buttons"
```

---

### Task 4: Integration test — verify full flow

**Files:**

- No new files

- [ ] **Step 1: Manual test — hybrid mode**

1. Configure: enable online ASR + enable secondary local model
2. Disconnect network (or use a slow endpoint)
3. Record a short phrase
4. Verify: after ~10s, local result is used and post-processing starts
5. Check logs for: `[ASR] Online timeout (10s), using local result`

- [ ] **Step 2: Manual test — online-only mode**

1. Configure: enable online ASR, disable secondary local model, no local model selected
2. Disconnect network (or use a slow endpoint)
3. Record a short phrase
4. Verify: after ~30s, overlay shows timeout prompt with three buttons
5. Test each button:
   - Continue → keeps waiting
   - Retry → re-sends request
   - Cancel → returns to idle

- [ ] **Step 3: Manual test — normal fast response**

1. Configure: enable online ASR with a fast provider
2. Record a short phrase
3. Verify: transcription completes normally under 10s, no timeout behavior

- [ ] **Step 4: Final commit (format)**

```bash
cd /Users/zac/code/github/asr/Handy && bun format
git add -A
git commit -m "Format code"
```
