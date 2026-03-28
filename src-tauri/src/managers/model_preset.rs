use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A single model family entry in model_presets.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFamilyConfig {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub match_patterns: Vec<String>,
    pub default_preset: String,
    #[serde(default)]
    pub source: Option<String>,
    pub presets: HashMap<String, HashMap<String, serde_json::Value>>,
}

/// Top-level structure of model_presets.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPresetsConfig {
    pub version: u32,
    pub presets: Vec<String>,
    pub families: Vec<ModelFamilyConfig>,
}

impl ModelPresetsConfig {
    /// Load from a JSON file path
    pub fn load_from_file(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read model_presets.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse model_presets.json: {}", e))
    }

    /// Find a family config by family id
    pub fn find_family(&self, family_id: &str) -> Option<&ModelFamilyConfig> {
        self.families.iter().find(|f| f.id == family_id)
    }

    /// Get all families as (id, display_name) pairs for UI dropdown
    pub fn family_options(&self) -> Vec<(String, String)> {
        self.families
            .iter()
            .map(|f| {
                let display = f.display_name.clone().unwrap_or_else(|| f.id.clone());
                (f.id.clone(), display)
            })
            .collect()
    }
}

/// Detect model family from a model identifier string.
/// Checks against match_patterns in order (first match wins).
pub fn detect_model_family(model_identifier: &str, config: &ModelPresetsConfig) -> Option<String> {
    let lower = model_identifier.to_lowercase();
    for family in &config.families {
        for pattern in &family.match_patterns {
            if lower.contains(pattern) {
                return Some(family.id.clone());
            }
        }
    }
    None
}

/// Detect model family with custom_label priority.
/// Checks custom_label first, then model_id.
pub fn detect_model_family_with_label(
    model_id: &str,
    custom_label: Option<&str>,
    config: &ModelPresetsConfig,
) -> Option<String> {
    if let Some(label) = custom_label {
        if let Some(family) = detect_model_family(label, config) {
            return Some(family);
        }
    }
    detect_model_family(model_id, config)
}

/// Resolve preset parameters for a given skill preset and model family.
/// Returns empty HashMap if family or preset not found.
pub fn resolve_preset_params(
    param_preset: Option<&str>,
    model_family: Option<&str>,
    model_id: &str,
    config: &ModelPresetsConfig,
) -> HashMap<String, serde_json::Value> {
    let family_id = match model_family {
        Some(f) => f,
        None => {
            log::debug!(
                "[ModelPreset] model_id='{}' has no family, skipping preset params",
                model_id
            );
            return HashMap::new();
        }
    };

    let family_config = match config.find_family(family_id) {
        Some(fc) => fc,
        None => {
            log::warn!(
                "[ModelPreset] model_id='{}' family='{}' not found in presets config",
                model_id,
                family_id
            );
            return HashMap::new();
        }
    };

    let preset_name = param_preset.unwrap_or(&family_config.default_preset);

    let params = family_config.presets.get(preset_name).or_else(|| {
        log::warn!(
            "[ModelPreset] model_id='{}' family='{}' preset='{}' not found, falling back to '{}'",
            model_id,
            family_id,
            preset_name,
            family_config.default_preset
        );
        family_config.presets.get(&family_config.default_preset)
    });

    log::info!(
        "[ModelPreset] model_id='{}' family='{}' preset='{}' → {:?}",
        model_id,
        family_id,
        preset_name,
        params
    );

    params.cloned().unwrap_or_default()
}

/// Merge preset params with user extra_params. User params take priority.
pub fn merge_params(
    preset_params: HashMap<String, serde_json::Value>,
    user_extra_params: Option<&HashMap<String, serde_json::Value>>,
) -> HashMap<String, serde_json::Value> {
    let mut base = preset_params;
    if let Some(user_params) = user_extra_params {
        for (k, v) in user_params {
            base.insert(k.clone(), v.clone());
        }
    }
    base
}

const CURRENT_VERSION: u32 = 1;

/// Load model presets config, checking user data dir first, then built-in resources.
pub fn load_model_presets(app_handle: &tauri::AppHandle) -> Result<ModelPresetsConfig, String> {
    use tauri::Manager;

    // 1. Check user app data directory for override
    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let user_path = data_dir.join("model_presets.json");
        if user_path.exists() {
            log::info!("Loading user model_presets.json from {:?}", user_path);
            let user_config = ModelPresetsConfig::load_from_file(&user_path)?;
            if user_config.version < CURRENT_VERSION {
                log::warn!(
                    "User model_presets.json (v{}) is older than built-in (v{}). User file takes precedence.",
                    user_config.version, CURRENT_VERSION
                );
            }
            return Ok(user_config);
        }
    }

    // 2. Fall back to built-in resource
    let resource_rel = "resources/model_presets.json";
    if let Ok(path) = app_handle
        .path()
        .resolve(resource_rel, tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            log::info!("Loading built-in model_presets.json from {:?}", path);
            return ModelPresetsConfig::load_from_file(&path);
        }
    }

    // 3. Development fallback
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .map(|dir| dir.join("../../resources/model_presets.json"))
        .and_then(|p| p.canonicalize().ok())
    {
        log::info!("Loading dev model_presets.json from {:?}", path);
        return ModelPresetsConfig::load_from_file(&path);
    }

    Err("model_presets.json not found in any location".to_string())
}
