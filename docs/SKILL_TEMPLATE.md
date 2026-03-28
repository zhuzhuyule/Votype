# Skill 模板与开发指南

## Skill 文件格式

每个 Skill 由两部分组成：

1. **YAML Frontmatter** - 元数据定义
2. **Markdown Body** - 提示词正文

```markdown
---
[YAML 元数据]
---

[Markdown 提示词正文]
```

## 完整模板

```markdown
---
# === 必填字段 ===
id: "your_skill_id" # 唯一标识符，使用 snake_case
name: "技能名称" # 显示名称，简短清晰
description: "简短描述" # 一句话说明作用
icon: "📝" # Emoji 图标
category: "分类" # 分类：写作/编程/语言/实用工具

# === 上下文需求 ===
context_requires: # 需要的上下文变量
  - user_language # 用户语言
  - current_app # 当前应用
  - app_category # 应用类型（可选）
  # 可选的上下文：
  # - cursor_context             # 光标上下文（需要权限）
  # - selected_text              # 选中文本（需要权限）
  # - window_title               # 窗口标题
  # - url                        # URL（如果是浏览器）

# === 可选字段 ===
hotkey: "fn+1" # 快捷键（可选）
model_preference: "balanced" # 模型偏好：fast/balanced/quality
enabled: true # 是否启用
---

# === 提示词正文 ===

## 基础上下文注入

用户语言: {{context.user_language}}
当前应用: {{context.current_app}}

{{#if context.app_category}}
应用类型: {{context.app_category}}
{{/if}}

{{#if context.cursor_context}}

## 光标上下文

{{context.cursor_context}}
{{/if}}

{{#if context.selected_text}}

## 选中文本

{{context.selected_text}}
{{/if}}

# Role

[定义 AI 的角色和任务]

# Scene-Specific Rules (可选)

{{#eq context.app_category "CodeEditor"}}

## 代码编辑器场景

- [特殊规则...]
  {{/eq}}

{{#eq context.app_category "InstantMessaging"}}

## 即时通讯场景

- [特殊规则...]
  {{/eq}}

# Constraints

1. 直接输出结果，不要解释过程
2. 不要输出"好的"、"没问题"等客套话
3. 不要重复用户的输入
4. [其他约束...]

# Examples

## Example 1: [场景描述]

**Input**: "用户输入示例"
**Output**: 期望输出示例

## Example 2: [场景描述]

**Input**: "用户输入示例"
**Output**: 期望输出示例

[至少提供 3 个示例，覆盖主要使用场景]
```

## 上下文变量说明

### 始终可用的变量

| 变量                        | 类型   | 说明         | 示例                    |
| --------------------------- | ------ | ------------ | ----------------------- |
| `{{context.user_language}}` | String | 用户语言设置 | `zh-CN`, `en-US`        |
| `{{context.current_app}}`   | String | 当前应用名称 | `Visual Studio Code`    |
| `{{context.app_category}}`  | String | 应用类型     | `CodeEditor`, `Browser` |

### 需要权限的变量

| 变量                         | 类型   | 说明         | 需要权限      |
| ---------------------------- | ------ | ------------ | ------------- |
| `{{context.cursor_context}}` | String | 光标前后文本 | Accessibility |
| `{{context.selected_text}}`  | String | 选中的文本   | Accessibility |
| `{{context.window_title}}`   | String | 窗口标题     | Accessibility |
| `{{context.url}}`            | String | 浏览器 URL   | Accessibility |

## 应用类型 (AppCategory)

| 类型               | 说明       | 典型应用                 |
| ------------------ | ---------- | ------------------------ |
| `CodeEditor`       | 代码编辑器 | VS Code, Xcode, Cursor   |
| `Browser`          | 浏览器     | Safari, Chrome, Arc      |
| `InstantMessaging` | 即时通讯   | 微信, Telegram, Slack    |
| `Email`            | 邮件客户端 | Mail, Outlook            |
| `Notes`            | 笔记应用   | 备忘录, Notion, Obsidian |
| `Terminal`         | 终端       | Terminal, iTerm          |
| `Office`           | 办公软件   | Word, Excel, Pages       |
| `Other`            | 其他       | -                        |

## Handlebars 语法

### 条件判断

```markdown
{{#if context.cursor_context}}
有光标上下文可用
{{/if}}

{{#if context.cursor_context}}
有光标上下文
{{else}}
无光标上下文
{{/if}}
```

### 相等判断

```markdown
{{#eq context.app_category "CodeEditor"}}
这是代码编辑器
{{/eq}}

{{#eq context.user_language "zh-CN"}}
中文用户
{{else}}
其他语言用户
{{/eq}}
```

### 变量输出

```markdown
当前应用: {{context.current_app}}
应用类型: {{context.app_category}}
```

## 模型偏好说明

| 偏好       | 说明                     | 适用场景                 |
| ---------- | ------------------------ | ------------------------ |
| `fast`     | 快速模型，响应快         | 翻译、语法修正、简单续写 |
| `balanced` | 平衡模型，质量与速度兼顾 | 智能续写、总结           |
| `quality`  | 高质量模型，响应较慢     | 代码生成、复杂写作       |

## 约束编写规范

### 必须包含的约束

每个 Skill 都应包含以下基础约束：

```markdown
# Constraints

1. 直接输出结果，不要解释过程
2. 不要输出"好的"、"没问题"等客套话
3. 不要重复用户的输入
```

### 场景特定约束

根据 Skill 的用途添加：

```markdown
# 代码相关 Skill

4. 如果是代码，直接输出代码，不要用代码块标记
5. 保持代码风格一致

# 翻译相关 Skill

4. 不要添加引号或任何额外格式
5. 保持原文的语气和风格

# 写作相关 Skill

4. 续写长度适中（20-100字）
5. 根据应用类型调整风格
```

## 示例编写规范

### 示例数量

- 最少 3 个示例
- 建议 5-8 个示例
- 覆盖主要使用场景

### 示例格式

```markdown
## Example 1: [清晰的场景描述]

**Input**: "用户输入"
**Output**: 期望输出

## Example 2: [另一个场景]

**Context**: [可选的上下文说明]
**Input**: "用户输入"
**Output**: 期望输出
```

### 好的示例 ✅

```markdown
## Example 1: 代码注释续写

**Context**: VSCode，光标前内容 `// 计算斐波那契数列的`
**Input**: "第n项"
**Output**:
function fibonacci(n) {
if (n <= 1) return n;
return fibonacci(n - 1) + fibonacci(n - 2);
}
```

### 坏的示例 ❌

```markdown
## Example 1

Input: 输入
Output: 输出
```

（缺少场景说明，示例过于简单）

## 常见模式

### 模式 1: 场景感知

```markdown
# Scene-Specific Rules

{{#eq context.app_category "CodeEditor"}}

## 代码编辑器场景

- 生成代码而不是文本
- 保持代码风格
  {{/eq}}

{{#eq context.app_category "Email"}}

## 邮件场景

- 使用正式语气
- 结构完整
  {{/eq}}
```

### 模式 2: 语言适配

```markdown
{{#eq context.user_language "zh-CN"}}

## 中文用户

- 中文输入 → 翻译为英文
- 英文输入 → 翻译为中文
  {{/eq}}

{{#eq context.user_language "en-US"}}

## English User

- Translate to English
  {{/eq}}
```

### 模式 3: 上下文利用

```markdown
{{#if context.cursor_context}}

## 当前输入上下文
```

{{context.cursor_context}}

```

根据以上上下文，智能续写后续内容。
{{else}}
根据语音输入直接生成内容。
{{/if}}
```

## 测试 Skill

### 手动测试清单

- [ ] YAML 解析成功
- [ ] 所有变量正确替换
- [ ] 在不同应用中测试（代码编辑器、聊天、邮件等）
- [ ] 测试有/无上下文的情况
- [ ] 输出符合约束（无客套话、无重复等）

### 测试用例示例

```rust
#[test]
fn test_smart_compose_skill() {
    let skill = Skill::from_file("smart_compose.skill.md").unwrap();

    // 测试代码场景
    let context = SkillContext {
        user_language: "zh-CN".into(),
        current_app: "Visual Studio Code".into(),
        app_category: "CodeEditor".into(),
        ..Default::default()
    };

    let rendered = skill.render(&context).unwrap();
    assert!(rendered.contains("代码编辑器场景"));
    assert!(rendered.contains("Visual Studio Code"));
}
```

## 常见问题

### Q1: 如何处理可选的上下文？

使用 `{{#if}}` 条件：

```markdown
{{#if context.selected_text}}

## 选中文本

{{context.selected_text}}

请对以上选中文本进行处理。
{{else}}
直接处理语音输入。
{{/if}}
```

### Q2: 如何避免生成重复的内容？

在约束中明确：

```markdown
# Constraints

3. 不要重复用户的输入
4. 如果用户说"翻译：XXX"，只输出翻译结果，不要包含"翻译："
```

### Q3: 如何让 AI 理解不同应用的特点？

使用场景特定规则：

```markdown
{{#eq context.app_category "InstantMessaging"}}

## 即时通讯场景

- 使用口语化表达
- 简短（20-50字）
- 可以用网络用语
  {{/eq}}
```

### Q4: 输出格式如何控制？

在约束和示例中明确：

```markdown
# Constraints

4. 如果是代码，直接输出代码，不要用 `代码块` 包裹
5. 如果是列表，使用 markdown 列表格式

# Examples

## Example: 列表输出

**Output**:

- 项目 1
- 项目 2
- 项目 3
```

## 最佳实践

### ✅ 做

1. **提供丰富的示例** - 覆盖主要场景
2. **明确约束** - 告诉 AI 不要做什么
3. **利用上下文** - 根据应用类型调整行为
4. **保持简洁** - 提示词不要过长
5. **测试充分** - 在实际场景中测试

### ❌ 不要

1. ❌ 过度复杂的逻辑 - Skill 应该专注单一任务
2. ❌ 忽略约束 - 必须包含基础约束
3. ❌ 缺少示例 - 至少 3 个示例
4. ❌ 硬编码 - 使用变量而不是写死
5. ❌ 忽略不同场景 - 考虑不同应用的差异

## 下一步

1. 参考 [builtin Skill 示例](../src-tauri/resources/skills/builtin/)
2. 使用此模板创建自己的 Skill
3. 测试并迭代优化
4. 分享到社区（未来功能）

---

**记住**: 好的 Skill = 清晰的角色 + 明确的约束 + 丰富的示例
