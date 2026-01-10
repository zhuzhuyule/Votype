use crate::settings::{Skill, SkillOutputMode, SkillSource, SkillType};
use log::{debug, error};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: Option<String>,
    aliases: Option<String>,
    #[serde(default)]
    skill_type: SkillType,
    #[serde(default)]
    output_mode: SkillOutputMode,
    model_id: Option<String>,
    icon: Option<String>,
}

pub struct SkillManager {
    base_dir: PathBuf,
}

impl SkillManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        let home_dir = app_handle
            .path()
            .home_dir()
            .unwrap_or_else(|_| PathBuf::from("~"));
        let base_dir = home_dir.join(".votype").join("skills");

        if !base_dir.exists() {
            if let Err(e) = fs::create_dir_all(&base_dir) {
                error!("Failed to create skills directory: {}", e);
            }
        }

        // Ensure subdirs exist
        let _ = fs::create_dir_all(base_dir.join("user"));
        let _ = fs::create_dir_all(base_dir.join("imported"));

        Self { base_dir }
    }

    /// Find the file path for a skill by its ID
    /// Searches both user/ and imported/ directories
    pub fn find_skill_file_path(&self, skill_id: &str) -> Option<PathBuf> {
        // Search in both subdirectories
        for subdir in ["user", "imported"] {
            if let Some(path) = self.search_skill_in_dir(&self.base_dir.join(subdir), skill_id) {
                return Some(path);
            }
        }
        None
    }

    /// Search for a skill file in a specific directory
    fn search_skill_in_dir(&self, dir: &Path, skill_id: &str) -> Option<PathBuf> {
        if !dir.exists() || !dir.is_dir() {
            return None;
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();

                // Check for folder with SKILL.md or skill.md
                if entry_path.is_dir() {
                    let skill_md = entry_path.join("SKILL.md");
                    let skill_md_lower = entry_path.join("skill.md");
                    for md_file in [skill_md, skill_md_lower] {
                        if md_file.exists() {
                            if let Ok(content) = fs::read_to_string(&md_file) {
                                if let Some(frontmatter_str) = Self::extract_frontmatter(&content) {
                                    if let Ok(fm) =
                                        serde_yaml::from_str::<SkillFrontmatter>(frontmatter_str)
                                    {
                                        let id = format!(
                                            "ext_{}",
                                            fm.name.to_lowercase().replace(" ", "_")
                                        );
                                        if id == skill_id {
                                            return Some(md_file);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Check for single .md file
                if entry_path.is_file() && entry_path.extension().map_or(false, |ext| ext == "md") {
                    if let Some(name) = entry_path.file_stem() {
                        let id = format!(
                            "ext_{}",
                            name.to_string_lossy().to_lowercase().replace(" ", "_")
                        );
                        if id == skill_id {
                            return Some(entry_path);
                        }
                    }
                }
            }
        }
        None
    }

    /// Load a single skill from a file path with file_path set
    pub fn load_skill_from_path(&self, file_path: &Path, source: SkillSource) -> Option<Skill> {
        let mut skill = self.parse_skill_file(file_path, source)?;
        skill.file_path = Some(file_path.to_path_buf());
        Some(skill)
    }

    pub fn load_all_external_skills(&self) -> Vec<Skill> {
        let mut skills = Vec::new();

        // Load from ~/.votype/skills/user/
        skills.extend(self.load_from_subdir("user", SkillSource::User));

        // Load from ~/.votype/skills/imported/
        skills.extend(self.load_from_subdir("imported", SkillSource::Imported));

        skills
    }

    fn load_from_subdir(&self, subdir: &str, source: SkillSource) -> Vec<Skill> {
        let mut skills = Vec::new();
        let path = self.base_dir.join(subdir);

        if !path.exists() || !path.is_dir() {
            return skills;
        }

        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    if let Some(skill) = self.parse_skill_folder(&entry_path, source.clone()) {
                        skills.push(skill);
                    }
                } else if entry_path.is_file()
                    && entry_path.extension().map_or(false, |ext| ext == "md")
                {
                    if let Some(skill) = self.parse_skill_file(&entry_path, source.clone()) {
                        skills.push(skill);
                    }
                }
            }
        }
        skills
    }

    fn parse_skill_folder(&self, folder: &Path, source: SkillSource) -> Option<Skill> {
        let skill_md = folder.join("SKILL.md");
        if skill_md.exists() {
            return self.parse_skill_file(&skill_md, source);
        }
        let skill_md_lower = folder.join("skill.md");
        if skill_md_lower.exists() {
            return self.parse_skill_file(&skill_md_lower, source);
        }
        None
    }

    /// Extract YAML frontmatter from content
    /// Returns the frontmatter string if found, None otherwise
    fn extract_frontmatter(content: &str) -> Option<&str> {
        if content.starts_with("---") {
            let parts: Vec<&str> = content.splitn(3, "---").collect();
            if parts.len() >= 2 {
                return Some(parts[1]);
            }
        }
        None
    }

    fn parse_skill_file(&self, file_path: &Path, source: SkillSource) -> Option<Skill> {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to read skill file {:?}: {}", file_path, e);
                return None;
            }
        };

        let (frontmatter_str, instructions) = if content.starts_with("---") {
            let parts: Vec<&str> = content.splitn(3, "---").collect();
            if parts.len() == 3 {
                (parts[1], parts[2].trim())
            } else {
                ("", content.trim())
            }
        } else {
            ("", content.trim())
        };

        if frontmatter_str.is_empty() {
            // Basic support for no-frontmatter skills.
            // Use filename as name if no frontmatter.
            let name = file_path.file_stem()?.to_string_lossy().into_owned();
            let id = format!("ext_{}", name.to_lowercase().replace(" ", "_"));

            debug!(
                "Loaded skill \"{}\" from {:?} (no frontmatter)",
                name, file_path
            );

            return Some(Skill {
                id,
                name,
                description: String::new(),
                instructions: instructions.to_string(),
                model_id: None,
                aliases: None,
                icon: None,
                skill_type: SkillType::Text,
                source,
                compliance_check_enabled: false,
                compliance_threshold: Some(20),
                output_mode: SkillOutputMode::Chat, // Default to Chat for external skills
                enabled: true,
                customized: false, // Not customized by default
                file_path: Some(file_path.to_path_buf()), // Store file path
            });
        }

        let fm: SkillFrontmatter = match serde_yaml::from_str(frontmatter_str) {
            Ok(f) => f,
            Err(e) => {
                error!("Failed to parse frontmatter in {:?}: {}", file_path, e);
                return None;
            }
        };

        let id = format!("ext_{}", fm.name.to_lowercase().replace(" ", "_"));

        debug!(
            "Loaded skill \"{}\" from {:?} (id: {})",
            fm.name, file_path, id
        );

        // Use output_mode from frontmatter, default to Chat if not specified
        let output_mode = fm.output_mode;

        Some(Skill {
            id,
            name: fm.name,
            description: fm.description.unwrap_or_default(),
            instructions: instructions.to_string(),
            model_id: fm.model_id,
            aliases: fm.aliases,
            icon: fm.icon,
            skill_type: fm.skill_type,
            source,
            compliance_check_enabled: false,
            compliance_threshold: Some(20),
            output_mode,
            enabled: true,
            customized: false,                        // Not customized by default
            file_path: Some(file_path.to_path_buf()), // Store file path
        })
    }
}
