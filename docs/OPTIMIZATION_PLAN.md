# Votype 综合优化方案

> 基于对 Typeless 和 GHOSTYPE 的深度分析，制定的系统化优化计划

## 📋 目录

- [执行摘要](#执行摘要)
- [竞品分析总结](#竞品分析总结)
- [Votype 现状评估](#votype-现状评估)
- [优化策略](#优化策略)
- [技术方案设计](#技术方案设计)
- [实施路线图](#实施路线图)
- [成功指标](#成功指标)

---

## 执行摘要

### 核心目标

将 Votype 从"语音转文字工具"升级为"上下文感知的智能输入助手"

### 三大突破方向

1. **Skill 系统** - 从单一模式到可扩展技能库
2. **上下文感知** - 从静态提示词到动态场景适配
3. **用户体验** - 从功能堆砌到场景化交互

### 核心优势定位

| 维度         | Typeless    | GHOSTYPE    | **Votype**        |
| ------------ | ----------- | ----------- | ----------------- |
| 隐私性       | ❌ 云端     | ⚠️ 云端     | ✅ **完全本地**   |
| 可定制性     | ⚠️ 有限     | ✅ 开放     | ✅✅ **超级开放** |
| 提示词透明度 | ❌ 不可见   | ✅ 可见     | ✅✅ **完全可控** |
| 性能         | ⚠️ 网络延迟 | ⚠️ 网络延迟 | ✅✅ **本地推理** |
| 人格化       | ⚠️ 基础     | ✅✅ 深度   | 🎯 **平衡**       |

**差异化定位**: "最隐私、最可控、最灵活的本地语音输入助手"

---

## 竞品分析总结

### Typeless 的可借鉴点

#### ✅ 优点

1. **丰富的上下文采集**
   - 应用信息（bundle_id, name）
   - 窗口信息（title, web_url, web_domain）
   - 文本插入点（full_field_content, selected_text）

2. **个性化设置**
   - personal_auto_style_on（自动风格调整）
   - personal_auto_dictionary_on（自动词典学习）

3. **多模式支持**
   - VOICE_TRANSCRIPT（转写）
   - VOICE_COMMAND（命令）
   - VOICE_TRANSLATION（翻译）

#### ❌ 缺点

- 提示词封闭，不可见
- 依赖云端，隐私风险
- 不支持本地模型

### GHOSTYPE 的可借鉴点

#### ✅ 优点

1. **Skill 系统架构**

   ```yaml
   name: "技能名称"
   description: "描述"
   allowed_tools: [provide_text]
   context_requires: [user_language, current_app]
   ```

2. **零废话输出哲学**
   - 直接给结果，不解释
   - 不要客套话
   - 不重复问题

3. **上下文变量系统**

   ```markdown
   用户语言: {{context.user_language}}
   当前应用: {{context.current_app}}
   ```

4. **形/神/法三位一体**（精妙但复杂）
   - 形：语言 DNA
   - 神：人格面具
   - 法：交互逻辑

#### ⚠️ 需简化的部分

- 完整人格建模系统过于复杂
- 校准问答系统交互成本高

---

## Votype 现状评估

### 已有优势 ✅

1. **本地化架构**
   - Tauri 框架，原生性能
   - 完全本地运行，无隐私风险
   - 支持多种本地模型

2. **提示词外部化**

   ```
   src-tauri/resources/prompts/
   ├── system_skill_generation.md
   ├── system_text_optimization.md
   └── ...
   ```

   - 支持模板变量 `${variable_name}`
   - PromptManager 支持用户覆盖
   - 运行时动态加载

3. **后处理管道**

   ```rust
   post_process/
   ├── core.rs           // 核心逻辑
   ├── pipeline.rs       // 处理流水线
   ├── routing.rs        // 路由分发
   ├── extensions.rs     // 扩展
   └── prompt_builder.rs // 提示词构建
   ```

4. **上下文采集基础**
   - AudioContext 结构已存在
   - 可获取应用信息（通过 accessibility API）

### 当前不足 ⚠️

1. **单一提示词模式**
   - 所有场景使用同一套提示词
   - 无法针对不同应用/场景优化

2. **上下文利用不足**
   - 已有 AudioContext，但未充分利用
   - 缺少当前应用、窗口标题、光标上下文

3. **用户交互单调**
   - 只有"按住说话"一种交互
   - 无快速切换场景的能力

4. **提示词可发现性差**
   - 用户不知道有哪些提示词
   - 不知道如何自定义

---

## 优化策略

### 战略目标

**Phase 1: 基础增强** (2-3周)

- 建立 Skill 系统基础架构
- 增强上下文感知能力
- 优化核心提示词

**Phase 2: 体验升级** (2-3周)

- 实现快速切换 Skill
- 优化 UI/UX
- 添加 Skill 管理界面

**Phase 3: 生态建设** (长期)

- 支持用户创建 Skill
- Skill 分享社区
- 高级个性化功能

### 设计原则

1. **渐进增强** - 不破坏现有功能
2. **简单优先** - 从最简单的方案开始
3. **用户可选** - 高级功能不强制使用
4. **保持轻量** - 不过度设计

---

## 技术方案设计

### 方案一：Skill 系统架构

#### 1.1 Skill 定义格式

```yaml
# src-tauri/resources/skills/smart_compose.skill.md
---
id: "smart_compose"
name: "智能续写"
description: "根据上下文智能续写文本"
icon: "✍️"
category: "写作"
context_requires:
  - cursor_context
  - current_app
hotkey: "fn+space"  # 可选快捷键
model_preference: "fast"  # fast/balanced/quality
enabled: true
---

当前应用: {{context.current_app}}

{{#if context.cursor_context}}
光标位置上下文:
{{context.cursor_context}}
{{/if}}

# Role
你是一个智能续写助手，根据上下文预测用户想输入的内容。

# Constraints
1. 直接输出续写内容，不要解释
2. 保持与上下文一致的语气和风格
3. 如果在代码编辑器中，生成代码；如果在聊天中，生成自然语言
4. 续写长度适中（20-100字）

# Examples

## 代码场景
Input: "// 计算两个数的"
Output: "和\nfunction add(a, b) {\n    return a + b;\n}"

## 聊天场景
Input: "今天天气不错，我们"
Output: "一起出去走走吧"
```

#### 1.2 Skill 数据结构

```rust
// src-tauri/src/skills/mod.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    pub context_requires: Vec<String>,
    pub hotkey: Option<String>,
    pub model_preference: ModelPreference,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelPreference {
    Fast,      // 快速模型（小模型）
    Balanced,  // 平衡（中等模型）
    Quality,   // 高质量（大模型）
}

#[derive(Debug, Clone)]
pub struct Skill {
    pub metadata: SkillMetadata,
    pub prompt_template: String,
}

impl Skill {
    /// 从 Markdown 文件加载
    pub fn from_file(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        Self::from_str(&content)
    }

    /// 从字符串解析
    pub fn from_str(content: &str) -> Result<Self> {
        // 解析 YAML frontmatter
        let (metadata_str, prompt_template) = Self::split_frontmatter(content)?;
        let metadata: SkillMetadata = serde_yaml::from_str(&metadata_str)?;

        Ok(Self {
            metadata,
            prompt_template: prompt_template.to_string(),
        })
    }

    /// 渲染提示词（注入上下文变量）
    pub fn render(&self, context: &SkillContext) -> Result<String> {
        let mut handlebars = Handlebars::new();
        handlebars.register_template_string("skill", &self.prompt_template)?;

        let data = serde_json::json!({
            "context": context,
        });

        Ok(handlebars.render("skill", &data)?)
    }
}
```

#### 1.3 Skill 管理器

```rust
// src-tauri/src/skills/manager.rs

pub struct SkillManager {
    skills: HashMap<String, Skill>,
    builtin_dir: PathBuf,
    user_dir: PathBuf,
}

impl SkillManager {
    pub fn new() -> Result<Self> {
        let builtin_dir = get_builtin_skills_dir();
        let user_dir = get_user_skills_dir();

        let mut manager = Self {
            skills: HashMap::new(),
            builtin_dir,
            user_dir,
        };

        manager.load_all()?;
        Ok(manager)
    }

    /// 加载所有 Skill
    fn load_all(&mut self) -> Result<()> {
        // 1. 加载内置 Skill
        self.load_from_dir(&self.builtin_dir)?;

        // 2. 加载用户自定义 Skill（可覆盖内置）
        self.load_from_dir(&self.user_dir)?;

        Ok(())
    }

    /// 获取所有已启用的 Skill
    pub fn get_enabled_skills(&self) -> Vec<&Skill> {
        self.skills
            .values()
            .filter(|s| s.metadata.enabled)
            .collect()
    }

    /// 根据 ID 获取 Skill
    pub fn get_skill(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    /// 根据快捷键查找 Skill
    pub fn find_by_hotkey(&self, hotkey: &str) -> Option<&Skill> {
        self.skills
            .values()
            .find(|s| s.metadata.hotkey.as_deref() == Some(hotkey))
    }
}
```

#### 1.4 内置 Skill 清单

创建以下内置 Skill:

```
src-tauri/resources/skills/
├── builtin/
│   ├── smart_compose.skill.md      # 智能续写
│   ├── grammar_fix.skill.md        # 语法修正
│   ├── translation.skill.md        # 翻译
│   ├── summarize.skill.md          # 总结
│   ├── code_explain.skill.md       # 代码解释
│   ├── code_generate.skill.md      # 代码生成
│   ├── memo.skill.md               # 笔记整理
│   └── reply_suggestion.skill.md   # 回复建议
└── user/
    └── (用户自定义 Skill)
```

---

### 方案二：上下文感知增强

#### 2.1 扩展 AudioContext

```rust
// src-tauri/src/context/mod.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioContext {
    // === 基础信息 ===
    pub timestamp: i64,
    pub duration: f32,

    // === 用户信息 ===
    pub user_language: String,

    // === 应用上下文 ===
    pub focused_app: Option<AppInfo>,

    // === 文本上下文 ===
    pub text_context: Option<TextContext>,

    // === 选择上下文 ===
    pub selected_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub bundle_id: String,
    pub name: String,
    pub window_title: Option<String>,
    pub url: Option<String>,           // 如果是浏览器
    pub app_category: AppCategory,     // 应用类型
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AppCategory {
    CodeEditor,       // VS Code, Xcode, Cursor
    Browser,          // Safari, Chrome, Arc
    InstantMessaging, // 微信, Telegram, Slack
    Email,            // Mail, Outlook
    Notes,            // 备忘录, Notion, Obsidian
    Terminal,         // Terminal, iTerm
    Office,           // Word, Excel, Pages
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextContext {
    pub before_cursor: String,  // 光标前 200 字符
    pub after_cursor: String,   // 光标后 100 字符
    pub full_field: Option<String>, // 完整输入框内容（如果可获取）
}

impl AppCategory {
    /// 根据 bundle_id 推断应用类型
    pub fn from_bundle_id(bundle_id: &str) -> Self {
        match bundle_id {
            id if id.contains("vscode") || id.contains("xcode")
                || id.contains("cursor") => Self::CodeEditor,
            id if id.contains("safari") || id.contains("chrome")
                || id.contains("firefox") => Self::Browser,
            id if id.contains("wechat") || id.contains("telegram")
                || id.contains("slack") => Self::InstantMessaging,
            id if id.contains("mail") || id.contains("outlook") => Self::Email,
            id if id.contains("notes") || id.contains("notion")
                || id.contains("obsidian") => Self::Notes,
            id if id.contains("terminal") || id.contains("iterm") => Self::Terminal,
            _ => Self::Other,
        }
    }
}
```

#### 2.2 上下文采集器

```rust
// src-tauri/src/context/collector.rs

pub struct ContextCollector {
    accessibility_client: AccessibilityClient,
}

impl ContextCollector {
    pub async fn collect(&self) -> Result<AudioContext> {
        let focused_app = self.get_focused_app().await?;
        let text_context = self.get_text_context().await.ok();
        let selected_text = self.get_selected_text().await.ok();

        Ok(AudioContext {
            timestamp: chrono::Utc::now().timestamp(),
            duration: 0.0,
            user_language: self.get_user_language(),
            focused_app,
            text_context,
            selected_text,
        })
    }

    async fn get_focused_app(&self) -> Result<Option<AppInfo>> {
        // 使用 macOS Accessibility API
        let app = self.accessibility_client.get_focused_application()?;

        Ok(Some(AppInfo {
            bundle_id: app.bundle_id.clone(),
            name: app.name.clone(),
            window_title: app.window_title,
            url: self.extract_url_if_browser(&app),
            app_category: AppCategory::from_bundle_id(&app.bundle_id),
        }))
    }

    async fn get_text_context(&self) -> Result<TextContext> {
        let element = self.accessibility_client.get_focused_element()?;

        if !element.is_text_field() {
            return Err(anyhow!("Not a text field"));
        }

        let full_text = element.get_value()?;
        let cursor_pos = element.get_selected_range()?.location;

        let before_cursor = full_text
            .chars()
            .take(cursor_pos)
            .rev()
            .take(200)
            .collect::<String>()
            .chars()
            .rev()
            .collect();

        let after_cursor = full_text
            .chars()
            .skip(cursor_pos)
            .take(100)
            .collect();

        Ok(TextContext {
            before_cursor,
            after_cursor,
            full_field: Some(full_text),
        })
    }
}
```

#### 2.3 Skill 上下文注入

```rust
// src-tauri/src/skills/context.rs

#[derive(Debug, Clone, Serialize)]
pub struct SkillContext {
    // 基础上下文
    pub user_language: String,
    pub current_app: String,
    pub app_category: String,

    // 文本上下文（可选）
    pub cursor_context: Option<String>,
    pub selected_text: Option<String>,
    pub full_field: Option<String>,

    // 窗口上下文（可选）
    pub window_title: Option<String>,
    pub url: Option<String>,
}

impl SkillContext {
    /// 从 AudioContext 构建
    pub fn from_audio_context(audio_ctx: &AudioContext) -> Self {
        let current_app = audio_ctx.focused_app
            .as_ref()
            .map(|a| a.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());

        let app_category = audio_ctx.focused_app
            .as_ref()
            .map(|a| format!("{:?}", a.app_category))
            .unwrap_or_else(|| "Other".to_string());

        // 构建光标上下文描述
        let cursor_context = audio_ctx.text_context.as_ref().map(|tc| {
            format!(
                "光标前: {}\n光标后: {}",
                tc.before_cursor,
                tc.after_cursor
            )
        });

        Self {
            user_language: audio_ctx.user_language.clone(),
            current_app,
            app_category,
            cursor_context,
            selected_text: audio_ctx.selected_text.clone(),
            full_field: audio_ctx.text_context.as_ref()
                .and_then(|tc| tc.full_field.clone()),
            window_title: audio_ctx.focused_app.as_ref()
                .and_then(|a| a.window_title.clone()),
            url: audio_ctx.focused_app.as_ref()
                .and_then(|a| a.url.clone()),
        }
    }
}
```

---

### 方案三：Skill 执行引擎

#### 3.1 执行流程

```rust
// src-tauri/src/skills/executor.rs

pub struct SkillExecutor {
    skill_manager: Arc<SkillManager>,
    context_collector: Arc<ContextCollector>,
    llm_client: Arc<LlmClient>,
}

impl SkillExecutor {
    /// 执行指定的 Skill
    pub async fn execute(
        &self,
        skill_id: &str,
        user_input: &str,
    ) -> Result<String> {
        // 1. 获取 Skill
        let skill = self.skill_manager
            .get_skill(skill_id)
            .ok_or_else(|| anyhow!("Skill not found: {}", skill_id))?;

        // 2. 收集上下文
        let audio_context = self.context_collector.collect().await?;
        let skill_context = SkillContext::from_audio_context(&audio_context);

        // 3. 验证所需上下文
        self.validate_context(skill, &skill_context)?;

        // 4. 渲染提示词
        let system_prompt = skill.render(&skill_context)?;

        // 5. 构建消息
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

        // 6. 调用 LLM
        let response = self.llm_client
            .chat(messages, &skill.metadata.model_preference)
            .await?;

        Ok(response)
    }

    /// 自动选择 Skill
    pub async fn auto_select_skill(
        &self,
        audio_context: &AudioContext,
    ) -> Option<String> {
        // 根据应用类型自动选择
        match &audio_context.focused_app {
            Some(app) => match app.app_category {
                AppCategory::CodeEditor => Some("code_generate".to_string()),
                AppCategory::InstantMessaging => Some("smart_compose".to_string()),
                AppCategory::Email => Some("reply_suggestion".to_string()),
                AppCategory::Notes => Some("memo".to_string()),
                _ => None,
            },
            None => None,
        }
    }
}
```

#### 3.2 集成到后处理管道

```rust
// src-tauri/src/actions/post_process/routing.rs

pub async fn route_to_skill(
    transcript: &str,
    audio_context: &AudioContext,
    skill_manager: &SkillManager,
    skill_executor: &SkillExecutor,
) -> Result<String> {
    // 1. 检测用户是否显式指定了 Skill
    if let Some(skill_id) = detect_skill_command(transcript) {
        return skill_executor.execute(&skill_id, transcript).await;
    }

    // 2. 自动选择 Skill
    if let Some(skill_id) = skill_executor.auto_select_skill(audio_context).await {
        return skill_executor.execute(&skill_id, transcript).await;
    }

    // 3. 回退到默认处理
    skill_executor.execute("smart_compose", transcript).await
}

/// 检测用户是否在转写文本中指定了 Skill
fn detect_skill_command(text: &str) -> Option<String> {
    // 支持格式:
    // "翻译：你好世界" -> translation
    // "总结：..." -> summarize
    // "代码：..." -> code_generate

    let commands = vec![
        ("翻译", "translation"),
        ("总结", "summarize"),
        ("代码", "code_generate"),
        ("修正", "grammar_fix"),
        ("笔记", "memo"),
    ];

    for (keyword, skill_id) in commands {
        if text.starts_with(keyword) {
            return Some(skill_id.to_string());
        }
    }

    None
}
```

---

### 方案四：用户界面优化

#### 4.1 Skill 选择界面

在系统托盘菜单中添加:

```
📝 Votype
├── 🎤 开始录音 (Fn)
├── ⚡ 快速技能
│   ├── ✍️ 智能续写 (默认)
│   ├── 🌐 翻译
│   ├── 📋 总结
│   ├── 💻 代码生成
│   └── 📝 笔记整理
├── ⚙️ 技能管理...
├── 📊 历史记录
└── ⚙️ 设置
```

#### 4.2 Skill 管理窗口

创建一个专门的 Skill 管理界面:

```tsx
// src/components/SkillManager.tsx

interface SkillManagerProps {
  skills: Skill[];
  onToggle: (skillId: string, enabled: boolean) => void;
  onEdit: (skillId: string) => void;
  onCreate: () => void;
}

export function SkillManager({
  skills,
  onToggle,
  onEdit,
  onCreate,
}: SkillManagerProps) {
  return (
    <div className="skill-manager">
      <div className="header">
        <h2>技能管理</h2>
        <Button onClick={onCreate}>
          <PlusIcon /> 创建新技能
        </Button>
      </div>

      <div className="skill-grid">
        {skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onToggle={() => onToggle(skill.id, !skill.enabled)}
            onEdit={() => onEdit(skill.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SkillCard({ skill, onToggle, onEdit }: SkillCardProps) {
  return (
    <Card className="skill-card">
      <div className="skill-icon">{skill.icon}</div>
      <div className="skill-info">
        <h3>{skill.name}</h3>
        <p className="description">{skill.description}</p>
        <div className="meta">
          <Badge>{skill.category}</Badge>
          {skill.hotkey && (
            <Badge variant="outline">
              <KeyboardIcon /> {skill.hotkey}
            </Badge>
          )}
        </div>
      </div>
      <div className="actions">
        <Switch checked={skill.enabled} onCheckedChange={onToggle} />
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <EditIcon />
        </Button>
      </div>
    </Card>
  );
}
```

#### 4.3 实时 Skill 指示器

在录音时显示当前使用的 Skill:

```tsx
// src/components/RecordingOverlay.tsx

export function RecordingOverlay({ isRecording, currentSkill }: Props) {
  if (!isRecording) return null;

  return (
    <div className="recording-overlay">
      <div className="recording-indicator">
        <div className="pulse" />
        <MicrophoneIcon />
      </div>

      {currentSkill && (
        <div className="current-skill">
          <span className="skill-icon">{currentSkill.icon}</span>
          <span className="skill-name">{currentSkill.name}</span>
        </div>
      )}

      <div className="transcript-preview">{/* 实时转写预览 */}</div>
    </div>
  );
}
```

#### 4.4 Skill 切换快捷键

支持录音时快速切换 Skill:

```
录音中按:
- 1: 智能续写
- 2: 翻译
- 3: 总结
- 4: 代码生成
- 5: 笔记整理
```

---

### 方案五：提示词优化

#### 5.1 应用零废话哲学

更新所有提示词，添加统一约束:

```markdown
# Constraints（通用约束，所有 Skill 必须包含）

1. 直接输出结果，不要解释过程
2. 不要输出"好的"、"没问题"、"让我来帮你"等客套话
3. 不要重复或改写用户的输入
4. 不要使用 markdown 代码块标记（除非用户明确要求）
5. 保持简洁，避免啰嗦
```

#### 5.2 创建上下文感知的提示词模板

**示例 1: 智能续写**

```markdown
---
id: "smart_compose"
name: "智能续写"
description: "根据上下文智能续写文本"
---

用户当前在 {{context.current_app}} 中输入文本。

{{#if context.cursor_context}}

## 当前输入上下文

{{context.cursor_context}}
{{/if}}

{{#if context.app_category}}

## 应用类型

当前应用类型: {{context.app_category}}

{{#eq context.app_category "CodeEditor"}}
注意：用户正在编写代码，请生成代码而不是自然语言。
{{/eq}}

{{#eq context.app_category "InstantMessaging"}}
注意：用户正在聊天，使用口语化、简短的表达。
{{/eq}}

{{#eq context.app_category "Email"}}
注意：用户正在写邮件，使用正式、礼貌的语气。
{{/eq}}
{{/if}}

# Role

你是一个智能续写助手。根据用户的语音输入和上下文，预测并生成用户想要输入的内容。

# Constraints

1. 直接输出续写内容，不要任何前缀或解释
2. 不要输出客套话
3. 续写长度适中（20-100字或等价代码行数）
4. 根据应用类型调整输出风格
5. 如果上下文明确是代码，直接输出代码，不要用代码块包裹

# Examples

## Example 1: 代码续写

Context: VSCode，光标前内容 "// 计算斐波那契数列的"
Input: "第n项"
Output:
function fibonacci(n) {
if (n <= 1) return n;
return fibonacci(n - 1) + fibonacci(n - 2);
}

## Example 2: 聊天续写

Context: 微信，光标前内容 "今天天气真好，我们"
Input: "出去玩"
Output: 一起出去走走吧，好久没呼吸新鲜空气了

## Example 3: 邮件续写

Context: Mail，光标前内容 "尊敬的李总，关于上次讨论的方案"
Input: "我已经"
Output: 我已经完成了详细的方案规划，附件中是完整的文档。期待您的反馈。
```

**示例 2: 语法修正**

```markdown
---
id: "grammar_fix"
name: "语法修正"
description: "修正语法错误，优化表达"
---

用户当前在 {{context.current_app}} 中。

# Role

你是一个语法修正助手。你的任务是修正用户语音输入中的语法错误、口语化表达，并优化文本使其更流畅。

# Constraints

1. 只输出修正后的文本，不要解释修改了什么
2. 保持原意，不要添加用户没说的内容
3. 去除语气词（"嗯"、"啊"、"那个"等）
4. 修正明显的语法错误
5. 如果输入是代码注释，保持代码注释的简洁风格

{{#eq context.app_category "CodeEditor"}}

## 代码场景特殊规则

- 如果是代码注释，保持简洁，使用中文或英文标准注释格式
- 如果是变量命名，使用驼峰或下划线命名
  {{/eq}}

# Examples

## Example 1: 日常文本

Input: "这个那个方案嗯我觉得不太行啊需要重新那个想一下"
Output: 这个方案我觉得不太行，需要重新想一下

## Example 2: 正式邮件

Input: "老板那个我想请个假明天那个有点事"
Output: 您好，我想请假一天，明天有些个人事务需要处理

## Example 3: 代码注释

Input: "这个函数是用来那个计算嗯用户的那个总分"
Output: // 计算用户总分
```

**示例 3: 翻译**

```markdown
---
id: "translation"
name: "翻译"
description: "智能翻译，自动检测源语言"
---

用户语言: {{context.user_language}}

# Role

你是一个专业翻译。自动检测源语言并翻译为目标语言。

# Target Language Detection

{{#eq context.user_language "zh-CN"}}

- 如果输入是中文 → 翻译为英文
- 如果输入是英文 → 翻译为中文
- 如果输入是其他语言 → 翻译为中文
  {{/eq}}

{{#eq context.user_language "en-US"}}

- 翻译为英文
  {{/eq}}

# Constraints

1. 只输出翻译结果，不要解释
2. 保持原文的语气和风格
3. 专有名词保留原文或使用通用译法
4. 不要添加引号或任何标记

{{#eq context.app_category "CodeEditor"}}

## 代码场景

如果输入包含代码，保持代码部分不变，只翻译注释和字符串。
{{/eq}}

# Examples

## Example 1

Input: "今天天气真不错"
Output: The weather is really nice today.

## Example 2

Input: "How are you doing?"
Output: 你好吗？

## Example 3 (代码)

Input: "把这个函数改成返回布尔值"
Output: Change this function to return a boolean value
```

---

### 方案六：配置系统设计

#### 6.1 Skill 配置文件

```toml
# ~/.votype/config/skills.toml

[skills]
default_skill = "smart_compose"  # 默认 Skill
auto_select = true               # 自动根据应用选择
show_skill_indicator = true      # 显示当前 Skill 指示器

[[skills.mappings]]
app_category = "CodeEditor"
skill_id = "code_generate"

[[skills.mappings]]
app_category = "InstantMessaging"
skill_id = "smart_compose"

[[skills.mappings]]
app_category = "Email"
skill_id = "reply_suggestion"

[skills.hotkeys]
# Skill 切换快捷键
"fn+1" = "smart_compose"
"fn+2" = "translation"
"fn+3" = "summarize"
"fn+4" = "code_generate"
"fn+5" = "memo"
```

#### 6.2 用户覆盖机制

```
~/.votype/
├── config/
│   └── skills.toml          # 用户配置
└── skills/
    └── my_custom.skill.md   # 用户自定义 Skill
```

用户可以:

1. 创建自己的 Skill
2. 覆盖内置 Skill
3. 配置 Skill 映射规则

---

## 实施路线图

### Phase 1: 基础架构 (Week 1-2)

#### Week 1: Skill 系统核心

**目标**: 建立 Skill 系统的基础架构

**任务清单**:

- [ ] 设计并实现 Skill 数据结构 (`Skill`, `SkillMetadata`)
- [ ] 实现 Skill 文件解析器（YAML frontmatter + Markdown）
- [ ] 实现 SkillManager（加载、管理、查询）
- [ ] 实现模板引擎集成（Handlebars.rs）
- [ ] 创建 3 个基础内置 Skill:
  - `smart_compose.skill.md`
  - `translation.skill.md`
  - `grammar_fix.skill.md`

**验收标准**:

```bash
# 能够成功加载和解析 Skill
cargo test test_skill_loading

# 能够渲染带变量的提示词
cargo test test_skill_rendering
```

#### Week 2: 上下文采集

**目标**: 增强上下文感知能力

**任务清单**:

- [ ] 扩展 `AudioContext` 结构
- [ ] 实现 `ContextCollector`
  - [ ] 获取当前应用信息（bundle_id, name）
  - [ ] 获取窗口标题
  - [ ] 实现应用类型推断（`AppCategory`）
- [ ] 实现 `SkillContext` 转换
- [ ] 集成到现有录音流程

**验收标准**:

```rust
// 能够在不同应用中正确采集上下文
assert_eq!(context.focused_app.name, "Visual Studio Code");
assert_eq!(context.focused_app.app_category, AppCategory::CodeEditor);
```

---

### Phase 2: Skill 执行引擎 (Week 3-4)

#### Week 3: 执行器实现

**目标**: 实现 Skill 执行流程

**任务清单**:

- [ ] 实现 `SkillExecutor`
- [ ] 实现 Skill 自动选择逻辑
- [ ] 实现 Skill 命令检测（"翻译：..."）
- [ ] 集成到后处理管道
- [ ] 添加模型偏好支持（fast/balanced/quality）

**验收标准**:

```rust
// 能够根据应用自动选择 Skill
let skill_id = executor.auto_select_skill(&context).await;
assert_eq!(skill_id, Some("code_generate"));

// 能够执行 Skill 并获得结果
let result = executor.execute("translation", "Hello").await;
assert!(result.contains("你好"));
```

#### Week 4: 更多 Skill

**目标**: 创建完整的内置 Skill 库

**任务清单**:

- [ ] `summarize.skill.md` - 总结长文本
- [ ] `code_generate.skill.md` - 代码生成
- [ ] `code_explain.skill.md` - 代码解释
- [ ] `memo.skill.md` - 笔记整理
- [ ] `reply_suggestion.skill.md` - 回复建议
- [ ] 为每个 Skill 编写测试用例

**验收标准**:

- 8 个完整的 Skill
- 每个 Skill 有至少 3 个示例
- 通过实际使用测试

---

### Phase 3: 用户界面 (Week 5-6)

#### Week 5: 基础 UI

**目标**: 实现 Skill 管理基础界面

**任务清单**:

- [ ] 实现 Skill 列表界面
- [ ] 实现 Skill 卡片组件
- [ ] 实现 Skill 启用/禁用开关
- [ ] 在系统托盘添加 Skill 快速切换菜单
- [ ] 实现录音时的 Skill 指示器

**验收标准**:

- 用户能看到所有可用 Skill
- 用户能启用/禁用 Skill
- 录音时能看到当前使用的 Skill

#### Week 6: 高级 UI

**目标**: 完善用户体验

**任务清单**:

- [ ] 实现 Skill 编辑器
- [ ] 实现 Skill 创建向导
- [ ] 添加 Skill 搜索/过滤
- [ ] 实现 Skill 导入/导出
- [ ] 添加 Skill 使用统计

**验收标准**:

- 用户能创建自定义 Skill
- 用户能编辑现有 Skill
- 用户能导入/导出 Skill

---

### Phase 4: 优化与完善 (Week 7-8)

#### Week 7: 性能优化

**任务清单**:

- [ ] Skill 缓存机制
- [ ] 上下文采集性能优化
- [ ] 提示词渲染缓存
- [ ] 异步加载优化
- [ ] 内存占用优化

#### Week 8: 文档与发布

**任务清单**:

- [ ] 编写 Skill 开发文档
- [ ] 编写用户使用指南
- [ ] 创建 Skill 示例仓库
- [ ] 录制演示视频
- [ ] 准备 Release Notes

---

### Phase 5: 生态建设 (长期)

#### 社区功能

**任务**:

- [ ] Skill 分享社区
- [ ] Skill 评分和评论
- [ ] Skill 推荐算法
- [ ] 官方 Skill 商店

#### 高级功能

**任务**:

- [ ] 简化版人格化（可选）
  - 用户风格学习
  - 常用词汇提取
  - 语气偏好记忆
- [ ] Skill 链式调用
  - 先总结，再翻译
  - 先生成，再优化
- [ ] 多模态支持
  - 图片输入
  - 音频输出

---

## 成功指标

### 技术指标

| 指标         | 当前 | 目标    |
| ------------ | ---- | ------- |
| Skill 数量   | 0    | 8+ 内置 |
| 上下文采集率 | ~30% | >80%    |
| 平均响应时间 | ~2s  | <1.5s   |
| 提示词相关性 | 中   | 高      |

### 用户体验指标

| 指标                | 目标          |
| ------------------- | ------------- |
| Skill 切换成功率    | >95%          |
| 上下文识别准确率    | >90%          |
| 用户满意度          | >4.5/5        |
| 用户自定义 Skill 数 | >20% 用户创建 |

### 业务指标

| 指标             | 目标 |
| ---------------- | ---- |
| 日活跃用户 (DAU) | +50% |
| 用户留存率       | +30% |
| 平均使用时长     | +40% |

---

## 风险与挑战

### 技术风险

**风险 1: 上下文采集权限**

- **描述**: macOS Accessibility API 可能受限
- **缓解**: 提供降级方案，优雅处理权限缺失

**风险 2: 性能影响**

- **描述**: 上下文采集可能影响响应速度
- **缓解**: 异步采集，智能缓存

**风险 3: 提示词质量**

- **描述**: 动态生成的提示词可能质量不稳定
- **缓解**: 充分测试，提供模板验证工具

### 用户体验风险

**风险 1: 功能复杂度**

- **描述**: Skill 系统可能让新用户困惑
- **缓解**: 提供良好的默认配置，渐进式引导

**风险 2: 学习成本**

- **描述**: 用户需要学习如何创建 Skill
- **缓解**: 提供向导、模板和详细文档

---

## 资源需求

### 开发资源

- **核心开发**: 1 人 × 8 周
- **UI/UX 设计**: 可选，自行设计
- **测试**: 自己 + 早期用户

### 技术依赖

```toml
# 新增依赖
handlebars = "4.5"         # 模板引擎
serde_yaml = "0.9"         # YAML 解析
accessibility = "0.1"      # macOS Accessibility
accessibility-sys = "0.1"  # 系统接口
```

---

## 附录

### A. Skill 模板示例

完整的 Skill 模板:

```markdown
---
id: "your_skill_id"
name: "技能名称"
description: "简短描述，显示在 UI 中"
icon: "📝"
category: "分类"
context_requires:
  - user_language
  - current_app
hotkey: "fn+X"
model_preference: "balanced"
enabled: true
---

用户语言: {{context.user_language}}
当前应用: {{context.current_app}}

{{#if context.cursor_context}}

## 上下文

{{context.cursor_context}}
{{/if}}

# Role

[定义 AI 的角色]

# Constraints

1. 直接输出结果，不要解释
2. 不要客套话
3. [其他约束...]

# Examples

## Example 1

Input: "..."
Output: "..."
```

### B. 应用类型映射表

| Bundle ID 关键词        | 应用类型         | 建议 Skill       |
| ----------------------- | ---------------- | ---------------- |
| vscode, cursor, xcode   | CodeEditor       | code_generate    |
| safari, chrome, arc     | Browser          | smart_compose    |
| wechat, telegram, slack | InstantMessaging | smart_compose    |
| mail, outlook           | Email            | reply_suggestion |
| notes, notion, obsidian | Notes            | memo             |
| terminal, iterm         | Terminal         | code_generate    |

### C. 参考资源

- [Handlebars.rs 文档](https://docs.rs/handlebars)
- [macOS Accessibility API](https://developer.apple.com/documentation/accessibility)
- [GHOSTYPE Skill 设计](./GHOSTYPE_ANALYSIS.md)
- [Typeless 上下文采集](./TYPELESS_ANALYSIS.md)

---

## 总结

这个优化方案的核心是:

1. **建立可扩展的 Skill 系统** - 从单一模式到多技能生态
2. **增强上下文感知** - 让 AI 理解用户在做什么
3. **优化提示词质量** - 应用零废话哲学，提高输出质量
4. **改善用户体验** - 让用户能轻松管理和创建 Skill

通过这些优化，Votype 将从"语音转文字工具"进化为"智能输入助手"，同时保持本地化、隐私优先的核心优势。

**下一步**: 根据这个方案开始 Phase 1 的实施。
