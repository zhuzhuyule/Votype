use log::info;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub struct PromptManager {
    data_dir: PathBuf,
}

impl PromptManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        let home_dir = app_handle
            .path()
            .home_dir()
            .unwrap_or_else(|_| PathBuf::from("~"));
        let data_dir = home_dir.join(".votype").join("skills").join("system");

        if !data_dir.exists() {
            let _ = fs::create_dir_all(&data_dir);
        }

        Self { data_dir }
    }

    /// Compute a stable hash of content for change detection.
    fn content_hash(content: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }

    /// Resolve the built-in resource file path for a prompt.
    fn resolve_resource_path(
        app_handle: &tauri::AppHandle,
        filename: &str,
    ) -> Result<PathBuf, String> {
        let resource_rel_path = format!("resources/prompts/{}", filename);
        let resolved_path = app_handle
            .path()
            .resolve(&resource_rel_path, tauri::path::BaseDirectory::Resource);

        match &resolved_path {
            Ok(path) if path.exists() => return Ok(path.clone()),
            _ => {}
        }

        // Fallback for development mode: navigate from target/debug to src-tauri/resources
        if let Some(path) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
            .map(|dir| dir.join("../../resources/prompts").join(filename))
            .and_then(|p| p.canonicalize().ok())
        {
            return Ok(path);
        }

        let attempted = match &resolved_path {
            Ok(p) => format!("{:?}", p),
            Err(e) => e.to_string(),
        };
        Err(format!(
            "Prompt resource not found. Attempted: {}",
            attempted
        ))
    }

    /// Load a prompt by ID.
    ///
    /// Version-aware loading strategy:
    /// 1. If user file exists, compare with built-in resource via hash tracking
    ///    - Resource unchanged → use user file
    ///    - Resource updated + user hasn't customized → auto-update user file
    ///    - Resource updated + user has customized → keep user version
    /// 2. If no user file, copy from built-in resource
    pub fn get_prompt(&self, app_handle: &tauri::AppHandle, id: &str) -> Result<String, String> {
        let filename = format!("{}.md", id);
        let user_path = self.data_dir.join(&filename);
        let hash_path = self.data_dir.join(format!(".{}.resource_hash", filename));

        // Try to load built-in resource content
        let resource_content =
            Self::resolve_resource_path(app_handle, &filename).and_then(|path| {
                fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read resource prompt {}: {}", id, e))
            });

        // Case 1: User file exists — check if it needs updating
        if user_path.exists() {
            if let Ok(user_content) = fs::read_to_string(&user_path) {
                if let Ok(ref resource) = resource_content {
                    let resource_hash = Self::content_hash(resource);
                    let stored_hash = fs::read_to_string(&hash_path).unwrap_or_default();

                    if resource_hash != stored_hash {
                        // Built-in resource has changed since last sync
                        let user_hash = Self::content_hash(&user_content);
                        // User is "unmodified" if: no hash file yet (legacy) OR user content matches last-synced resource
                        let user_unmodified = stored_hash.is_empty() || user_hash == stored_hash;

                        if user_unmodified {
                            info!("[Prompt] Updating '{}': built-in version changed", id);
                            let _ = fs::write(&user_path, resource);
                            let _ = fs::write(&hash_path, &resource_hash);
                            return Ok(resource.clone());
                        } else {
                            info!(
                                "[Prompt] Keeping customized '{}' (built-in changed but user has modifications)",
                                id
                            );
                            let _ = fs::write(&hash_path, &resource_hash);
                        }
                    }
                }
                return Ok(user_content);
            }
        }

        // Case 2: No user file — copy from built-in resource
        match resource_content {
            Ok(content) => {
                if let Some(parent) = user_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let hash = Self::content_hash(&content);
                if let Err(e) = fs::write(&user_path, &content) {
                    log::error!("Failed to initialize user-side system prompt {}: {}", id, e);
                } else {
                    let _ = fs::write(&hash_path, &hash);
                    info!("Initialized system prompt: {} in user directory", id);
                }
                Ok(content)
            }
            Err(e) => Err(e),
        }
    }

    /// Save a customized system prompt
    #[allow(dead_code)]
    pub fn save_prompt(&self, id: &str, content: &str) -> Result<(), String> {
        let filename = format!("{}.md", id);
        let user_path = self.data_dir.join(&filename);
        fs::write(&user_path, content).map_err(|e| format!("Failed to write prompt {}: {}", id, e))
    }

    /// Reset a system prompt to its built-in default
    #[allow(dead_code)]
    pub fn reset_prompt(&self, app_handle: &tauri::AppHandle, id: &str) -> Result<String, String> {
        let filename = format!("{}.md", id);
        let user_path = self.data_dir.join(&filename);
        let hash_path = self.data_dir.join(format!(".{}.resource_hash", filename));
        if user_path.exists() {
            let _ = fs::remove_file(&user_path);
        }
        if hash_path.exists() {
            let _ = fs::remove_file(&hash_path);
        }
        self.get_prompt(app_handle, id)
    }
}

/// Simple variable substitution utility
pub fn substitute_variables(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut result = template.to_string();
    for (name, value) in vars {
        let placeholder = format!("{{{{{}}}}}", name);
        result = result.replace(&placeholder, value);
    }
    result
}
