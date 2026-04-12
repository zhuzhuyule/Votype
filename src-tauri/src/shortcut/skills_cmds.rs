use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::settings::{self, Skill, SkillSource};

// Group: Skills Management
#[tauri::command]
#[specta::specta]
pub fn get_all_skills(app: AppHandle) -> Vec<Skill> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.get_all_skills()
}

#[tauri::command]
#[specta::specta]
pub fn create_skill(app: AppHandle, skill: Skill) -> Result<Skill, String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.create_skill_file(&skill)
}

#[tauri::command]
#[specta::specta]
pub fn delete_skill(app: AppHandle, id: String) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);

    // Try to delete the file-based skill first
    let file_deleted = skill_manager.delete_skill_file(&id).is_ok();

    let mut settings = settings::get_settings(&app);
    let mut settings_changed = false;

    // Only remove from post_process_prompts if NO file was found/deleted.
    // File-based skills (user/imported) and settings-based skills (builtin
    // customizations) are separate stores — deleting a file-based skill must
    // not wipe out a builtin customization that happens to share the same ID.
    if !file_deleted {
        let original_len = settings.post_process_prompts.len();
        settings
            .post_process_prompts
            .retain(|prompt| prompt.id != id);
        if settings.post_process_prompts.len() != original_len {
            settings_changed = true;
        }
    }

    if settings
        .post_process_selected_prompt_id
        .as_ref()
        .is_some_and(|selected_id| selected_id == &id)
    {
        settings.post_process_selected_prompt_id = None;
        settings_changed = true;
    }

    if settings_changed {
        settings::write_settings(&app, settings);
    }

    let existing_order = skill_manager.load_order();
    if existing_order.iter().any(|skill_id| skill_id == &id) {
        let filtered_order: Vec<String> = existing_order
            .into_iter()
            .filter(|skill_id| skill_id != &id)
            .collect();
        skill_manager.save_order(&filtered_order)?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_skill_templates() -> Vec<crate::managers::skill::SkillTemplate> {
    crate::managers::skill::get_builtin_templates()
}

#[tauri::command]
#[specta::specta]
pub fn save_external_skill(app: AppHandle, skill: Skill) -> Result<(), String> {
    if matches!(skill.source, SkillSource::Builtin) {
        // Built-in skills are stored in settings, not as files
        let mut settings = settings::get_settings(&app);
        if let Some(existing) = settings
            .post_process_prompts
            .iter_mut()
            .find(|p| p.id == skill.id)
        {
            existing.name = skill.name;
            existing.description = skill.description;
            existing.instructions = skill.instructions.clone();
            existing.prompt = skill.instructions;
            existing.model_id = skill.model_id;
            existing.icon = skill.icon;
            existing.output_mode = skill.output_mode;
            existing.confidence_check_enabled = skill.confidence_check_enabled;
            existing.confidence_threshold = skill.confidence_threshold;
            existing.locked = skill.locked;
            existing.customized = true;
        } else {
            return Err(format!("Built-in skill not found: {}", skill.id));
        }
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        let skill_manager = crate::managers::skill::SkillManager::new(&app);
        let file_path = skill_manager.find_skill_file_path(&skill.id);
        let mut skill_with_path = skill;
        skill_with_path.file_path = file_path;
        skill_manager.save_skill_to_file(&skill_with_path)?;
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub fn create_skill_from_template(app: AppHandle, template_id: String) -> Result<Skill, String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.create_skill_from_template(&template_id)
}

#[tauri::command]
#[specta::specta]
pub fn reorder_skills(app: AppHandle, order: Vec<String>) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.save_order(&order)
}

#[tauri::command]
#[specta::specta]
pub fn get_skills_order(app: AppHandle) -> Vec<String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.load_order()
}

#[tauri::command]
#[specta::specta]
pub fn get_builtin_skills(app: AppHandle) -> Vec<Skill> {
    let _ = app;
    [
        include_str!("../../resources/skills/builtin/default_correction.skill.md"),
        include_str!("../../resources/skills/builtin/ai_chat.skill.md"),
        include_str!("../../resources/skills/builtin/translation.skill.md"),
        include_str!("../../resources/skills/builtin/summarize.skill.md"),
        include_str!("../../resources/skills/builtin/memo.skill.md"),
        include_str!("../../resources/skills/builtin/code_generate.skill.md"),
        include_str!("../../resources/skills/builtin/code_explain.skill.md"),
        include_str!("../../resources/skills/builtin/style_reply.skill.md"),
        include_str!("../../resources/skills/builtin/reply_suggestion.skill.md"),
        include_str!("../../resources/skills/builtin/votype_command.skill.md"),
        include_str!("../../resources/skills/builtin/grammar_fix.skill.md"),
        include_str!("../../resources/skills/builtin/smart_compose.skill.md"),
    ]
    .iter()
    .filter_map(|content| crate::managers::skill::parse_builtin_skill_content(content))
    .collect()
}

#[tauri::command]
#[specta::specta]
pub fn get_default_skill_content(app: AppHandle, skill_id: String) -> Option<Skill> {
    get_builtin_skills(app)
        .into_iter()
        .find(|s| s.id == skill_id && matches!(s.source, SkillSource::Builtin))
}

#[tauri::command]
#[specta::specta]
pub fn get_external_skills(app: AppHandle) -> Vec<Skill> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    skill_manager.load_all_external_skills()
}

#[tauri::command]
#[specta::specta]
pub fn open_skills_folder(app: AppHandle) -> Result<(), String> {
    let home_dir = app.path().home_dir().map_err(|e| e.to_string())?;
    let skills_dir = home_dir.join(".votype").join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    }
    app.opener()
        .open_path(skills_dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn refresh_external_skills(app: AppHandle) -> Vec<Skill> {
    get_external_skills(app)
}

#[tauri::command]
#[specta::specta]
pub fn reset_skill_to_file_version(app: AppHandle, skill_id: String) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager
        .find_skill_file_path(&skill_id)
        .ok_or_else(|| "File not found".to_string())?;
    let source = if file_path.to_string_lossy().contains("/user/") {
        SkillSource::User
    } else {
        SkillSource::Imported
    };
    let file_skill = skill_manager
        .load_skill_from_path(&file_path, source)
        .ok_or_else(|| "Load failed".to_string())?;
    let mut settings = settings::get_settings(&app);
    if let Some(existing) = settings
        .post_process_prompts
        .iter_mut()
        .find(|p| p.id == skill_id)
    {
        *existing = file_skill;
        existing.customized = false;
        settings::write_settings(&app, settings);
        Ok(())
    } else {
        Err("Skill not found in settings".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_skill_source_file(app: AppHandle, skill_id: String) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager
        .find_skill_file_path(&skill_id)
        .ok_or_else(|| "File not found".to_string())?;
    app.opener()
        .open_path(file_path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn ai_generate_skill(
    app: AppHandle,
    name: String,
    description: String,
    output_mode: String,
) -> Result<String, String> {
    use crate::llm_client::create_client;
    use crate::managers::prompt::{self, PromptManager};
    use async_openai::types::{
        ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    };
    use std::sync::Arc;

    let settings = settings::get_settings(&app);

    // Get text provider
    let provider = settings
        .active_post_process_provider()
        .ok_or("No text provider configured")?;

    let api_key = settings
        .post_process_api_keys
        .first_key(&provider.id)
        .unwrap_or("")
        .to_string();

    let effective_proxy = crate::settings::resolve_proxy(&settings, &provider);
    let client =
        create_client(&provider, api_key, effective_proxy.as_deref()).map_err(|e| e.to_string())?;

    // Get model ID
    let model_id = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .filter(|id| !id.trim().is_empty())
        .or_else(|| {
            settings
                .cached_models
                .iter()
                .find(|m| m.provider_id == provider.id && m.model_type == settings::ModelType::Text)
                .map(|m| m.model_id.clone())
        })
        .ok_or_else(|| format!("No model found for provider {}", provider.id))?;

    // Build prompt from external template
    let prompt_manager = app.state::<Arc<PromptManager>>();
    let template = prompt_manager
        .get_prompt(&app, "system_skill_generation")
        .map_err(|e| format!("Failed to load skill generation prompt: {}", e))?;

    let mut vars = std::collections::HashMap::new();
    vars.insert("SKILL_NAME", name.clone());
    vars.insert("SKILL_DESCRIPTION", description.clone());
    vars.insert("OUTPUT_MODE", output_mode.clone());
    let prompt = prompt::substitute_variables(&template, &vars);

    // Call LLM
    let mut messages = Vec::new();

    if let Ok(user_msg) = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()
    {
        messages.push(ChatCompletionRequestMessage::User(user_msg));
    }

    let request = CreateChatCompletionRequestArgs::default()
        .model(model_id)
        .messages(messages)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or("No response from LLM")?;

    Ok(content)
}

#[tauri::command]
#[specta::specta]
pub fn check_skill_id_conflict(
    app: AppHandle,
    skill_id: String,
    is_external: bool,
) -> Result<bool, String> {
    let settings = settings::get_settings(&app);
    if is_external {
        Ok(settings
            .post_process_prompts
            .iter()
            .any(|p| p.id == skill_id && p.source == SkillSource::Builtin))
    } else {
        let skill_manager = crate::managers::skill::SkillManager::new(&app);
        Ok(skill_manager
            .load_all_external_skills()
            .iter()
            .any(|s| s.id == skill_id))
    }
}

/// Check whether a skill lives in its own directory (supports references).
/// Single-file skills (e.g. `user/my_skill.md`) return false.
/// Directory skills (e.g. `user/my_skill/SKILL.md`) return true.
#[tauri::command]
#[specta::specta]
pub fn is_directory_skill(app: AppHandle, skill_id: String) -> bool {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = match skill_manager.find_skill_file_path(&skill_id) {
        Some(p) => p,
        None => return false,
    };
    // A directory skill has its .md file inside a subdirectory, not directly in user/ or imported/
    let parent = match file_path.parent() {
        Some(p) => p,
        None => return false,
    };
    let parent_name = parent.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // If parent is "user" or "imported", it's a single-file skill
    parent_name != "user" && parent_name != "imported"
}

// ---- Reference management commands ----

/// A reference file entry for a skill.
#[derive(serde::Serialize, specta::Type)]
pub struct SkillReferenceEntry {
    /// Filename without extension (e.g. "_always", "CodeEditor", "Slack")
    pub name: String,
    /// Full filename (e.g. "_always.md")
    pub filename: String,
    /// File content
    pub content: String,
    /// Match type: "always", "app_name", or "app_category"
    pub match_type: String,
}

/// List all reference files for a skill.
#[tauri::command]
#[specta::specta]
pub fn get_skill_references(app: AppHandle, skill_id: String) -> Vec<SkillReferenceEntry> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = match skill_manager.find_skill_file_path(&skill_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let skill_dir = match file_path.parent() {
        Some(d) => d,
        None => return Vec::new(),
    };
    let refs_dir = skill_dir.join("references");
    if !refs_dir.is_dir() {
        return Vec::new();
    }

    let categories = [
        "CodeEditor",
        "Terminal",
        "InstantMessaging",
        "Email",
        "Notes",
        "Browser",
        "Other",
    ];

    let mut entries = Vec::new();
    if let Ok(dir_entries) = std::fs::read_dir(&refs_dir) {
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let content = std::fs::read_to_string(&path).unwrap_or_default();

            let match_type = if stem == "_always" {
                "always".to_string()
            } else if categories
                .iter()
                .any(|c| c.to_lowercase() == stem.to_lowercase())
            {
                "app_category".to_string()
            } else {
                "app_name".to_string()
            };

            entries.push(SkillReferenceEntry {
                name: stem,
                filename,
                content,
                match_type,
            });
        }
    }
    // Sort: _always first, then alphabetically
    entries.sort_by(|a, b| {
        if a.name == "_always" {
            std::cmp::Ordering::Less
        } else if b.name == "_always" {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });
    entries
}

/// Save (create or update) a reference file for a skill.
#[tauri::command]
#[specta::specta]
pub fn save_skill_reference(
    app: AppHandle,
    skill_id: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager
        .find_skill_file_path(&skill_id)
        .ok_or_else(|| format!("Skill not found: {}", skill_id))?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| "Invalid skill path".to_string())?;
    let refs_dir = skill_dir.join("references");

    // Ensure references/ directory exists
    if !refs_dir.exists() {
        std::fs::create_dir_all(&refs_dir).map_err(|e| e.to_string())?;
    }

    // Validate filename
    if !filename.ends_with(".md") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename: must be a .md file without path separators".to_string());
    }

    std::fs::write(refs_dir.join(&filename), content).map_err(|e| e.to_string())
}

/// Delete a reference file for a skill.
#[tauri::command]
#[specta::specta]
pub fn delete_skill_reference(
    app: AppHandle,
    skill_id: String,
    filename: String,
) -> Result<(), String> {
    let skill_manager = crate::managers::skill::SkillManager::new(&app);
    let file_path = skill_manager
        .find_skill_file_path(&skill_id)
        .ok_or_else(|| format!("Skill not found: {}", skill_id))?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| "Invalid skill path".to_string())?;
    let target = skill_dir.join("references").join(&filename);

    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    } else {
        Ok(()) // Already gone
    }
}
