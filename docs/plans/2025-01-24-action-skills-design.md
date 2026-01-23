# Action Skills 设计文档

> 扩展 Skill 系统，让技能不仅能处理文本，还能执行系统动作（截图、运行脚本、记笔记等）。

## 背景与目标

### 当前能力边界

- **输入**：语音转录文本 + 可选的选中文本
- **处理**：通过 LLM 进行文本变换（润色、翻译、总结等）
- **输出**：处理后的文本 → 粘贴到光标位置或显示在对话框中

### 目标扩展

1. **截图屏幕** - 说一句话触发截屏
2. **记录到笔记** - 把语音内容保存到外部笔记应用
3. **总结当日工作** - 汇总历史记录生成报告
4. **执行脚本** - 调用自定义脚本完成复杂任务

## 设计决策

| 决策点     | 选择              | 说明                                  |
| ---------- | ----------------- | ------------------------------------- |
| 触发方式   | 混合模式          | 语音意图识别 + 显式技能选择           |
| 反馈机制   | Skill 自定义      | 每个 skill 决定自己的反馈方式         |
| 执行能力   | 内置 + 脚本       | 提供常用内置动作，支持脚本扩展        |
| Agent 集成 | 渐进式            | 简单动作内置执行，复杂任务可转发 MCP  |
| Skill 结构 | 声明式 + 自由式   | 简单动作声明式，复杂场景 LLM 自由输出 |
| 安全机制   | 首次确认 + 白名单 | 两层保护                              |

## 类型定义扩展

### SkillType

```rust
pub enum SkillType {
    Text,    // 现有：文本处理（润色、翻译、总结）
    Action,  // 新增：系统动作（截图、执行脚本等）
}
```

### SkillOutputMode

```rust
pub enum SkillOutputMode {
    Polish,  // 现有：差异对比视图
    Chat,    // 现有：Markdown 对话视图
    Silent,  // 现有：无 UI 输出
    Toast,   // 新增：系统通知反馈
    Panel,   // 新增：结果面板（显示截图预览、执行日志等）
}
```

### ActionConfig

```rust
pub struct ActionConfig {
    pub action_type: ActionType,  // builtin | script | mcp
    pub name: Option<String>,     // 内置动作名称（builtin 类型必填）
    pub params: serde_json::Value, // 默认参数
}

pub enum ActionType {
    Builtin,  // 内置动作
    Script,   // Shell 脚本
    Mcp,      // MCP 转发（未来）
}
```

### Skill Frontmatter 扩展

```yaml
---
name: "截图"
description: "截取屏幕并保存"
skill_type: action
output_mode: toast

action:
  type: builtin # builtin | script | mcp
  name: screenshot # 内置动作名称
  params: # 默认参数（可被 LLM 输出覆盖）
    region: fullscreen # fullscreen | window | selection
    format: png
    save_to: ~/Desktop
---
```

## 内置动作

### 动作接口

```rust
pub struct ActionResult {
    pub success: bool,
    pub message: Option<String>,       // 给用户的反馈文本
    pub data: Option<serde_json::Value>, // 结构化数据（如截图路径）
    pub error: Option<String>,
}

pub trait BuiltinAction: Send + Sync {
    fn name(&self) -> &str;
    fn execute(&self, params: serde_json::Value) -> ActionResult;
}
```

### 第一版内置动作

| 动作     | 名称          | 参数                         | 说明               |
| -------- | ------------- | ---------------------------- | ------------------ |
| 执行脚本 | `script`      | `{command, shell, timeout}`  | 运行 shell 命令    |
| 系统通知 | `notify`      | `{title, body, sound}`       | macOS 通知         |
| 剪贴板   | `clipboard`   | `{text}`                     | 复制到剪贴板       |
| 截图     | `screenshot`  | `{region, format, save_to}`  | 屏幕截图           |
| 打开     | `open`        | `{target}`                   | 打开 URL/文件/应用 |
| 追加文件 | `append_file` | `{path, content, separator}` | 追加内容到文件     |

### 动作注册

```rust
pub struct ActionRegistry {
    actions: HashMap<String, Box<dyn BuiltinAction>>,
}

impl ActionRegistry {
    pub fn new() -> Self {
        let mut registry = Self { actions: HashMap::new() };
        registry.register(Box::new(ScriptAction));
        registry.register(Box::new(NotifyAction));
        registry.register(Box::new(ClipboardAction));
        registry.register(Box::new(ScreenshotAction));
        registry.register(Box::new(OpenAction));
        registry.register(Box::new(AppendFileAction));
        registry
    }

    pub fn execute(&self, name: &str, params: serde_json::Value) -> ActionResult {
        match self.actions.get(name) {
            Some(action) => action.execute(params),
            None => ActionResult {
                success: false,
                error: Some(format!("Unknown action: {}", name)),
                ..Default::default()
            }
        }
    }
}
```

## 执行流程

```
用户语音 → 转录文本
    ↓
意图识别（现有 skill routing）
    ↓
匹配到 Action Skill？
    ├─ 否 → 走现有 Text Skill 流程
    └─ 是 ↓
         ↓
    LLM 提取参数（根据 skill instructions）
         ↓
    返回 JSON: {action: "screenshot", params: {...}}
         ↓
    安全检查
    ├─ script 类型 → 检查白名单/首次确认
    └─ 其他类型 → 直接执行
         ↓
    ActionRegistry.execute(action, params)
         ↓
    根据 output_mode 显示结果
    ├─ toast  → 系统通知
    ├─ panel  → 结果面板弹窗
    └─ silent → 无反馈
```

### LLM 输出格式

Action Skill 的 instructions 需要告诉 LLM 返回特定格式：

```json
{
  "action": "screenshot",
  "params": {
    "region": "fullscreen",
    "format": "png"
  },
  "feedback": "截图已保存到桌面"
}
```

### 参数合并逻辑

```rust
// frontmatter 中的默认参数
let default_params = skill.action.params;
// LLM 返回的参数（可能部分）
let llm_params = parse_llm_output(response);
// 合并：LLM 参数覆盖默认参数
let final_params = merge(default_params, llm_params);
```

## 安全机制

### 白名单配置

存储位置：`~/.votype/action_whitelist.json`

```json
{
  "trusted_skills": ["ext_screenshot", "ext_daily_summary"],
  "allowed_commands": [
    "/usr/bin/say",
    "/usr/local/bin/screencapture",
    "~/scripts/*.sh"
  ],
  "blocked_patterns": ["rm -rf", "sudo", "> /dev/*"]
}
```

### 首次确认流程

```
执行 script 动作
    ↓
检查 skill_id 是否在 trusted_skills？
    ├─ 是 → 检查命令是否匹配 allowed_commands
    │       ├─ 是 → 直接执行
    │       └─ 否 → 弹窗确认
    └─ 否 → 弹窗确认
              ↓
         用户选择：
         ├─ "允许一次" → 执行，不记住
         ├─ "始终信任此技能" → 添加到 trusted_skills，执行
         └─ "拒绝" → 取消执行
```

### 危险命令拦截

即使在白名单中，以下模式始终需要确认：

- `rm -rf`、`rm -r` 删除操作
- `sudo` 提权操作
- `> /dev/` 设备写入
- `chmod 777` 权限修改

## 示例 Skills

### 截图技能

````markdown
---
name: "截图"
description: "截取屏幕截图"
skill_type: action
output_mode: toast
icon: IconCamera

action:
  type: builtin
  name: screenshot
  params:
    region: fullscreen
    format: png
    save_to: ~/Desktop
---

# 截图助手

分析用户的语音指令，提取截图参数。

## 意图识别

- "截个图" / "截屏" → 全屏截图
- "截这个窗口" → 当前窗口
- "截一部分" / "框选截图" → 用户选择区域

## 输出格式

返回 JSON：

```json
{
  "action": "screenshot",
  "params": {
    "region": "fullscreen | window | selection"
  },
  "feedback": "截图已保存到桌面"
}
```
````

````

### 快速笔记

```markdown
---
name: "记笔记"
description: "将语音内容追加到笔记文件"
skill_type: action
output_mode: toast
icon: IconNote

action:
  type: builtin
  name: append_file
  params:
    path: ~/Notes/voice-notes.md
    separator: "\n\n---\n\n"
---

# 语音笔记

将用户说的内容记录到笔记文件。

## 处理逻辑
1. 提取用户想记录的内容
2. 添加时间戳
3. 追加到笔记文件

## 输出格式
```json
{
  "action": "append_file",
  "params": {
    "content": "## ${time}\n\n${用户内容}"
  },
  "feedback": "已记录到笔记"
}
````

````

### 自定义脚本

```markdown
---
name: "每日总结"
description: "总结今天的工作记录"
skill_type: action
output_mode: panel
icon: IconReport

action:
  type: script
  params:
    command: ~/scripts/daily-summary.sh
    shell: bash
---

# 每日工作总结

调用脚本生成今日工作总结，脚本会：
1. 读取今日的转录历史
2. 用 AI 生成摘要
3. 返回 Markdown 格式的总结

## 输出
脚本的 stdout 会显示在结果面板中。
````

## 实现计划

### Phase 1：基础架构

1. **扩展类型定义** - `settings.rs`
   - 扩展 `SkillType` 添加 `Action`
   - 扩展 `SkillOutputMode` 添加 `Toast`、`Panel`
   - 新增 `ActionConfig` 结构体

2. **创建 Action 模块** - `src-tauri/src/actions/builtin/`
   - `mod.rs` - ActionRegistry 和 ActionResult
   - 6 个内置动作实现

3. **Skill 解析扩展** - `skill.rs`
   - 解析 frontmatter 中的 `action` 配置块

### Phase 2：执行流程

4. **Action 执行器** - `action_executor.rs`
   - LLM 输出解析（提取 action JSON）
   - 参数合并逻辑
   - 调用 ActionRegistry 执行

5. **集成到 post_process** - `post_process.rs`
   - 识别到 Action Skill 后走新流程
   - 根据 output_mode 处理结果

### Phase 3：安全与 UI

6. **安全机制** - `action_security.rs`
   - 白名单管理
   - 首次确认逻辑

7. **前端 UI**
   - Toast 通知组件
   - 结果面板组件
   - 脚本确认弹窗

### Phase 4：示例与文档

8. **内置示例 Skills**
   - 截图、快速笔记、打开链接

9. **用户文档**
   - Action Skill 编写指南

## 未来扩展

- **MCP 集成**：复杂任务转发给外部 Agent
- **读取文件**：作为 skill 输入源
- **HTTP 请求**：调用外部 API
- **语音播报**：TTS 反馈结果
- **链式动作**：多个动作组合执行
