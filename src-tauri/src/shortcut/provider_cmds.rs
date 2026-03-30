use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::settings::{
    self, PostProcessProvider, APPLE_INTELLIGENCE_DEFAULT_MODEL_ID, APPLE_INTELLIGENCE_PROVIDER_ID,
};

fn provider_avatar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?
        .join("provider_avatars");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create avatar cache directory: {}", e))?;
    Ok(dir)
}

fn provider_avatar_prefix(provider_id: &str) -> String {
    let sanitized: String = provider_id
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => c,
            _ => '_',
        })
        .collect();
    format!("{}_avatar_", sanitized)
}

fn cleanup_provider_avatar_files(dir: &Path, provider_id: &str) -> Result<(), String> {
    let prefix = provider_avatar_prefix(provider_id);
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read avatar cache directory: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read avatar cache entry: {}", e))?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with(&prefix) {
            fs::remove_file(entry.path())
                .map_err(|e| format!("Failed to remove cached avatar: {}", e))?;
        }
    }
    Ok(())
}

fn avatar_extension_from_content_type(content_type: &str) -> &'static str {
    let normalized = content_type.trim().to_ascii_lowercase();
    if normalized.contains("svg") {
        "svg"
    } else if normalized.contains("png") {
        "png"
    } else if normalized.contains("jpeg") || normalized.contains("jpg") {
        "jpg"
    } else if normalized.contains("webp") {
        "webp"
    } else {
        "ico"
    }
}

fn avatar_file_path(dir: &Path, provider_id: &str, origin: &str, ext: &str) -> PathBuf {
    let stem = avatar_file_stem(provider_id, origin);
    dir.join(format!("{}.{}", stem, ext))
}

fn avatar_file_stem(provider_id: &str, origin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(origin.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    format!("{}{}", provider_avatar_prefix(provider_id), &hash[..16])
}

fn known_provider_avatar_origin(provider_id: &str) -> Option<&'static str> {
    match provider_id {
        "openai" => Some("https://openai.com"),
        "openrouter" => Some("https://openrouter.ai"),
        "anthropic" => Some("https://www.anthropic.com"),
        "apple_intelligence" => Some("https://www.apple.com"),
        "iflow" => Some("https://iflow.cn"),
        "gitee" => Some("https://gitee.com"),
        "zai" => Some("https://z.ai"),
        _ => None,
    }
}

fn root_origin_candidate(parsed: &reqwest::Url) -> Option<String> {
    let host = parsed.host_str()?;
    let segments: Vec<&str> = host.split('.').collect();
    if segments.len() <= 2 {
        return None;
    }

    let root_host = segments[segments.len() - 2..].join(".");
    if root_host == host {
        return None;
    }

    Some(format!("{}://{}", parsed.scheme(), root_host))
}

fn avatar_origin_candidates(provider_id: &str, parsed: &reqwest::Url) -> Vec<String> {
    let mut candidates = Vec::new();
    let base_origin = parsed.origin().ascii_serialization();
    if !base_origin.is_empty() {
        candidates.push(base_origin);
    }

    if let Some(root_origin) = root_origin_candidate(parsed) {
        if !candidates.iter().any(|existing| existing == &root_origin) {
            candidates.push(root_origin);
        }
    }

    if let Some(known_origin) = known_provider_avatar_origin(provider_id) {
        let known = known_origin.to_string();
        if !candidates.iter().any(|existing| existing == &known) {
            candidates.insert(0, known);
        }
    }

    candidates
}

#[tauri::command]
#[specta::specta]
pub async fn get_provider_avatar_path(
    app: AppHandle,
    provider_id: String,
) -> Result<Option<String>, String> {
    let settings = settings::get_settings(&app);
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or("Provider not found")?;

    let trimmed = provider.base_url.trim();
    if trimmed.is_empty() || trimmed.starts_with("apple-intelligence://") {
        return Ok(None);
    }

    let parsed =
        reqwest::Url::parse(trimmed).map_err(|e| format!("Invalid provider base URL: {}", e))?;
    let origins = avatar_origin_candidates(&provider_id, &parsed);
    if origins.is_empty() {
        return Ok(None);
    }

    let dir = provider_avatar_dir(&app)?;
    for origin in &origins {
        let expected_stem = avatar_file_stem(&provider_id, origin);
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let file_name = file_name.to_string_lossy();
                if file_name.starts_with(&expected_stem) {
                    return Ok(Some(entry.path().to_string_lossy().to_string()));
                }
            }
        }
    }

    cleanup_provider_avatar_files(&dir, &provider_id)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("Failed to create avatar HTTP client: {}", e))?;

    for origin in origins {
        let favicon_url = format!("{}/favicon.ico", origin.trim_end_matches('/'));
        let response = match client
            .get(&favicon_url)
            .header(reqwest::header::USER_AGENT, "Votype/0.6")
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };

        if !response.status().is_success() {
            continue;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("image/x-icon");
        let ext = avatar_extension_from_content_type(content_type);
        let bytes = match response.bytes().await {
            Ok(bytes) if !bytes.is_empty() => bytes,
            _ => continue,
        };

        let file_path = avatar_file_path(&dir, &provider_id, &origin, ext);
        fs::write(&file_path, &bytes)
            .map_err(|e| format!("Failed to write provider avatar cache: {}", e))?;

        return Ok(Some(file_path.to_string_lossy().to_string()));
    }

    Ok(None)
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_post_process_models(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let settings = settings::get_settings(&app);
    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or("Provider not found")?;
    let api_key = settings
        .post_process_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return Ok(vec![APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string()]);
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return Err("Apple Intelligence is only available on Apple silicon Macs running macOS 15 or later.".to_string());
        }
    }

    super::fetch_models_manual(provider, api_key).await
}

#[tauri::command]
#[specta::specta]
pub fn add_custom_provider(
    app: AppHandle,
    label: String,
    base_url: String,
    models_endpoint: Option<String>,
) -> Result<PostProcessProvider, String> {
    let mut settings = settings::get_settings(&app);
    let id = format!("custom-{}", Utc::now().timestamp_millis());
    let provider = PostProcessProvider {
        id: id.clone(),
        label: label.trim().to_string(),
        base_url: crate::utils::normalize_base_url(&base_url),
        builtin: false,
        deletable: true,
        allow_base_url_edit: true,
        models_endpoint,
        supports_structured_output: false,
        custom_headers: None,
    };
    settings.post_process_providers.push(provider.clone());
    settings::write_settings(&app, settings);
    Ok(provider)
}

#[tauri::command]
#[specta::specta]
pub fn update_custom_provider(
    app: AppHandle,
    provider_id: String,
    label: Option<String>,
    base_url: Option<String>,
    models_endpoint: Option<String>,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let provider = settings
        .post_process_providers
        .iter_mut()
        .find(|p| p.id == provider_id)
        .ok_or("Provider not found")?;
    if let Some(l) = label {
        provider.label = l;
    }
    if let Some(b) = base_url {
        provider.base_url = crate::utils::normalize_base_url(&b);
        let avatar_dir = provider_avatar_dir(&app)?;
        cleanup_provider_avatar_files(&avatar_dir, &provider_id)?;
    }
    if let Some(m) = models_endpoint {
        provider.models_endpoint = Some(m);
    }
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn remove_custom_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings
        .post_process_providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or("Provider not found")?;

    // Remove the provider
    settings
        .post_process_providers
        .retain(|p| p.id != provider_id);

    // If the active provider was the deleted one, reset to first available
    if settings.post_process_provider_id == provider_id {
        settings.post_process_provider_id = settings
            .post_process_providers
            .first()
            .map(|p| p.id.clone())
            .unwrap_or_else(|| "openai".to_string());
    }

    // Clean up cached models that belong to the deleted provider
    settings
        .cached_models
        .retain(|m| m.provider_id != provider_id);

    // Clean up api keys and model selections for the deleted provider
    settings.post_process_api_keys.remove(&provider_id);
    settings.post_process_models.remove(&provider_id);

    settings::write_settings(&app, settings);

    let avatar_dir = provider_avatar_dir(&app)?;
    cleanup_provider_avatar_files(&avatar_dir, &provider_id)?;

    Ok(())
}
