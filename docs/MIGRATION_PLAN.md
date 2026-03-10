# 提示词系统迁移方案

## 决策：全面采用 Skill 系统

**废弃**: 现有简单提示词系统 (`resources/prompts/`)
**采用**: GHOSTYPE Skill 系统（精简版）

## 为什么一步到位？

1. **避免技术债** - 两套系统维护成本高
2. **功能完整** - Skill 系统能力远超现有系统
3. **未来友好** - 易于扩展和用户自定义
4. **学习成本低** - 只需要学一套规则

## 核心格式

```yaml
---
id: "skill_id"                    # 唯一标识
name: "技能名称"                   # 显示名称
description: "简短描述"            # 一句话说明
context_requires:                 # 依赖的上下文
  - user_language
  - current_app
  - app_category
---

用户语言: {{context.user_language}}
当前应用: {{context.current_app}}

{{#eq context.app_category "CodeEditor"}}
## 代码编辑器规则
...
{{/eq}}

# Role
你是 [角色定义]

# Constraints
1. 直接输出结果，不要解释
2. 不要客套话
...

# Examples
...
```

## 迁移映射

### 现有提示词 → 新 Skill

| 现有文件                      | 新 Skill                 | 说明     |
| ----------------------------- | ------------------------ | -------- |
| `system_text_optimization.md` | `smart_compose.skill.md` | 智能续写 |
| `system_skill_generation.md`  | `code_generate.skill.md` | 代码生成 |
| （新增）                      | `translation.skill.md`   | 翻译     |
| （新增）                      | `grammar_fix.skill.md`   | 语法修正 |
| （新增）                      | `summarize.skill.md`     | 总结     |
| （新增）                      | `memo.skill.md`          | 笔记整理 |

## 实施步骤

### Phase 1: 基础架构（3-4天）

#### Day 1-2: Skill 核心

**创建文件**:

```
src-tauri/src/skills/
├── mod.rs           # Skill 定义
├── manager.rs       # SkillManager
├── executor.rs      # SkillExecutor
└── context.rs       # SkillContext
```

**关键代码**:

```rust
// src-tauri/src/skills/mod.rs
use handlebars::Handlebars;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    id: String,
    name: String,
    description: String,
    context_requires: Vec<String>,
}

pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub context_requires: Vec<String>,
    pub template: String,
}

impl Skill {
    pub fn from_file(path: &Path) -> Result<Self> {
        let content = fs::read_to_string(path)?;

        // 分离 frontmatter 和 template
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() < 3 {
            return Err(anyhow!("Invalid skill format"));
        }

        let frontmatter: SkillFrontmatter =
            serde_yaml::from_str(parts[1])?;
        let template = parts[2].trim().to_string();

        Ok(Self {
            id: frontmatter.id,
            name: frontmatter.name,
            description: frontmatter.description,
            context_requires: frontmatter.context_requires,
            template,
        })
    }

    pub fn render(&self, context: &SkillContext) -> Result<String> {
        let mut hbs = Handlebars::new();
        hbs.register_template_string("skill", &self.template)?;

        let data = serde_json::json!({
            "context": context
        });

        Ok(hbs.render("skill", &data)?)
    }
}
```

#### Day 3-4: SkillManager

```rust
// src-tauri/src/skills/manager.rs
use std::collections::HashMap;
use std::path::PathBuf;

pub struct SkillManager {
    skills: HashMap<String, Skill>,
}

impl SkillManager {
    pub fn new() -> Result<Self> {
        let mut manager = Self {
            skills: HashMap::new(),
        };

        // 加载内置 Skill
        manager.load_builtin_skills()?;

        // 加载用户自定义 Skill（可覆盖）
        manager.load_user_skills()?;

        Ok(manager)
    }

    fn load_builtin_skills(&mut self) -> Result<()> {
        let builtin_dir = get_builtin_skills_dir();
        self.load_from_dir(&builtin_dir)
    }

    fn load_from_dir(&mut self, dir: &Path) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension() == Some(OsStr::new("md")) {
                if let Ok(skill) = Skill::from_file(&path) {
                    self.skills.insert(skill.id.clone(), skill);
                }
            }
        }
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    pub fn list(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }
}

fn get_builtin_skills_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();

    #[cfg(debug_assertions)]
    let base = exe_dir.join("../../resources/skills/builtin");

    #[cfg(not(debug_assertions))]
    let base = exe_dir.join("../Resources/skills/builtin");

    base
}
```

### Phase 2: 上下文系统（2-3天）

#### Day 5-6: 扩展 AudioContext

```rust
// src-tauri/src/context/mod.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioContext {
    pub timestamp: i64,
    pub user_language: String,
    pub focused_app: Option<AppInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub bundle_id: String,
    pub name: String,
    pub app_category: AppCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AppCategory {
    CodeEditor,
    Browser,
    InstantMessaging,
    Email,
    Notes,
    Terminal,
    Other,
}

impl AppCategory {
    pub fn from_bundle_id(bundle_id: &str) -> Self {
        match bundle_id {
            id if id.contains("vscode") || id.contains("cursor")
                || id.contains("xcode") => Self::CodeEditor,
            id if id.contains("wechat") || id.contains("telegram")
                || id.contains("slack") => Self::InstantMessaging,
            id if id.contains("mail") || id.contains("outlook")
                => Self::Email,
            id if id.contains("safari") || id.contains("chrome")
                => Self::Browser,
            id if id.contains("terminal") || id.contains("iterm")
                => Self::Terminal,
            id if id.contains("notes") || id.contains("notion")
                => Self::Notes,
            _ => Self::Other,
        }
    }
}
```

#### Day 7: SkillContext

```rust
// src-tauri/src/skills/context.rs

#[derive(Debug, Clone, Serialize)]
pub struct SkillContext {
    pub user_language: String,
    pub current_app: String,
    pub app_category: String,
}

impl SkillContext {
    pub fn from_audio_context(audio: &AudioContext) -> Self {
        let (current_app, app_category) = match &audio.focused_app {
            Some(app) => (
                app.name.clone(),
                format!("{:?}", app.app_category),
            ),
            None => (
                "Unknown".to_string(),
                "Other".to_string(),
            ),
        };

        Self {
            user_language: audio.user_language.clone(),
            current_app,
            app_category,
        }
    }
}
```

### Phase 3: 集成到管道（2-3天）

#### Day 8-9: SkillExecutor

```rust
// src-tauri/src/skills/executor.rs

pub struct SkillExecutor {
    manager: Arc<SkillManager>,
    llm_client: Arc<LlmClient>,
}

impl SkillExecutor {
    pub async fn execute(
        &self,
        skill_id: &str,
        user_input: &str,
        audio_context: &AudioContext,
    ) -> Result<String> {
        // 1. 获取 Skill
        let skill = self.manager.get(skill_id)
            .ok_or_else(|| anyhow!("Skill not found: {}", skill_id))?;

        // 2. 构建上下文
        let skill_context = SkillContext::from_audio_context(audio_context);

        // 3. 渲染提示词
        let system_prompt = skill.render(&skill_context)?;

        // 4. 调用 LLM
        let messages = vec![
            Message {
                role: Role::System,
                content: system_prompt,
            },
            Message {
                role: Role::User,
                content: user_input.to_string(),
            },
        ];

        let response = self.llm_client.chat(messages).await?;
        Ok(response)
    }

    pub fn auto_select_skill(
        &self,
        audio_context: &AudioContext,
    ) -> &str {
        match &audio_context.focused_app {
            Some(app) => match app.app_category {
                AppCategory::CodeEditor => "code_generate",
                AppCategory::Email => "reply_suggestion",
                AppCategory::Notes => "memo",
                AppCategory::InstantMessaging => "smart_compose",
                _ => "smart_compose",
            },
            None => "smart_compose",
        }
    }
}
```

#### Day 10: 集成到后处理管道

```rust
// src-tauri/src/actions/post_process/skill_router.rs

pub async fn route_and_execute(
    transcript: &str,
    audio_context: &AudioContext,
    skill_manager: &SkillManager,
    llm_client: &LlmClient,
) -> Result<String> {
    let executor = SkillExecutor::new(
        Arc::new(skill_manager.clone()),
        Arc::new(llm_client.clone()),
    );

    // 检测显式命令
    if let Some(skill_id) = detect_skill_command(transcript) {
        return executor.execute(&skill_id, transcript, audio_context).await;
    }

    // 自动选择
    let skill_id = executor.auto_select_skill(audio_context);
    executor.execute(skill_id, transcript, audio_context).await
}

fn detect_skill_command(text: &str) -> Option<String> {
    let commands = vec![
        ("翻译", "translation"),
        ("总结", "summarize"),
        ("代码", "code_generate"),
        ("修正", "grammar_fix"),
        ("笔记", "memo"),
    ];

    for (keyword, skill_id) in commands {
        if text.starts_with(&format!("{}：", keyword))
            || text.starts_with(&format!("{}:", keyword)) {
            return Some(skill_id.to_string());
        }
    }
    None
}
```

### Phase 4: 创建 Skill（2-3天）

#### 迁移现有提示词

已创建:

- ✅ `smart_compose.skill.md`
- ✅ `translation.skill.md`
- ✅ `grammar_fix.skill.md`

需要创建:

- [ ] `code_generate.skill.md` - 从 `system_skill_generation.md` 迁移
- [ ] `summarize.skill.md`
- [ ] `code_explain.skill.md`
- [ ] `memo.skill.md`
- [ ] `reply_suggestion.skill.md`

### Phase 5: 删除旧系统（1天）

```bash
# 删除旧提示词目录
rm -rf src-tauri/resources/prompts/

# 删除旧的 PromptManager（如果有）
# 检查 src-tauri/src/ 中的相关代码并删除
```

## 依赖更新

```toml
# Cargo.toml
[dependencies]
# 新增
handlebars = "5.1"
serde_yaml = "0.9"

# 已有
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
anyhow = "1.0"
```

## 测试策略

### 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_loading() {
        let skill = Skill::from_file(
            Path::new("resources/skills/builtin/smart_compose.skill.md")
        ).unwrap();

        assert_eq!(skill.id, "smart_compose");
        assert_eq!(skill.name, "智能续写");
    }

    #[test]
    fn test_skill_rendering() {
        let skill = Skill::from_file(
            Path::new("resources/skills/builtin/smart_compose.skill.md")
        ).unwrap();

        let context = SkillContext {
            user_language: "zh-CN".into(),
            current_app: "VS Code".into(),
            app_category: "CodeEditor".into(),
        };

        let rendered = skill.render(&context).unwrap();
        assert!(rendered.contains("VS Code"));
        assert!(rendered.contains("CodeEditor"));
    }

    #[test]
    fn test_auto_skill_selection() {
        let audio_context = AudioContext {
            focused_app: Some(AppInfo {
                bundle_id: "com.microsoft.vscode".into(),
                name: "VS Code".into(),
                app_category: AppCategory::CodeEditor,
            }),
            ..Default::default()
        };

        let executor = SkillExecutor::new(...);
        let skill_id = executor.auto_select_skill(&audio_context);

        assert_eq!(skill_id, "code_generate");
    }
}
```

### 集成测试

1. 在不同应用中测试自动 Skill 选择
2. 测试显式命令检测
3. 测试提示词渲染（包含条件逻辑）
4. 测试完整的执行流程

## 验收标准

### 功能验收

- [ ] SkillManager 能正确加载所有 Skill
- [ ] Skill 提示词能正确渲染（变量替换、条件判断）
- [ ] 在代码编辑器中自动使用 code_generate
- [ ] 在聊天应用中自动使用 smart_compose
- [ ] 显式命令能正确识别（"翻译：XXX"）
- [ ] 所有 8 个 Skill 都能正常工作

### 性能验收

- [ ] Skill 加载时间 < 100ms
- [ ] 提示词渲染时间 < 10ms
- [ ] 总体响应时间无明显增加

### 代码质量

- [ ] 单元测试覆盖率 > 80%
- [ ] 所有测试通过
- [ ] 无编译警告
- [ ] 代码符合 Rust 规范

## 时间表

| Phase    | 任务                      | 天数      |
| -------- | ------------------------- | --------- |
| 1        | Skill 核心 + SkillManager | 4         |
| 2        | 上下文系统                | 3         |
| 3        | SkillExecutor + 集成      | 3         |
| 4        | 创建所有 Skill            | 3         |
| 5        | 删除旧系统 + 测试         | 2         |
| **总计** |                           | **15 天** |

## 风险与缓解

### 风险 1: Handlebars 学习曲线

**缓解**: Handlebars 语法简单，主要用 `{{}}`, `{{#if}}`, `{{#eq}}`

### 风险 2: 迁移可能影响现有功能

**缓解**:

1. 保持现有功能不变
2. 充分测试
3. 逐步替换

### 风险 3: 性能影响

**缓解**:

1. Handlebars 渲染很快
2. 可以加缓存

## 成功标准

迁移成功后:

✅ 只有一套系统（Skill 系统）
✅ 8+ 个高质量 Skill
✅ 自动场景适配
✅ 用户可自定义扩展
✅ 性能无退化
✅ 代码更清晰易维护

---

**下一步**: 开始 Phase 1 - 创建 Skill 核心架构
