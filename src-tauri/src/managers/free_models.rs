use anyhow::Result;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

const WORKER_URL: &str = "https://gitee-worker.zhuzhuyule-779.workers.dev/api/models/free";
const CACHE_FILE: &str = "free_models_cache.json";
const CACHE_TTL_SECS: i64 = 86400; // 24 hours

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeModel {
    pub id: String,
    pub name: String,
    pub capabilities: String,
    pub price: f64,
    pub provider: String,
    #[serde(default)]
    pub vendor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiResponse {
    #[serde(default)]
    data: Vec<FreeModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheFile {
    fetched_at: String,
    models: Vec<FreeModel>,
}

pub struct FreeModelsCache {
    cache_dir: PathBuf,
    models: Mutex<Vec<FreeModel>>,
}

impl FreeModelsCache {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let cache = Self {
            cache_dir: app_data_dir,
            models: Mutex::new(Vec::new()),
        };
        // Try loading from disk cache
        if let Err(e) = cache.load_from_disk() {
            debug!("[FreeModels] No cache on disk: {}", e);
        }
        cache
    }

    fn cache_path(&self) -> PathBuf {
        self.cache_dir.join(CACHE_FILE)
    }

    fn load_from_disk(&self) -> Result<()> {
        let path = self.cache_path();
        let content = std::fs::read_to_string(&path)?;
        let cache: CacheFile = serde_json::from_str(&content)?;
        let mut models = self.models.lock().unwrap();
        *models = cache.models;
        info!(
            "[FreeModels] Loaded {} models from disk cache",
            models.len()
        );
        Ok(())
    }

    fn save_to_disk(&self, models: &[FreeModel]) -> Result<()> {
        let cache = CacheFile {
            fetched_at: chrono::Utc::now().to_rfc3339(),
            models: models.to_vec(),
        };
        let content = serde_json::to_string_pretty(&cache)?;
        std::fs::write(self.cache_path(), content)?;
        debug!("[FreeModels] Saved {} models to disk cache", models.len());
        Ok(())
    }

    fn is_cache_fresh(&self) -> bool {
        let path = self.cache_path();
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(cache) = serde_json::from_str::<CacheFile>(&content) {
                if let Ok(fetched) = chrono::DateTime::parse_from_rfc3339(&cache.fetched_at) {
                    let age = chrono::Utc::now().signed_duration_since(fetched);
                    return age.num_seconds() < CACHE_TTL_SECS;
                }
            }
        }
        false
    }

    /// Fetch from worker API and update cache. Returns the fetched models.
    pub async fn refresh(&self) -> Result<Vec<FreeModel>> {
        info!("[FreeModels] Fetching from {}", WORKER_URL);

        let client = crate::http_client::build_http_client(
            None,
            std::time::Duration::from_secs(15),
            reqwest::header::HeaderMap::new(),
        )
        .map_err(|e| anyhow::anyhow!(e))?;

        let response = client.get(WORKER_URL).send().await?;
        let status = response.status();
        if !status.is_success() {
            let err = response.text().await.unwrap_or_default();
            anyhow::bail!("Worker API returned {}: {}", status, err);
        }

        let api_resp: ApiResponse = response.json().await?;
        info!("[FreeModels] Fetched {} models", api_resp.data.len());

        // Update memory
        {
            let mut models = self.models.lock().unwrap();
            *models = api_resp.data.clone();
        }

        // Save to disk
        if let Err(e) = self.save_to_disk(&api_resp.data) {
            warn!("[FreeModels] Failed to save cache: {}", e);
        }

        Ok(api_resp.data)
    }

    /// Ensure cache is loaded. If stale or empty, refresh in background.
    pub async fn ensure_loaded(&self) -> Result<()> {
        let is_empty = self.models.lock().unwrap().is_empty();
        if is_empty || !self.is_cache_fresh() {
            self.refresh().await?;
        }
        Ok(())
    }

    /// Get all cached free models.
    pub fn get_all(&self) -> Vec<FreeModel> {
        self.models.lock().unwrap().clone()
    }

    /// Get free models matching a provider name (e.g., "gitee", "xunfei").
    pub fn get_by_provider(&self, provider: &str) -> Vec<FreeModel> {
        self.models
            .lock()
            .unwrap()
            .iter()
            .filter(|m| m.provider.eq_ignore_ascii_case(provider))
            .cloned()
            .collect()
    }
}
