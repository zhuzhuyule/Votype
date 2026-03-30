# ASR Timeout Fallback Design

## Problem

Online ASR has a hard 120s HTTP timeout. When the online service is slow or unreachable, the app blocks for up to 2 minutes before falling back to local results — even though local ASR may have finished in seconds.

## Design

Two timeout scenarios based on whether a local ASR model is available.

### Scenario 1: Hybrid Mode (local + online parallel)

- Both already run in parallel via `spawn_blocking`
- Wrap the online ASR await with `tokio::time::timeout(Duration::from_secs(10))`
- If online returns within 10s → use online result (preferred)
- If online times out → use local result, log `[ASR] Online timeout (10s), using local result`
- Post-processing proceeds normally regardless of which result is used

### Scenario 2: Online-Only Mode (no local model)

- After 30s with no response, emit `"asr-online-timeout"` event to frontend
- Frontend displays timeout overlay with three actions:
  - **Continue waiting** — keep waiting for the current request (no new timeout)
  - **Retry** — cancel current request, re-send
  - **Cancel** — abort transcription, return to Idle
- Overlay replaces the "transcribing" indicator

### Event

New event: `"asr-online-timeout"` with payload `{ has_local_fallback: bool }`

- `has_local_fallback: true` → silent fallback to local (no UI change needed)
- `has_local_fallback: false` → frontend shows timeout overlay with actions

### What doesn't change

- Online ASR HTTP client timeout stays at 120s (allows the request to complete if user chooses to wait)
- Post-processing timeout logic unchanged
- No new settings exposed to user
- Fixed timeout values: 10s (hybrid), 30s (online-only)

## Files to Modify

- `src-tauri/src/actions/transcribe.rs` — timeout logic around online ASR await
- `src/` — overlay component to handle timeout UI (online-only scenario)
