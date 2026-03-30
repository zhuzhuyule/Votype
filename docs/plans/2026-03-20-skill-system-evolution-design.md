# Skill 系统进化设计（v1 可执行版）

> 本文档综合了两份独立调研（Claude 侧重实用落地、OpenAI 侧重架构分层），
> 并根据审核意见（`skill-system-evolution-review.md`）修订为可直接指导实现的版本。
>
> 核心原则：**先跑通最小闭环，再逐步扩展**。

---

## 一、现状诊断

### 1.1 已有基础能力

| 能力           | 现状                                                                                             | 评估                                  |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Skill 数据模型 | `id / name / description / instructions / skill_type / output_mode / source`                     | 类型入口已预留                        |
| 文件体系       | 单文件 `.md` + 目录型 `SKILL.md` + user/imported 目录                                            | 目录型为 Skill 包提供兼容基础         |
| 运行时上下文   | `app_name / window_title / process_id / selected_text / app_category / history / hotwords`       | 大部分上下文已可获取                  |
| Prompt 组装    | PromptBuilder 结构化注入 `SELECTED_TEXT / HOTWORDS / HISTORY_HINTS / ASR_REFERENCE / INPUT_TEXT` | 可直接作为 text skill 的 runtime 基础 |
| LLM 路由       | 基于 description 的意图路由 + 置信度判定                                                         | 可用但有改进空间                      |
| 自动生成       | 3 步 pipeline（优化 instructions → name/icon → description）                                     | 只生成 prompt，不生成可执行 meta      |

### 1.2 核心断层

| 断层                                | 影响                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| 只有 Prompt 语义，没有 Runtime 语义 | 系统无法把 Skill 当作"能力单元"执行                  |
| Routing 只看描述，不看真实能力      | LLM 看不到 Skill 是否只在某类 App 有效，误路由频率高 |
| 自动生成不产出可执行 Meta           | "自动生成"本质上只是在生成一段 Prompt                |
| 100% 依赖 LLM 路由                  | 确定性场景不该依赖概率模型                           |
| Action 类型有名无实                 | `SkillType::Action` 执行路径等同 `Text`              |

---

## 二、设计目标

1. v1 生成完整 Skill 包（正文 + 基础 metadata + manifest），其中 action/reference/script 能力按需生成
2. Skill 能执行真实操作（命令、脚本、通知）
3. 确定性触发优先（关键词 + 规则预筛选 < 1ms），LLM 路由兜底
4. 上下文感知的 Reference 装配
5. 纯增量扩展，不破坏现有 Skill 的任何功能

---

## 三、核心边界定义

### 3.1 `Skill` 与 `SkillManifest` 的职责分离

这是整个方案能否稳定的前提。

**`Skill` struct（轻量，服务前端与列表展示）：**

```rust
pub struct Skill {
    // ---- 保持现有字段不变 ----
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub icon: Option<String>,
    pub skill_type: SkillType,        // 仅 Text / Action，不新增 Hybrid
    pub output_mode: SkillOutputMode,
    pub source: SkillSource,
    pub model_id: Option<String>,
    pub confidence_check_enabled: bool,
    pub confidence_threshold: Option<u8>,
    pub enabled: bool,
    pub customized: bool,
    pub locked: bool,
    // ---- v1 新增：manifest 定位（runtime-only）----
    #[serde(skip)]
    pub manifest_path: Option<PathBuf>,  // 运行时定位，不持久化、不暴露给前端
}
```

**v1 不在 `settings::Skill` 中持久化 manifest 字段。** Runtime 所需结构统一进入 `SkillManifest`。

**`SkillManifest`（独立结构，服务 Runtime）：**

```rust
pub struct SkillManifest {
    pub version: u8,                          // 始终为 1
    pub kind: SkillKind,                      // Text / Action（v1 不暴露 Hybrid）
    pub triggers: Vec<SkillTrigger>,
    pub activation: ActivationRules,
    pub context_requirements: ContextRequirements,
    pub references: Vec<ReferenceBinding>,
    pub actions: Vec<SkillAction>,            // 仅 kind=Action 时使用
    pub safety: SafetyPolicy,
    pub result_policy: ResultPolicy,
}
```

**好处：**

- 不冲击 settings / bindings / zod / UI 的连锁改动
- 旧 Skill 兼容推导更自然
- 目录型 Skill 包演进空间更大

### 3.3 关键实现边界

#### `result_policy` 是回显策略的单一真相

v1 Runtime **一律读取 `SkillManifest.result_policy`** 决定执行后的回显方式。

- 旧 Skill 在 `compile_legacy_manifest()` 时由 `Skill.output_mode` 映射到 `result_policy`：
  - `Polish` → `{ mode: "polish_review" }` — 保留现有 review/diff 确认体验，不得退化为无确认的直接 paste
  - `Chat` → `{ mode: "preview" }`
  - `Silent` → `{ mode: "silent" }`
- `result_policy.mode` 完整枚举：`polish_review`（差异确认后粘贴）/ `preview`（Markdown 预览）/ `toast`（通知）/ `silent`（无回显）/ `paste`（直接粘贴，仅限新 action Skill 显式声明）
- `Skill.output_mode` 仅作为旧 Skill 兼容输入和前端列表展示，**不再参与 Runtime 最终判断**
- 新 Skill 的回显行为完全由 `manifest.result_policy` 控制

#### `manifest_path` 是 runtime-only 字段

`manifest_path` 与现有 `file_path` 一样，仅作为运行时定位字段：

- **不进入 settings 持久化**（`#[serde(skip)]`）
- **不暴露为前端配置字段**
- 由 `SkillManager` 在加载时动态计算

### 3.2 文件格式：frontmatter 轻量 + manifest.json 完整

**单文件 frontmatter 仅用于简单 Skill：**

- 基础元信息
- 简单 trigger（关键词 + apps）
- 基础 activation（allowed_apps / allowed_app_categories）

**不建议 frontmatter 承载：**

- 多步 action 链
- 大段 script
- 大量 references
- 复杂安全策略

**目录型 Skill 包用于复杂 Skill：**

```
my_skill/
├── SKILL.md              # 面向 LLM 的任务正文
├── manifest.json         # Runtime Manifest
├── references/           # 按场景装配的参考材料
│   └── common.md
└── scripts/              # Skill 私有脚本
    └── main.sh
```

**兼容规则：**

- 旧单文件 `.skill.md` → 自动推导最小 Manifest
- 目录型有 `manifest.json` → 优先读取
- 目录型无 `manifest.json` → 从 `SKILL.md` frontmatter 推导

---

## 四、执行优先级（关键）

以下优先级是确定性规则，**不可被后续实现打乱**：

```
1. override_prompt_id                    // App profile 显式指定的 prompt
2. selected_text + confirm_skill 流程     // 现有选中文本 + 意图确认机制
3. deterministic trigger 匹配            // v1 新增：关键词 + 规则匹配
4. LLM 意图路由                           // 现有 routing（在缩小后的候选集内）
5. default polish                        // 现有默认后处理
```

**v1 约束：**

- **Trigger 不得绕过 override_prompt_id** — 如果 App profile 明确指定了 prompt，trigger 不生效
- **Trigger 不得抢占 selected_text confirm 流程** — 有选中文本时，走现有 confirm_skill 流程
- **`context.selected_text = required` 的 Skill 不参与 deterministic trigger** — 只通过现有 selected-text + LLM confirm 路径命中，避免 trigger 与 selected-text 流程产生灰区
- **Trigger 仅在 normal skill_mode / general route 下生效**
- **Action Skill 触发后如需执行高危操作，仍需用户确认**

如果未来要允许 trigger 处理 selected text 场景，需单独设计确认步骤，不在 v1 范围。

---

## 五、三层执行架构

```
用户语音输入
  ↓
上下文采集（app_name, window_title, selected_text, ...）
  ↓
优先级 1-2: 检查 override / selected_text confirm（现有逻辑，不改）
  ↓
优先级 3: SkillResolver 规则预筛选 + Trigger 关键词匹配（< 1ms）
  ├── 命中 trigger → SkillRuntime.execute(skill)
  └── 未命中 → 进入优先级 4
  ↓
优先级 4: LLM 意图路由（仅在缩小后的候选集内判定）
  ├── 高置信度 → SkillRuntime.execute(skill)
  └── 低置信度 → 优先级 5
  ↓
优先级 5: default polish（现有流程）
  ↓
SkillRuntime.execute(skill)
  ├── kind=text   → Reference 装配 → PromptBuilder → LLM → result_policy
  └── kind=action → ActionExecutor → result_policy
```

---

## 六、SkillResolver：候选预筛选 + Trigger 匹配

### 6.1 候选预筛选

在 LLM 路由之前，用确定性规则裁剪候选集：

```rust
impl SkillResolver {
    fn filter_candidates(&self, ctx: &RuntimeContext) -> Vec<&ResolvedSkill> {
        // 移除 activation.allowed_apps 不匹配的
        // 移除 activation.allowed_app_categories 不匹配的
        // 移除 context.selected_text=required 但实际无选中文本的
        // 移除 activation.shortcut_only=true 的（非快捷键触发时）
    }
}
```

**为什么必须预筛选：**

- Skill 数量增多后路由成本线性上升
- LLM 不知道某 Skill 在当前 App 不可用，会误路由
- 缩小候选集让 LLM 路由更准确

### 6.2 Trigger 匹配

```rust
pub struct SkillTrigger {
    pub keywords: Vec<String>,
    pub apps: Option<Vec<String>>,
    pub title_pattern: Option<String>,
    pub match_mode: MatchMode,  // Contains(默认) / StartsWith / Exact
}
```

**匹配策略**：默认子串匹配（`contains`），因为 ASR 输出不精确。

**冲突解决**：

1. 关键词长度最长者优先
2. 限定了 apps 的优先于未限定的
3. 仍并列时按 Skill 排序顺序

### 6.3 增强 LLM 路由

缩小后的候选集送给 LLM 路由时，routing prompt 中增加字段：

```
- kind: text / action
- requires_selected_text: true / false
- allowed_app_categories: [...]
```

不把全部 manifest 暴露给 LLM，避免 prompt 膨胀。

---

## 七、Action 执行器

### 7.1 v1 Action 类型

```rust
pub enum SkillAction {
    /// 内置动作（程序内部实现）
    Builtin {
        name: String,                 // "clipboard.write", "open", "notify"
        args: HashMap<String, String>,
    },
    /// 执行 shell 命令
    Command {
        command: String,
        working_dir: Option<String>,
        timeout_ms: Option<u64>,      // 默认 10000
        capture_as: Option<String>,
    },
    /// 执行脚本（Skill 包内部）
    Script {
        interpreter: String,          // "sh", "python3", "osascript"
        entry: String,                // "scripts/main.sh"（相对于 Skill 包）
        working_dir: Option<String>,
        timeout_ms: Option<u64>,
        capture_as: Option<String>,
    },
    /// 用户确认对话框（阻塞）
    Confirm {
        title: String,
        body: String,
    },
    /// 系统通知
    Notify {
        title: String,
        body: String,
    },
}
```

### 7.2 Future Action 类型（不在 v1）

以下类型设计上保留，但暂不实现：

- `Keystroke { keys, delay_ms }` — 模拟按键
- `Paste { text }` — 粘贴文本
- `OpenUrl { url }` — 打开 URL
- `Prompt { instructions, output_mode, capture_as }` — 作为 action 链中的 LLM 子步骤

**原因**：每增加一种 action type 都带来 UI、权限、运行时、测试维度的额外复杂度。v1 先用 Builtin/Command/Script 覆盖核心场景。

### 7.3 Action 链式执行（v1 基础版）

v1 支持 actions 数组顺序执行 + `capture_as` 单层变量传递：

```yaml
actions:
  - type: command
    command: "git diff --cached"
    capture_as: "diff_output"

  - type: confirm
    title: "确认 diff"
    body: "${diff_output}"

  - type: command
    command: "git commit -m 'auto commit'"
```

**v1 执行语义：**

- 顺序执行，失败则终止
- `confirm` 阻塞等待，取消则终止
- `capture_as` 变量在整个链作用域内可用
- `${action_result}` 指向上一个 action 输出

**不在 v1：** 多层变量传递 DSL、条件分支、Skill 间引用。

---

## 八、上下文变量

### 8.1 稳定可用（v1 可声明为 required）

| 变量               | 来源                                   |
| ------------------ | -------------------------------------- |
| `${app_name}`      | `active_window::fetch_active_window()` |
| `${app_category}`  | `app_category::from_app_name()`        |
| `${window_title}`  | `active_window::fetch_active_window()` |
| `${time}`          | `chrono::Local::now()`                 |
| `${input_text}`    | ASR 转录文本                           |
| `${selected_text}` | `clipboard::get_selected_text()`       |
| `${process_id}`    | `active_window`                        |

### 8.2 Best-effort（v1 仅可声明为 preferred/optional）

| 变量              | 说明                     | 限制                 |
| ----------------- | ------------------------ | -------------------- |
| `${file_path}`    | 从 window_title 解析     | 很多应用标题不含路径 |
| `${file_dir}`     | 从 file_path 提取        | 依赖 file_path       |
| `${file_ext}`     | 从 file_path 提取        | 依赖 file_path       |
| `${project_root}` | 向上查找 .git 等标志文件 | 依赖 file_path       |
| `${clipboard}`    | 系统剪贴板               | 可能含敏感内容       |

### 8.3 Planned（不在 v1）

| 变量                | 说明         |
| ------------------- | ------------ |
| `${current_url}`    | 浏览器 URL   |
| `${cursor_context}` | 光标前后文本 |

**约束**：v1 示例中不将 best-effort 变量放入 `context.required`，避免对运行时做过度承诺。

---

## 九、上下文需求声明

```yaml
context:
  selected_text: required # 缺失时 Skill 从候选集移除
  active_window: preferred # 有则使用，缺失仍可运行
  hotwords: optional # 有则注入，缺失无影响
  clipboard: none # 明确不注入
```

四级语义：

- `required`：缺失时 SkillResolver 将其移出候选集
- `preferred`：有则注入，缺失时降级运行
- `optional`：有则注入，缺失无影响
- `none`：明确不注入

**v1 约束**：`required` 只能用于 8.1 中的稳定可用变量。

---

## 十、Reference 装配系统

### 10.1 Reference 定义

```json
{
  "id": "obsidian_base_rules",
  "path": "references/obsidian.md",
  "inject_as": "system_append",
  "when": {
    "app_names": ["Obsidian"]
  }
}
```

### 10.2 注入方式

| 方式             | 说明                         | 适用场景           |
| ---------------- | ---------------------------- | ------------------ |
| `system_append`  | 追加到 system 层             | 通用规则、领域知识 |
| `user_prefix`    | 作为 user 消息前置 section   | 选中文本相关的参考 |
| `executor_input` | 不给 LLM，给 action executor | 脚本参数、配置     |

### 10.3 条件表达

`when` 支持：

- `always: true`
- `app_names: [...]`
- `app_categories: [...]`
- `window_title_regex: "..."`

### 10.4 Reference 与 PromptBuilder 的关系

Reference 装配由 `SkillRuntime` 负责，结果以 resolved sections 传入 PromptBuilder。

**PromptBuilder 不扩张变量驱动模型。** 新能力优先通过：

- Manifest 声明
- Reference 装配
- 结构化 user sections
- Executor runtime inputs

现有 `${app_name}` 等旧变量做有限兼容，不再新增。

---

## 十一、安全机制

### 11.1 Safety Manifest

```json
{
  "safety": {
    "confirmation": "first_run",
    "allow_shell": true,
    "allow_network": false,
    "timeout_ms": 10000,
    "blocked_patterns": ["rm -rf", "sudo", "mkfs"]
  }
}
```

`confirmation` 取值：

- `always`：每次执行确认
- `first_run`：首次确认，后续记住
- `never`：仅允许 Builtin 低风险动作

### 11.2 授权持久化

```rust
pub struct SkillPermissions {
    pub authorized_actions: HashMap<String, AuthEntry>,  // skill_id + action_hash
    pub trusted_skills: HashSet<String>,
}
```

### 11.3 防护措施

1. 危险命令拦截：匹配 blocked_patterns，强制二次确认
2. 输出大小限制：`capture_as` 截断到 100KB
3. 脚本路径收敛：script entry 只能引用 Skill 包内部文件
4. 外部 Skill 审核：imported 目录的 action Skill 默认 `enabled: false`
5. 审计日志：所有 action 执行记录到历史表

---

## 十二、用户创建流程

### 12.1 生成 Pipeline（5 步）

| Step | 操作                   | 输入          | 输出                                |
| ---- | ---------------------- | ------------- | ----------------------------------- |
| 1    | 意图分析               | 用户描述      | 结构化意图（text / action）         |
| 2    | 生成 Skill 正文 + 定义 | 意图          | SKILL.md + triggers + actions(按需) |
| 3    | 生成元信息与回显策略   | Skill 定义    | name, icon, result_policy           |
| 4    | 生成描述               | name + 定义   | description                         |
| 5    | 校验                   | 完整 Skill 包 | 路径/变量/安全性验证                |

非每个 Skill 都需要 actions/triggers —— 纯文本 Skill 只生成正文 + metadata。

**新 Skill 的自动生成流程不直接产出 `output_mode`。** 只有在兼容旧 Skill 或导出回旧格式时，才需要从 `result_policy` 反推展示用 `output_mode`。

### 12.2 编辑器分级

| 模式             | 面向     | 能力                                      |
| ---------------- | -------- | ----------------------------------------- |
| 描述模式（默认） | 所有用户 | 输入描述，AI 生成一切                     |
| 正文模式         | 进阶用户 | 编辑 prompt 正文 + 简单 triggers          |
| 完全控制模式     | 高级用户 | 编辑 manifest.json + references + scripts |

v1 默认不向普通用户暴露 manifest 原文。

---

## 十三、代码改造

### 13.1 新增模块

```
src-tauri/src/skills/
├── mod.rs              # 模块入口
├── manifest.rs         # SkillManifest 类型、解析、校验、兼容推导
├── resolver.rs         # 候选预筛选 + trigger 关键词匹配
├── runtime.rs          # Skill 执行总入口
├── executor/
│   ├── mod.rs          # 统一执行器接口
│   ├── command.rs      # Command / Script 执行
│   └── builtin.rs      # 内置动作（notify, clipboard.write 等）
└── safety.rs           # 安全策略 + 权限管理
```

### 13.2 SkillManager 扩展

```rust
impl SkillManager {
    fn load_skill_package(&self, path: &Path) -> SkillPackage;
    fn load_manifest(&self, skill: &Skill) -> SkillManifest;
    fn compile_legacy_manifest(&self, skill: &Skill) -> SkillManifest;
}
```

**frontmatter runtime 字段的解析入口：**

`Skill` struct 只承载展示字段。对于单文件 Skill，`compile_legacy_manifest()` **不以 `Skill` struct 为唯一输入**，而应直接重新解析原始文件 frontmatter，从中提取 `triggers / activation` 等 runtime 字段填入 `SkillManifest`。

```text
解析流程：
  原始 .skill.md 文件
    ├── 展示字段 → Skill struct（id, name, description, output_mode, ...）
    └── Runtime 字段 → SkillManifest（triggers, activation, context, ...）
```

单文件 frontmatter 中的 manifest 相关字段只进入 `SkillManifest`，不要求进入 `Skill`。这样实现者不会误以为"只改 `Skill` struct 就够了"。

### 13.3 PromptBuilder 职责收紧

PromptBuilder **只服务 text Skill 的 prompt assembly**：

- 消费：skill body + resolved references + runtime context
- 不负责：trigger 解析、action 编排、script 调用、安全校验
- 不扩张变量驱动模型

---

## 十四、实施路径

> **排序依据**：按用户实际优先级 D(上下文感知) > C(创建门槛) > B(Action 执行) > A(确定性触发) 重排。
> 每个 Phase 独立可交付，不依赖后续 Phase 的基础设施。

### Phase 1：约定式 Reference 装配（当前重点，1-2 周）

**目标**：同一个 Skill 在不同 App 中自动表现出不同行为。

**方案**：约定优于配置 —— 用文件名匹配，零配置。

```
grammar_fix/
├── SKILL.md                    # 主 prompt（现有格式不变）
└── references/
    ├── _always.md              → 始终注入
    ├── Slack.md                → app_name == "Slack" 时注入
    ├── Obsidian.md             → app_name == "Obsidian" 时注入
    ├── InstantMessaging.md     → app_category == "InstantMessaging" 时注入
    ├── CodeEditor.md           → app_category == "CodeEditor" 时注入
    └── Email.md                → app_category == "Email" 时注入
```

**匹配规则**：

- `_always.md` 始终注入
- 文件名与 `app_name` 精确匹配（大小写不敏感）
- 文件名与 `app_category` 精确匹配
- 多个匹配时全部注入（不互斥），注入顺序：`_always` → `app_name` → `app_category`

**注入位置**：追加到 system 层末尾（作为"场景规则补充"）。

**改动范围**：

- `SkillManager`：加载目录型 Skill 时扫描 `references/` 子目录
- 新增 `reference_resolver.rs`（~100 行）：按当前 app context 匹配文件名、加载内容
- `PromptBuilder`：接收 resolved references，追加到 system 层
- 不需要：SkillManifest、SkillResolver、Trigger、Action Executor、Safety

**用户操作**：把单文件 Skill 升级为目录包，往 `references/` 扔 `.md` 文件即可。

**验收**：

- "语法修正" Skill 在 Slack 中输出口语化结果，在 Mail 中输出正式结果
- 旧单文件 Skill 行为不变
- 无 `references/` 目录的目录型 Skill 行为不变

### Phase 2：智能生成增强（1-2 周）

**目标**：用户输入一段描述，自动生成完整 Skill 包（含 references）。

- 增强 `ai_generate_skill`：根据用户描述判断需要哪些场景 reference
- AI 自动生成 SKILL.md + references/ 下的场景文件
- 前端生成对话框支持预览和编辑生成结果

**验收**：

- 输入 "一个润色技能，在聊天时口语化，在邮件时正式" → 生成含 reference 的目录包
- 输入 "翻译成日语" → 生成单文件 Skill（无 reference，不强制）

### Phase 3：Action 执行器（2-3 周）

**目标**：Skill 可执行系统命令、脚本、通知。

- 定义 `SkillManifest v1`（此时才需要，因为 Action 需要结构化配置）
- 实现 Builtin / Command / Script / Confirm / Notify 五种执行器
- 安全管理器 + 权限确认 UI
- 基础 action 链 + `capture_as`
- 目录型 Skill 包支持 `manifest.json` + `scripts/`

**验收**：可创建 "运行测试" Skill 并语音触发 / 危险命令弹确认

### Phase 4：确定性触发 + Resolver（1-2 周）

**目标**：常用 Skill 零延迟触发，不依赖 LLM 路由。

- 新增 `SkillResolver`（activation 预筛选 + trigger 关键词匹配）
- `transcribe.rs`：在优先级 1-2 之后、LLM 路由之前插入 trigger 层
- 路由 prompt 增加 activation 信息，缩小候选集

**验收**：配了 triggers 的 Skill < 10ms 触发 / 不匹配 activation 的 Skill 不进入路由

### Phase 5：高级能力（远期 Backlog）

- Manifest Inspector UI / Runtime 执行追踪
- `Keystroke` / `Paste` / `Prompt-as-step` / `OpenUrl` action 类型
- `manifest.kind = hybrid`（先 runtime 内部消化，成熟后提升为公共类型）
- Action 链条件分支 / Skill 间引用与组合
- Reference 升级为可配置模式（`references.json`，支持 `window_title_regex` 等高级条件）
- Skill 市场 / 社区分享

---

## 十五、兼容矩阵

| 现有模块                           | v1 变化                                                  | 兼容性                                 |
| ---------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| `Skill` struct                     | 仅新增 `manifest_path`（`#[serde(skip)]`，runtime-only） | 不影响现有字段、不改 settings/bindings |
| `.skill.md` 格式                   | frontmatter 可选增 triggers/activation                   | 旧文件无需改动                         |
| `SkillManifest`                    | **新增独立结构**                                         | 旧 Skill 自动推导兼容 Manifest         |
| `SkillManager`                     | 新增 manifest 加载 + 目录包                              | 不改已有接口                           |
| `PromptBuilder`                    | 支持 reference 注入                                      | 不扩张变量模型                         |
| LLM 路由                           | 在缩小后候选集内工作                                     | 逻辑不变                               |
| `maybe_post_process_transcription` | 前面插入 resolver + trigger                              | 函数签名不变                           |
| `confirm_skill`                    | 不变                                                     | trigger 不抢占 selected_text 流程      |
| Builtin Skills                     | 可选添加 triggers                                        | 不添加则行为不变                       |

---

## 十六、Skill 文件示例

### 示例 A：简单 text Skill（单文件，向后兼容）

```yaml
---
id: "grammar_fix"
name: "语法修正"
description: "修正语法错误,去除口语化表达"
output_mode: polish
icon: "IconSparkles"
---
你是一个文本校对助手...
```

### 示例 B：带 trigger 的 text Skill（单文件）

```yaml
---
id: "translate_to_japanese"
name: "日语翻译"
description: "将语音输入翻译成日语"
output_mode: chat
icon: "IconLanguageHiragana"
triggers:
  - keywords: ["翻译成日语", "译成日文", "日语翻译"]
---
将以下文本翻译成日语。直接输出翻译结果，不要解释。
```

### 示例 C：Action Skill（目录包）

```
run_tests/
├── SKILL.md              # 空或包含描述
├── manifest.json
└── scripts/
    └── detect_and_test.sh
```

**manifest.json：**

```json
{
  "version": 1,
  "kind": "action",
  "triggers": [
    {
      "keywords": ["运行测试", "跑测试", "run test"],
      "apps": ["Terminal", "iTerm2", "Code", "Cursor"]
    }
  ],
  "activation": {
    "allowed_app_categories": ["CodeEditor", "Terminal"]
  },
  "context_requirements": {
    "active_window": "required"
  },
  "actions": [
    {
      "type": "script",
      "interpreter": "sh",
      "entry": "scripts/detect_and_test.sh",
      "timeout_ms": 30000
    },
    {
      "type": "notify",
      "title": "测试完成",
      "body": "${action_result}"
    }
  ],
  "safety": {
    "confirmation": "first_run",
    "allow_shell": true,
    "timeout_ms": 30000
  },
  "result_policy": { "mode": "toast" }
}
```

### 示例 D：带 Reference 的 text Skill（目录包）

```
obsidian_assistant/
├── SKILL.md
├── manifest.json
└── references/
    ├── base_rules.md
    └── daily_format.md
```

**manifest.json：**

```json
{
  "version": 1,
  "kind": "text",
  "activation": {
    "allowed_apps": ["Obsidian"]
  },
  "context_requirements": {
    "selected_text": "preferred",
    "active_window": "required"
  },
  "references": [
    {
      "id": "base_rules",
      "path": "references/base_rules.md",
      "inject_as": "system_append",
      "when": { "always": true }
    },
    {
      "id": "daily_format",
      "path": "references/daily_format.md",
      "inject_as": "system_append",
      "when": { "window_title_regex": ".*Daily.*" }
    }
  ],
  "result_policy": { "mode": "preview" }
}
```

---

## 十七、两份调研的异同分析

### 共识

1. Skill 需要从 "prompt 模板" 升级为 "可执行能力单元"
2. 确定性规则应优先于 LLM 路由
3. Reference 应成为运行时一等能力
4. 用户侧应尽量简化为"描述即 Skill"
5. Action 必须建立统一安全边界
6. 纯增量改造，旧 Skill 不破坏

### 差异与取舍

| 维度                         | Claude 方案        | OpenAI 方案        | 统一决策                                                                                                              |
| ---------------------------- | ------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 文件格式                     | 全部放 frontmatter | 分离 manifest.json | 简单 Skill 用 frontmatter，复杂用目录包                                                                               |
| Reference                    | 未涉及             | 一等能力           | 采纳 OpenAI                                                                                                           |
| Action 类型                  | 8 种具体类型       | 3 类抽象执行器     | v1 取 5 种（Builtin/Command/Script/Confirm/Notify），其余 future                                                      |
| 候选预筛选                   | 仅 trigger 匹配    | SkillResolver      | 采纳 OpenAI：activation + context 预筛选                                                                              |
| 上下文需求                   | 无声明             | 四级语义           | 采纳 OpenAI，但约束 required 仅用于稳定变量                                                                           |
| Skill vs Manifest            | 混合承载           | 独立分离           | 采纳 OpenAI：Skill 轻量 + Manifest 独立                                                                               |
| hybrid 类型                  | 公共类型           | 公共类型           | 审核修正：v1 仅 manifest 内部，不进入公共类型                                                                         |
| PromptBuilder                | 扩展变量集         | 收紧职责           | 采纳审核意见：不扩张变量模型                                                                                          |
| 执行优先级                   | 未明确             | 未明确             | 审核补充：5 级确定性优先级                                                                                            |
| 上下文分级                   | 未区分             | 未区分             | 审核补充：stable / best-effort / planned                                                                              |
| result_policy vs output_mode | output_mode        | result_policy      | 二轮审核：result_policy 为 Runtime 单一真相；三轮审核：Polish 映射为 `polish_review` 而非 `paste`，保留 diff 确认体验 |
| selected_text + trigger      | 未明确             | 未明确             | 二轮审核：`required selected_text` 的 Skill 不参与 trigger                                                            |
| manifest_path 持久化         | 未明确             | 未明确             | 二轮审核：runtime-only，`#[serde(skip)]`                                                                              |
| frontmatter 解析入口         | 未明确             | 未明确             | 三轮审核：runtime 字段直接从原始文件解析进 Manifest，不经过 Skill struct                                              |
| Polish 兼容映射              | 未明确             | 未明确             | 三轮审核：映射为 `polish_review`，保留 diff 确认，不退化为 paste                                                      |
