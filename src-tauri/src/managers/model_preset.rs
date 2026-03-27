use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A single model family entry in model_presets.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFamilyConfig {
    pub id: String,
    pub match_patterns: Vec<String>,
    pub default_preset: String,
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

    /// Get all family ids (for UI dropdown)
    pub fn family_ids(&self) -> Vec<String> {
        self.families.iter().map(|f| f.id.clone()).collect()
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
    config: &ModelPresetsConfig,
) -> HashMap<String, serde_json::Value> {
    let family_id = match model_family {
        Some(f) => f,
        None => {
            log::debug!("No model family, skipping preset params");
            return HashMap::new();
        }
    };

    let family_config = match config.find_family(family_id) {
        Some(fc) => fc,
        None => {
            log::warn!("Model family '{}' not found in presets config", family_id);
            return HashMap::new();
        }
    };

    let preset_name = param_preset.unwrap_or(&family_config.default_preset);

    let params = family_config.presets.get(preset_name).or_else(|| {
        log::warn!(
            "Preset '{}' not found for family '{}', falling back to '{}'",
            preset_name,
            family_id,
            family_config.default_preset
        );
        family_config.presets.get(&family_config.default_preset)
    });

    log::debug!(
        "Resolved preset: family='{}', preset='{}'",
        family_id,
        preset_name
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
