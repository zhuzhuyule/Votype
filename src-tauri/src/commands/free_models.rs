use std::sync::Arc;
use tauri::State;

use crate::managers::free_models::{FreeModel, FreeModelsCache};

#[tauri::command]
pub async fn get_free_models(
    cache: State<'_, Arc<FreeModelsCache>>,
    provider: Option<String>,
) -> Result<Vec<FreeModel>, String> {
    // Ensure cache is loaded
    if let Err(e) = cache.ensure_loaded().await {
        log::warn!("[FreeModels] ensure_loaded failed: {}", e);
    }

    match provider {
        Some(p) => Ok(cache.get_by_provider(&p)),
        None => Ok(cache.get_all()),
    }
}

#[tauri::command]
pub async fn refresh_free_models_cache(
    cache: State<'_, Arc<FreeModelsCache>>,
) -> Result<usize, String> {
    let models = cache.refresh().await.map_err(|e| e.to_string())?;
    Ok(models.len())
}
