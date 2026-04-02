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
    /// Returns (key_index_in_original_list, api_key_string).
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
