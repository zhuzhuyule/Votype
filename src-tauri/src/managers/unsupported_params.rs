//! Tracks which request parameters each (provider, model) pair has rejected
//! with HTTP 400 "unsupported parameter" errors. Used to:
//!
//! 1. Pre-strip known-bad params before sending a request.
//! 2. Learn from new 400 responses by appending to the set and persisting.
//!
//! Storage: `{app_data_dir}/unsupported_params.json`. Shape:
//! `{ "provider_id:::model_id": ["min_p", "top_k"], ... }`.
//!
//! Granularity is `(provider_id, remote_model_id)` because the constraint
//! lives on the remote endpoint, not on the user's local cached_model_id
//! (the same remote model may be referenced by multiple cached entries).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

const FILE_NAME: &str = "unsupported_params.json";
const KEY_SEP: &str = ":::";

#[derive(Debug, Default)]
struct Inner {
    map: HashMap<String, HashSet<String>>,
}

#[derive(Debug, Clone)]
pub struct UnsupportedParamsManager {
    inner: Arc<RwLock<Inner>>,
    file_path: PathBuf,
}

impl UnsupportedParamsManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let file_path = app_data_dir.join(FILE_NAME);
        let mut inner = Inner::default();
        if let Ok(bytes) = std::fs::read(&file_path) {
            match serde_json::from_slice::<HashMap<String, Vec<String>>>(&bytes) {
                Ok(parsed) => {
                    inner.map = parsed
                        .into_iter()
                        .map(|(k, v)| (k, v.into_iter().collect::<HashSet<_>>()))
                        .collect();
                    log::info!(
                        "[UnsupportedParams] Loaded {} entries from {}",
                        inner.map.len(),
                        file_path.display()
                    );
                }
                Err(e) => log::warn!(
                    "[UnsupportedParams] Failed to parse {}: {}. Starting fresh.",
                    file_path.display(),
                    e
                ),
            }
        }
        Self {
            inner: Arc::new(RwLock::new(inner)),
            file_path,
        }
    }

    fn key(provider_id: &str, model_id: &str) -> String {
        format!("{}{}{}", provider_id, KEY_SEP, model_id)
    }

    /// Return the set of params known to be rejected by (provider, model).
    pub fn get(&self, provider_id: &str, model_id: &str) -> HashSet<String> {
        let key = Self::key(provider_id, model_id);
        let guard = self.inner.read().expect("unsupported_params lock poisoned");
        guard.map.get(&key).cloned().unwrap_or_default()
    }

    /// Record a newly-learned unsupported param. Returns true if this was new
    /// (and therefore persisted).
    pub fn mark(&self, provider_id: &str, model_id: &str, param: &str) -> bool {
        let key = Self::key(provider_id, model_id);
        let newly_added = {
            let mut guard = self
                .inner
                .write()
                .expect("unsupported_params lock poisoned");
            guard.map.entry(key).or_default().insert(param.to_string())
        };
        if newly_added {
            if let Err(e) = self.save_to_disk() {
                log::warn!("[UnsupportedParams] Persist failed: {}", e);
            }
        }
        newly_added
    }

    fn save_to_disk(&self) -> std::io::Result<()> {
        let snapshot: HashMap<String, Vec<String>> = {
            let guard = self.inner.read().expect("unsupported_params lock poisoned");
            guard
                .map
                .iter()
                .map(|(k, v)| {
                    let mut items: Vec<String> = v.iter().cloned().collect();
                    items.sort();
                    (k.clone(), items)
                })
                .collect()
        };
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(&snapshot)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(&self.file_path, bytes)
    }
}
