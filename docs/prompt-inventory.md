# 提示词全量整理

本文把项目里的提示词分成三类：

1. 系统内置提示词
2. 用户自定义提示词
3. 已缓存或已持久化的提示词

同时补充：

- 这些提示词分别从哪里来
- 最终如何合并
- 运行时谁覆盖谁

## 总览

项目里实际上有两套提示词体系：

1. `Skill / Prompt` 体系
   用于后处理、翻译、总结、命令等“用户可选”的文本处理流程。
   数据结构是 `settings::Skill`，并通过 `type LLMPrompt = Skill` 复用。

2. `System Prompt Resource` 体系
   用于内部系统能力，例如：
   - 技能路由
   - 润色质量评估
   - 纠错分析
   - 文本优化
   - 各类 summary 生成

前者主要来自：

- `src-tauri/resources/skills/builtin/`
- `~/.votype/skills/user/`
- `~/.votype/skills/imported/`
- `settings_store.json` 中的 `post_process_prompts`

后者主要来自：

- `src-tauri/resources/prompts/`
- `~/.votype/skills/system/` 中的用户侧镜像缓存

## 1. 系统内置提示词

### 1.1 内置 Skill 提示词

这些提示词会作为默认 `post_process_prompts` 注入到设置里。

来源代码：

- [settings.rs](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L846)

内置文件目录：

- [builtin](/Users/zac/code/github/asr/Handy/src-tauri/resources/skills/builtin)

当前内置 Skill 列表：

| ID 文件                       | 作用       |
| ----------------------------- | ---------- |
| `default_correction.skill.md` | 默认润色   |
| `ai_chat.skill.md`            | AI 对话    |
| `translation.skill.md`        | 翻译       |
| `summarize.skill.md`          | 总结       |
| `memo.skill.md`               | 备忘/记录  |
| `code_generate.skill.md`      | 代码生成   |
| `code_explain.skill.md`       | 代码解释   |
| `style_reply.skill.md`        | 风格化回复 |
| `reply_suggestion.skill.md`   | 回复建议   |
| `votype_command.skill.md`     | 命令类技能 |
| `grammar_fix.skill.md`        | 语法修正   |
| `smart_compose.skill.md`      | 智能续写   |

加载方式：

- `default_post_process_prompts()` 通过 `include_str!()` 编译进程序
- 再由 `parse_builtin_skill_content()` 解析成 `Skill`
- 最终进入 `AppSettings.post_process_prompts`

### 1.2 内部系统 Prompt 资源

这类提示词不直接显示为用户可选 Skill，而是内部功能调用时由 `PromptManager` 读取。

来源代码：

- [prompt.rs](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/prompt.rs#L8)

资源目录：

- [prompts](/Users/zac/code/github/asr/Handy/src-tauri/resources/prompts)

当前主要系统 Prompt：

| 文件                            | 用途                           |
| ------------------------------- | ------------------------------ |
| `system_skill_routing.md`       | 技能路由                       |
| `system_confidence_check.md`    | 润色结果质量评估与词级变动分析 |
| `system_correction_analysis.md` | 编辑修正对的 ASR/语义分类      |
| `system_text_optimization.md`   | 提示词优化器                   |
| `system_skill_generation.md`    | Skill 生成                     |
| `system_skill_metadata.md`      | Skill 元数据生成               |
| `system_skill_description.md`   | Skill 描述生成                 |
| `system_summary_*.md`           | 日/周/月总结相关系统提示词     |

这些文件会在运行时通过：

- [PromptManager::get_prompt](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/prompt.rs#L78)

按 `id -> filename.md` 的方式加载。

## 2. 用户自定义提示词

### 2.1 用户创建的外部 Skill

用户自定义 Skill 的主要文件目录：

- `~/.votype/skills/user/`

导入的第三方 Skill 目录：

- `~/.votype/skills/imported/`

来源代码：

- [SkillManager::new](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/skill.rs#L35)
- [SkillManager::load_all_external_skills](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/skill.rs#L307)

支持两种文件形式：

1. 单文件 `.md`
2. 文件夹下的 `SKILL.md` / `skill.md`

来源标记：

- `SkillSource::User`
- `SkillSource::Imported`

定义位置：

- [SkillSource](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L79)

### 2.2 用户在设置里修改过的内置 Skill

这是最容易混淆的一类。

内置 Skill 一旦被用户在 UI 中修改后，不一定写回 `resources/skills/builtin/`，而是会保存在设置里：

- `settings_store.json`
  键：`settings.post_process_prompts`

对应字段：

- [post_process_prompts](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L553)

区分方式：

- `source = builtin`
- `customized = true`

当 `ensure_post_process_defaults()` 运行时：

- 只会自动刷新“未自定义”的内置 Skill
- 已自定义的内置 Skill 会保留用户版本

相关逻辑：

- [ensure_post_process_defaults](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L868)

### 2.3 UI 里看到的 Prompt 列表是怎么拼出来的

UI 编辑页实际看到的是两部分合并：

1. `settings.post_process_prompts`
2. `externalSkills`

前端逻辑：

- [usePrompts.ts](/Users/zac/code/github/asr/Handy/src/components/settings/post-processing/prompts/hooks/usePrompts.ts#L56)

也就是说，用户在界面里看到的“提示词”并不全是一个来源。

## 3. 已缓存或已持久化的提示词

这一类实际上又分三层。

### 3.1 设置持久化缓存

位置：

- `settings_store.json`

关键字段：

- `settings.post_process_prompts`

用途：

- 保存当前可用 Skill/Prompt 列表
- 保存用户改过的内置 Skill
- 保存选中的默认 Prompt

相关代码：

- [SETTINGS_STORE_PATH](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L944)
- [store_set_settings](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L1192)

### 3.2 运行时内存缓存

位置：

- `CACHED_SETTINGS`

用途：

- 减少反复读取 store
- 在一次运行期间缓存 `AppSettings`

相关代码：

- [CACHED_SETTINGS](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L12)
- [get_settings](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L1292)

注意：

这不是单独的提示词缓存结构，而是整个设置对象的内存缓存。
其中自然包含 `post_process_prompts`。

### 3.3 系统 Prompt 的用户侧镜像缓存

位置：

- `~/.votype/skills/system/`

用途：

- `PromptManager` 会把 `src-tauri/resources/prompts/*.md` 镜像到用户目录
- 方便用户覆盖、保留本地版本
- 同时用 `.resource_hash` 追踪资源是否更新

相关代码：

- [PromptManager::new](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/prompt.rs#L13)
- [PromptManager::get_prompt](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/prompt.rs#L78)

行为规则：

1. 若用户镜像文件不存在：
   - 从内置资源复制一份过去
2. 若存在：
   - 比较资源 hash 和本地 hash
   - 如果用户未改过且资源更新，则自动覆盖
   - 如果用户改过，则保留用户版本，只更新 hash

这就是“系统内置 prompt 的用户侧缓存层”。

## 最终优先级

### A. 对于 Skill / Prompt（后处理用）

大体优先级：

1. 外部 Skill 文件（`~/.votype/skills/user` / `imported`）
2. 设置里的 `post_process_prompts`
3. 编译进程序的内置 Skill 默认值

更精确地说：

- 程序先用内置 Skill 初始化 `post_process_prompts`
- 再把外部 Skill 合并进来
- 如果外部 Skill 和设置里的 Skill `id` 相同，当前逻辑是外部文件覆盖设置版本

相关代码：

- [merge_external_skills](/Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#L1343)

### B. 对于内部系统 Prompt

优先级：

1. `~/.votype/skills/system/{id}.md`
2. `src-tauri/resources/prompts/{id}.md`

相关代码：

- [PromptManager::get_prompt](/Users/zac/code/github/asr/Handy/src-tauri/src/managers/prompt.rs#L78)

## 实际上你要找的“三类提示词”对应关系

### 1. 系统内置提示词

包括两部分：

- `src-tauri/resources/skills/builtin/*.skill.md`
- `src-tauri/resources/prompts/*.md`

### 2. 用户自定义提示词

包括两部分：

- `~/.votype/skills/user/`
- `~/.votype/skills/imported/`

再加一类“用户在设置里改过的内置 Skill”：

- `settings_store.json -> settings.post_process_prompts`

### 3. 已经被缓存好的提示词

包括三层：

- `settings_store.json` 里的 `post_process_prompts`
- 运行时 `CACHED_SETTINGS`
- `~/.votype/skills/system/` 里的系统 Prompt 镜像缓存

## 建议后续整理方向

如果你要继续收口这个系统，下一步最值得做的是：

1. 明确把 `Skill` 和 `System Prompt` 在命名上彻底分开
2. 给 `settings_store.json` 里的 `post_process_prompts` 增加来源统计或导出视图
3. 在设置页增加“三类提示词”的分组展示：
   - 内置
   - 外部自定义
   - 已自定义覆盖的内置
4. 给 `~/.votype/skills/system/` 加一个只读说明，避免用户误把它当普通 Skill 目录
