use crate::settings::{Skill, SkillOutputMode, SkillSource, SkillType};
use log::{debug, error};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    id: Option<String>,
    name: String,
    description: Option<String>,
    #[serde(default)]
    skill_type: SkillType,
    #[serde(default)]
    output_mode: SkillOutputMode,
    model_id: Option<String>,
    icon: Option<String>,
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    confidence_check_enabled: bool,
    confidence_threshold: Option<u8>,
}

/// Template for creating new skills
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub icon: Option<String>,
    pub output_mode: SkillOutputMode,
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
        debug!("find_skill_file_path: looking for skill_id={}", skill_id);
        // Search in both subdirectories
        for subdir in ["user", "imported"] {
            let dir = self.base_dir.join(subdir);
            debug!("find_skill_file_path: searching in {:?}", dir);
            if let Some(path) = self.search_skill_in_dir(&dir, skill_id) {
                debug!("find_skill_file_path: FOUND at {:?}", path);
                return Some(path);
            }
        }
        debug!("find_skill_file_path: NOT FOUND for skill_id={}", skill_id);
        None
    }

    /// Search for a skill file in a specific directory
    fn search_skill_in_dir(&self, dir: &Path, skill_id: &str) -> Option<PathBuf> {
        if !dir.exists() || !dir.is_dir() {
            debug!("search_skill_in_dir: directory does not exist: {:?}", dir);
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
                                        let id = fm.id.clone().unwrap_or_else(|| {
                                            format!(
                                                "ext_{}",
                                                fm.name.to_lowercase().replace(" ", "_")
                                            )
                                        });
                                        debug!(
                                            "search_skill_in_dir: folder {:?} has id={}",
                                            md_file, id
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
                if entry_path.is_file() && entry_path.extension().is_some_and(|ext| ext == "md") {
                    // Read the file and parse frontmatter to get the actual name
                    if let Ok(content) = fs::read_to_string(&entry_path) {
                        if let Some(frontmatter_str) = Self::extract_frontmatter(&content) {
                            if let Ok(fm) =
                                serde_yaml::from_str::<SkillFrontmatter>(frontmatter_str)
                            {
                                let id = fm.id.clone().unwrap_or_else(|| {
                                    format!("ext_{}", fm.name.to_lowercase().replace(" ", "_"))
                                });
                                debug!(
                                    "search_skill_in_dir: file {:?} has name='{}' -> id={}",
                                    entry_path, fm.name, id
                                );
                                if id == skill_id {
                                    return Some(entry_path);
                                }
                            }
                        } else {
                            // Fallback: use filename as id (for files without frontmatter)
                            if let Some(name) = entry_path.file_stem() {
                                let id = format!(
                                    "ext_{}",
                                    name.to_string_lossy().to_lowercase().replace(" ", "_")
                                );
                                debug!("search_skill_in_dir: file {:?} (no frontmatter) filename -> id={}", entry_path, id);
                                if id == skill_id {
                                    return Some(entry_path);
                                }
                            }
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

    /// Get all skills from all sources (user, imported)
    /// Skills are ordered according to the saved order file
    pub fn get_all_skills(&self) -> Vec<Skill> {
        let mut skills = Vec::new();

        // Load from ~/.votype/skills/user/
        skills.extend(self.load_from_subdir("user", SkillSource::User));

        // Load from ~/.votype/skills/imported/
        skills.extend(self.load_from_subdir("imported", SkillSource::Imported));

        // Apply saved ordering
        self.apply_ordering(&mut skills);

        skills
    }

    /// Load the skill ordering from the order file
    fn get_order_file_path(&self) -> PathBuf {
        self.base_dir
            .parent()
            .unwrap_or(&self.base_dir)
            .join("skills_order.json")
    }

    /// Load saved skill order
    pub fn load_order(&self) -> Vec<String> {
        let order_file = self.get_order_file_path();
        if let Ok(content) = fs::read_to_string(&order_file) {
            if let Ok(order) = serde_json::from_str::<Vec<String>>(&content) {
                return order;
            }
        }
        Vec::new()
    }

    /// Save skill order
    pub fn save_order(&self, order: &[String]) -> Result<(), String> {
        let order_file = self.get_order_file_path();
        let content = serde_json::to_string_pretty(order)
            .map_err(|e| format!("Failed to serialize order: {}", e))?;
        fs::write(&order_file, content)
            .map_err(|e| format!("Failed to write order file: {}", e))?;
        debug!("Saved skill order to {:?}", order_file);
        Ok(())
    }

    /// Apply saved ordering to skills list
    fn apply_ordering(&self, skills: &mut [Skill]) {
        let order = self.load_order();
        if order.is_empty() {
            return;
        }

        // Create a map of skill_id -> position in the saved order
        let order_map: std::collections::HashMap<&str, usize> = order
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();

        // Sort skills: those in order come first (by position), others come after
        skills.sort_by(|a, b| {
            let pos_a = order_map.get(a.id.as_str());
            let pos_b = order_map.get(b.id.as_str());
            match (pos_a, pos_b) {
                (Some(pa), Some(pb)) => pa.cmp(pb),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.name.cmp(&b.name), // Alphabetical for unordered
            }
        });
    }

    /// Delete a skill file by its ID
    pub fn delete_skill_file(&self, skill_id: &str) -> Result<(), String> {
        if let Some(file_path) = self.find_skill_file_path(skill_id) {
            fs::remove_file(&file_path)
                .map_err(|e| format!("Failed to delete skill file: {}", e))?;
            debug!("Deleted skill file: {:?}", file_path);
            Ok(())
        } else {
            Err(format!("Skill file not found for id: {}", skill_id))
        }
    }

    /// Create a new skill file in user directory
    pub fn create_skill_file(&self, skill: &Skill) -> Result<Skill, String> {
        let user_dir = self.base_dir.join("user");

        // Generate safe filename from name
        let safe_name = skill
            .name
            .chars()
            .filter(|c| {
                c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_' || *c > '\u{4E00}'
            })
            .collect::<String>()
            .trim()
            .replace(' ', "_");

        // Find a unique filename by adding suffix if needed
        let (filename, final_name) = if safe_name.is_empty() {
            let ts = chrono::Utc::now().timestamp();
            (format!("skill_{}.md", ts), format!("skill_{}", ts))
        } else {
            // Check if file exists, if so add numeric suffix
            let base_filename = format!("{}.md", safe_name);
            let base_path = user_dir.join(&base_filename);

            if !base_path.exists() {
                (base_filename, safe_name.clone())
            } else {
                // Find next available suffix
                let mut suffix = 2;
                loop {
                    let new_name = format!("{}_{}", safe_name, suffix);
                    let new_filename = format!("{}.md", new_name);
                    let new_path = user_dir.join(&new_filename);
                    if !new_path.exists() {
                        break (new_filename, new_name);
                    }
                    suffix += 1;
                    if suffix > 100 {
                        return Err("Too many skills with similar names".to_string());
                    }
                }
            }
        };

        let file_path = user_dir.join(&filename);

        // Create skill with file_path and User source
        let mut new_skill = skill.clone();
        new_skill.file_path = Some(file_path.clone());
        new_skill.source = SkillSource::User;
        new_skill.id = format!("ext_{}", final_name.to_lowercase());
        // Update name if suffix was added
        if final_name != safe_name {
            new_skill.name = final_name.replace('_', " ");
        }

        self.save_skill_to_file(&new_skill)?;

        Ok(new_skill)
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
                    && entry_path.extension().is_some_and(|ext| ext == "md")
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
                prompt: instructions.to_string(),
                model_id: None,
                icon: None,
                skill_type: SkillType::Text,
                source,
                confidence_check_enabled: false,
                confidence_threshold: Some(70),
                output_mode: SkillOutputMode::Chat, // Default to Chat for external skills
                enabled: true,
                customized: false,
                locked: false,
                file_path: Some(file_path.to_path_buf()),
            });
        }

        let fm: SkillFrontmatter = match serde_yaml::from_str(frontmatter_str) {
            Ok(f) => f,
            Err(e) => {
                error!("Failed to parse frontmatter in {:?}: {}", file_path, e);
                return None;
            }
        };

        let id = fm
            .id
            .clone()
            .unwrap_or_else(|| format!("ext_{}", fm.name.to_lowercase().replace(" ", "_")));

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
            prompt: instructions.to_string(),
            model_id: fm.model_id,
            icon: fm.icon,
            skill_type: fm.skill_type,
            source,
            confidence_check_enabled: fm.confidence_check_enabled,
            confidence_threshold: fm.confidence_threshold.or(Some(70)),
            output_mode,
            enabled: true,
            customized: false,
            locked: fm.locked,
            file_path: Some(file_path.to_path_buf()),
        })
    }
    /// Save a skill to its file (or create new file)
    pub fn save_skill_to_file(&self, skill: &Skill) -> Result<(), String> {
        let file_path = if let Some(path) = &skill.file_path {
            path.clone()
        } else {
            // New skill, default to user directory
            // Sanitize filename
            let safe_name = skill
                .name
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
                .collect::<String>()
                .trim()
                .replace(" ", "_")
                .to_lowercase();
            let filename = format!("{}.md", safe_name);
            self.base_dir.join("user").join(filename)
        };

        // Construct frontmatter
        let mut frontmatter = String::from("---\n");
        frontmatter.push_str(&format!("name: \"{}\"\n", skill.name));
        if !skill.description.is_empty() {
            frontmatter.push_str(&format!("description: \"{}\"\n", skill.description));
        }
        // Save output_mode enum as lowercase string
        let mode_str = serde_json::to_string(&skill.output_mode)
            .map(|s| s.trim_matches('"').to_string())
            .unwrap_or_else(|_| "chat".to_string());
        frontmatter.push_str(&format!("output_mode: {}\n", mode_str));

        if let Some(model_id) = &skill.model_id {
            frontmatter.push_str(&format!("model_id: \"{}\"\n", model_id));
        }
        if let Some(icon) = &skill.icon {
            frontmatter.push_str(&format!("icon: \"{}\"\n", icon));
        }

        // Save skill_type
        let type_str = serde_json::to_string(&skill.skill_type)
            .map(|s| s.trim_matches('"').to_string())
            .unwrap_or_else(|_| "text".to_string());
        frontmatter.push_str(&format!("skill_type: {}\n", type_str));

        if skill.locked {
            frontmatter.push_str("locked: true\n");
        }

        if skill.confidence_check_enabled {
            frontmatter.push_str("confidence_check_enabled: true\n");
        }
        if let Some(threshold) = skill.confidence_threshold {
            frontmatter.push_str(&format!("confidence_threshold: {}\n", threshold));
        }

        frontmatter.push_str("---\n\n");

        let content = format!("{}{}", frontmatter, skill.instructions);

        // Ensure parent directory exists
        if let Some(parent) = file_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }

        fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
        debug!("Saved skill to {:?}", file_path);

        Ok(())
    }

    /// Create a new skill from a template
    pub fn create_skill_from_template(&self, template_id: &str) -> Result<Skill, String> {
        let templates = get_builtin_templates();
        let template = templates
            .iter()
            .find(|t| t.id == template_id)
            .ok_or_else(|| format!("Template not found: {}", template_id))?;

        let skill = Skill {
            id: String::new(), // Will be set by create_skill_file
            name: template.name.clone(),
            description: template.description.clone(),
            instructions: template.instructions.clone(),
            prompt: template.instructions.clone(),
            model_id: None,
            icon: template.icon.clone(),
            skill_type: SkillType::Text,
            source: SkillSource::User,
            confidence_check_enabled: false,
            confidence_threshold: Some(70),
            output_mode: template.output_mode,
            enabled: true,
            customized: false,
            locked: false,
            file_path: None,
        };

        self.create_skill_file(&skill)
    }
}

/// Parse a builtin skill from its raw content (as loaded by `include_str!`).
///
/// Returns `None` if the content cannot be parsed.
/// The resulting `Skill` has `source = SkillSource::Builtin` and no `file_path`.
pub fn parse_builtin_skill_content(content: &str) -> Option<Skill> {
    let (frontmatter_str, instructions) = if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() == 3 {
            (parts[1], parts[2].trim())
        } else {
            return None;
        }
    } else {
        return None;
    };

    let fm: SkillFrontmatter = match serde_yaml::from_str(frontmatter_str) {
        Ok(f) => f,
        Err(e) => {
            error!("Failed to parse builtin skill frontmatter: {}", e);
            return None;
        }
    };

    let id = fm
        .id
        .clone()
        .unwrap_or_else(|| format!("ext_{}", fm.name.to_lowercase().replace(" ", "_")));

    Some(Skill {
        id,
        name: fm.name,
        description: fm.description.unwrap_or_default(),
        instructions: instructions.to_string(),
        prompt: instructions.to_string(),
        model_id: fm.model_id,
        icon: fm.icon,
        skill_type: fm.skill_type,
        source: SkillSource::Builtin,
        confidence_check_enabled: fm.confidence_check_enabled,
        confidence_threshold: fm.confidence_threshold.or(Some(70)),
        output_mode: fm.output_mode,
        enabled: true,
        customized: false,
        locked: fm.locked,
        file_path: None,
    })
}

/// Get all available builtin templates for creating new skills
pub fn get_builtin_templates() -> Vec<SkillTemplate> {
    vec![
        SkillTemplate {
            id: "template_polish".to_string(),
            name: "默认润色".to_string(),
            description: "润色和优化文本表达".to_string(),
            instructions: r#"# ASR 文本清理与质量评估专家

你是一位专注于语音识别（ASR）后处理的自然语言处理专家。

## 任务
1. 清理转录文本中的填充词（如"嗯"、"啊"）
2. 修正拼写和标点错误
3. 保持原文语义和风格

## 输出
直接输出润色后的文本，不要任何解释。"#
                .to_string(),
            icon: Some("IconWand".to_string()),
            output_mode: SkillOutputMode::Polish,
        },
        SkillTemplate {
            id: "template_translate".to_string(),
            name: "翻译".to_string(),
            description: "将文本翻译成目标语言".to_string(),
            instructions: r#"# 智能翻译专家

你是一位专业翻译，擅长多语言互译。

## 任务
1. 分析用户指令确定目标语言（如未指定，中文译英文、英文译中文）
2. 执行高质量翻译

## 翻译原则
- 保持原文的语气、风格和专业术语
- 代码、变量名、专有名词保持原样
- 使用自然流畅的目标语言表达

## 输出
仅输出翻译结果，不要任何解释或额外内容。"#
                .to_string(),
            icon: Some("IconLanguage".to_string()),
            output_mode: SkillOutputMode::Chat,
        },
        SkillTemplate {
            id: "template_summary".to_string(),
            name: "总结".to_string(),
            description: "总结和提炼文本要点".to_string(),
            instructions: r#"# 文本总结专家

你是一位精通信息提炼的总结专家。

## 任务
对提供的文本进行精炼总结，提取核心要点。

## 总结原则
- 保留关键信息，去除冗余内容
- 使用简洁、逻辑清晰的语言
- 按重要性排序列出要点

## 输出格式
**核心要点：**
- [要点1]
- [要点2]

**简述：**
[1-2句话概括全文主旨]"#
                .to_string(),
            icon: Some("IconListDetails".to_string()),
            output_mode: SkillOutputMode::Chat,
        },
        SkillTemplate {
            id: "template_chat".to_string(),
            name: "AI 问答".to_string(),
            description: "智能问答和通用对话".to_string(),
            instructions: r#"# 智能助手

你是一位乐于助人的AI助手。

## 任务
根据用户的问题或请求，提供准确、有帮助的回答。

## 原则
- 回答准确、简洁
- 如不确定，诚实说明
- 提供实用的建议和解决方案

## 输出
直接回答用户的问题。"#
                .to_string(),
            icon: Some("IconMessageSparkle".to_string()),
            output_mode: SkillOutputMode::Chat,
        },
        SkillTemplate {
            id: "template_blank".to_string(),
            name: "空白技能".to_string(),
            description: "创建一个空白技能".to_string(),
            instructions: "# 新技能\n\n在这里编写你的技能指令...".to_string(),
            icon: Some("IconSparkles".to_string()),
            output_mode: SkillOutputMode::Chat,
        },
    ]
}
