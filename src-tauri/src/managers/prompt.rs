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

    /// Load a prompt by ID. Checks user data directory first, falls back to resources.
    /// If loading from resources for the first time, it copies the file to the user directory
    /// to allow for user customization.
    pub fn get_prompt(&self, app_handle: &tauri::AppHandle, id: &str) -> Result<String, String> {
        let filename = format!("{}.md", id);
        let user_path = self.data_dir.join(&filename);

        // 1. Try user data directory first (for customized system prompts)
        if user_path.exists() {
            if let Ok(content) = fs::read_to_string(&user_path) {
                return Ok(content);
            }
        }

        // 2. Fallback to built-in resources
        let resource_rel_path = format!("resources/prompts/{}", filename);
        let resolved_path = app_handle
            .path()
            .resolve(&resource_rel_path, tauri::path::BaseDirectory::Resource);

        // Try to find the resource file, with fallback for development mode
        let resource_path = match &resolved_path {
            Ok(path) if path.exists() => Some(path.clone()),
            _ => {
                // In development mode, try the source directory directly
                // The resource path in dev mode points to target/debug/resources
                // but files are actually in src-tauri/resources
                std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
                    .map(|dir| {
                        // Navigate from target/debug to src-tauri/resources
                        dir.join("../../resources/prompts").join(&filename)
                    })
                    .and_then(|p| p.canonicalize().ok())
            }
        };

        match resource_path {
            Some(path) => match fs::read_to_string(&path) {
                Ok(content) => {
                    // Copy to user directory so they can see/edit it
                    // Create parent if missing
                    if let Some(parent) = user_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if let Err(e) = fs::write(&user_path, &content) {
                        log::error!("Failed to initialize user-side system prompt {}: {}", id, e);
                    } else {
                        info!("Initialized system prompt: {} in user directory", id);
                    }
                    Ok(content)
                }
                Err(e) => Err(format!("Failed to read resource prompt {}: {}", id, e)),
            },
            None => {
                let attempted_path = match &resolved_path {
                    Ok(p) => format!("{:?}", p),
                    Err(e) => e.to_string(),
                };
                Err(format!(
                    "Prompt resource not found. Attempted: {}",
                    attempted_path
                ))
            }
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
        if user_path.exists() {
            let _ = fs::remove_file(&user_path);
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
