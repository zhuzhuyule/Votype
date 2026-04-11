use crate::settings::KeyEntry;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Cooldown duration for rate-limited keys (429)
const RATE_LIMIT_COOLDOWN_SECS: u64 = 60;
/// Cooldown duration for auth-failed keys (401/403)
const AUTH_FAIL_COOLDOWN_SECS: u64 = 300;

struct ProviderState {
    index: usize,
    /// Per-key cooldown expiry (None = not in cooldown)
    cooldowns: Vec<Option<Instant>>,
    consecutive_failures: Vec<u32>,
    last_error_code: Vec<Option<u16>>,
    last_used_at: Vec<Option<Instant>>,
    last_success_at: Vec<Option<Instant>>,
}

impl ProviderState {
    fn new(key_count: usize) -> Self {
        Self {
            index: 0,
            cooldowns: vec![None; key_count],
            consecutive_failures: vec![0; key_count],
            last_error_code: vec![None; key_count],
            last_used_at: vec![None; key_count],
            last_success_at: vec![None; key_count],
        }
    }

    fn resize(&mut self, key_count: usize) {
        self.cooldowns.resize(key_count, None);
        self.consecutive_failures.resize(key_count, 0);
        self.last_error_code.resize(key_count, None);
        self.last_used_at.resize(key_count, None);
        self.last_success_at.resize(key_count, None);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AcquiredKey<'a> {
    pub key_index: usize,
    pub api_key: &'a str,
    pub from_cooldown_fallback: bool,
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
    /// Returns (key_index_in_original_list, api_key_string).
    /// If all keys are in cooldown, returns the one closest to expiry.
    pub fn next_key<'a>(
        &self,
        provider_id: &str,
        keys: &'a [KeyEntry],
    ) -> Option<(usize, &'a str)> {
        self.acquire_next_key(provider_id, keys, &HashSet::new())
            .map(|acquired| (acquired.key_index, acquired.api_key))
    }

    /// Select the next available key for a single request.
    /// Skips disabled, empty, attempted, and cooled-down keys.
    /// If all keys are cooling down, returns the earliest-expiring one once.
    pub fn acquire_next_key<'a>(
        &self,
        provider_id: &str,
        keys: &'a [KeyEntry],
        attempted_indices: &HashSet<usize>,
    ) -> Option<AcquiredKey<'a>> {
        let enabled: Vec<(usize, &KeyEntry)> = keys
            .iter()
            .enumerate()
            .filter(|(_, k)| k.enabled && !k.key.is_empty())
            .collect();

        if enabled.is_empty() {
            return None;
        }

        let mut state = self.state.lock().unwrap();
        let provider_state = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderState::new(keys.len()));

        // Keep runtime vectors aligned with the current key list.
        provider_state.resize(keys.len());

        let now = Instant::now();
        let count = enabled.len();
        let start = provider_state.index % count;

        // Try round-robin, skipping attempted and cooled-down keys.
        for offset in 0..count {
            let pos = (start + offset) % count;
            let (original_idx, entry) = enabled[pos];

            if attempted_indices.contains(&original_idx) {
                continue;
            }

            let is_cooled_down = provider_state
                .cooldowns
                .get(original_idx)
                .and_then(|c| *c)
                .map(|expiry| now < expiry)
                .unwrap_or(false);

            if !is_cooled_down {
                provider_state.index = (pos + 1) % count;
                if let Some(last_used_at) = provider_state.last_used_at.get_mut(original_idx) {
                    *last_used_at = Some(now);
                }
                return Some(AcquiredKey {
                    key_index: original_idx,
                    api_key: &entry.key,
                    from_cooldown_fallback: false,
                });
            }
        }

        // All keys in cooldown — pick the one expiring soonest
        let mut best: Option<(usize, &str, Instant)> = None;
        for &(original_idx, entry) in &enabled {
            if attempted_indices.contains(&original_idx) {
                continue;
            }
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

        best.map(|(idx, key, _)| {
            if let Some(last_used_at) = provider_state.last_used_at.get_mut(idx) {
                *last_used_at = Some(now);
            }
            AcquiredKey {
                key_index: idx,
                api_key: key,
                from_cooldown_fallback: true,
            }
        })
    }

    /// Put a key into cooldown after an error.
    pub fn mark_error(&self, provider_id: &str, key_index: usize, status_code: u16) {
        let cooldown_secs = match status_code {
            429 => RATE_LIMIT_COOLDOWN_SECS,
            401 | 403 => AUTH_FAIL_COOLDOWN_SECS,
            _ => RATE_LIMIT_COOLDOWN_SECS,
        };

        let mut state = self.state.lock().unwrap();
        let provider_state = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderState::new(key_index + 1));
        provider_state.resize(key_index + 1);

        let now = Instant::now();
        provider_state.cooldowns[key_index] = Some(now + Duration::from_secs(cooldown_secs));
        provider_state.consecutive_failures[key_index] =
            provider_state.consecutive_failures[key_index].saturating_add(1);
        provider_state.last_error_code[key_index] = Some(status_code);
        provider_state.last_used_at[key_index] = Some(now);
    }

    /// Clear failure state after a successful request.
    #[allow(dead_code)]
    pub fn report_success(&self, provider_id: &str, key_index: usize) {
        let mut state = self.state.lock().unwrap();
        let provider_state = state
            .entry(provider_id.to_string())
            .or_insert_with(|| ProviderState::new(key_index + 1));
        provider_state.resize(key_index + 1);

        provider_state.cooldowns[key_index] = None;
        provider_state.consecutive_failures[key_index] = 0;
        provider_state.last_error_code[key_index] = None;
        provider_state.last_success_at[key_index] = Some(Instant::now());
    }

    /// Reset state for a provider (call when keys are reconfigured).
    pub fn reset(&self, provider_id: &str) {
        let mut state = self.state.lock().unwrap();
        state.remove(provider_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(value: &str) -> KeyEntry {
        KeyEntry {
            key: value.to_string(),
            enabled: true,
            label: None,
        }
    }

    #[test]
    fn acquire_next_key_skips_attempted_healthy_keys_in_round_robin_order() {
        let selector = KeySelector::new();
        let keys = vec![key("k0"), key("k1"), key("k2")];

        let first = selector
            .acquire_next_key("provider-a", &keys, &HashSet::new())
            .expect("expected first key");
        assert_eq!(first.key_index, 0);
        assert_eq!(first.api_key, "k0");
        assert!(!first.from_cooldown_fallback);

        let attempted = HashSet::from([first.key_index]);
        let second = selector
            .acquire_next_key("provider-a", &keys, &attempted)
            .expect("expected second key");
        assert_eq!(second.key_index, 1);
        assert_eq!(second.api_key, "k1");
        assert!(!second.from_cooldown_fallback);

        let attempted = HashSet::from([first.key_index, second.key_index]);
        let third = selector
            .acquire_next_key("provider-a", &keys, &attempted)
            .expect("expected third key");
        assert_eq!(third.key_index, 2);
        assert_eq!(third.api_key, "k2");
        assert!(!third.from_cooldown_fallback);
    }

    #[test]
    fn acquire_next_key_falls_back_to_earliest_expiring_cooldown_key() {
        let selector = KeySelector::new();
        let keys = vec![key("k0"), key("k1")];

        selector.mark_error("provider-b", 0, 403);
        selector.mark_error("provider-b", 1, 429);

        let acquired = selector
            .acquire_next_key("provider-b", &keys, &HashSet::new())
            .expect("expected a cooldown fallback key");
        assert_eq!(acquired.key_index, 1);
        assert_eq!(acquired.api_key, "k1");
        assert!(acquired.from_cooldown_fallback);
    }

    #[test]
    fn report_success_clears_cooldown_state_for_future_acquisition() {
        let selector = KeySelector::new();
        let keys = vec![key("k0")];

        selector.mark_error("provider-c", 0, 429);
        selector.report_success("provider-c", 0);

        let acquired = selector
            .acquire_next_key("provider-c", &keys, &HashSet::new())
            .expect("expected a healthy key after success");
        assert_eq!(acquired.key_index, 0);
        assert_eq!(acquired.api_key, "k0");
        assert!(!acquired.from_cooldown_fallback);
    }
}
