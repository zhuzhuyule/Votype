# Skill Routing & Smart Polish Pipeline — Design Spec

## Overview

本文档记录 2026-04-01 对语音输入路由管线的完整修复与重构。核心问题：invoke_skill 快捷键和选中文本场景下，技能路由链路多层断裂，导致技能永远无法执行。

## 场景矩阵

| 场景   | 快捷键       | 选中文本     | 当前窗口      | 期望行为                                                          |
| ------ | ------------ | ------------ | ------------- | ----------------------------------------------------------------- |
| **A1** | 普通录音     | 无           | 外部 App      | Smart Routing → 润色（PassThrough/LitePolish/FullPolish）         |
| **A2** | 普通录音     | 有           | 外部 App      | 意图识别(Skill Routing ∥ Smart Polish) → 技能确认 / 润色 fallback |
| **B1** | invoke_skill | 无           | 外部 App      | Skill Routing → 直接执行技能                                      |
| **B2** | invoke_skill | 有           | 外部 App      | Skill Routing → 直接执行技能（选中内容为主输入）                  |
| **C2** | 普通录音     | 有(Votype内) | Votype 主窗口 | Voice Rewrite（语音指令编辑选中内容）                             |
| **D**  | 普通录音     | —            | Review Window | Voice Rewrite（语音重写文档内容）                                 |

### 核心认知

**当存在选中文本时，用户的语音是「指令」，不是「内容」。**

- Smart Routing（分析文本质量）对指令无意义
- 润色只是无技能匹配时的 fallback
- 意图识别才是主路径

## 执行路径架构

```
unified_post_process()
│
├── Smart Routing (Steps 1+2)
│   条件: smart_routing_enabled && is_short_text && !is_rewrite_mode
│          && !skill_mode && !has_selected_text_raw
│   ├── History cache hit → 直接返回
│   ├── PassThrough → 返回原文
│   ├── LitePolish → intent_decision 标记
│   └── FullPolish → intent_decision 标记
│
├── Step 3: Model Selection
│   ├── LitePolish → 轻量单模型润色 → return
│   ├── Multi-model (条件: !skill_mode && !has_selected_text_raw && ...) → return
│   └── Single-model → 进入 maybe_post_process_transcription()
│
└── maybe_post_process_transcription()
    │
    ├── VotypeMode 路由
    │   ├── MainSelectedEdit → Voice Rewrite → return     [场景 C2]
    │   └── ReviewRewrite → Voice Rewrite → return         [场景 D]
    │
    ├── Mode B: effective_skill_mode && !transcription.empty()
    │   │  (无 is_explicit / override_prompt_id 门卫)
    │   ├── Skill Routing (轻量模型)
    │   ├── 匹配到技能 →
    │   │   ├── input_source heuristic (有选中文本 → 默认 "select")
    │   │   ├── 设置 initial_content + instruction_text
    │   │   └── fall through 到标准执行 → 直接返回结果
    │   └── 未匹配 → fall through 到标准润色
    │
    ├── Mode C: !effective_skill_mode && !transcription.empty() && has_selected_text
    │   │  (无 is_explicit / override_prompt_id 门卫)
    │   ├── 并行执行:
    │   │   ├── Skill Routing (轻量模型)
    │   │   └── Smart Polish (Smart Routing → 分类 → 执行)
    │   ├── 技能匹配 + 非默认技能 → PendingSkillConfirmation → 确认对话框
    │   ├── 技能匹配 + 是默认技能 → 直接用 polish 结果
    │   ├── 无匹配 → 用 polish 结果
    │   └── 用户取消确认 → 用 polish 结果 (已经过 Smart Routing 正确分级)
    │
    └── 标准润色执行 (A1 单模型路径, Mode B fall-through)
        └── PromptBuilder (instruction 字段在 input_source="select" 时注入)
```

## 关键模块

### Smart Polish (`execute_smart_polish`)

**位置**: `src-tauri/src/actions/post_process/routing.rs`

可复用的智能润色管线，封装 Smart Routing 分类→执行。接口与 `execute_default_polish` 一致（同参数同返回类型），内部更智能：

```
输入: transcription
│
├── Smart Routing 已启用 && 短文本?
│   ├── 是 → execute_smart_action_routing() 分类
│   │   ├── PassThrough (+ 重复检测覆盖) → 返回原文
│   │   ├── LitePolish → execute_smart_polish_lite() (轻量模型)
│   │   └── FullPolish → execute_default_polish() (全量模型)
│   └── 否 → 直接 FullPolish
│
输出: SmartPolishResult { text, action, token_count, model_id, provider_id, duration_ms }
```

**关闭 Smart Routing 时**: 等价于直接调用 `execute_default_polish`，输入输出不变。

### input_source 流转

Skill Router 返回 `input_source` 决定技能执行时的主输入：

| input_source | 含义               | [input-text] 内容 | 示例               |
| ------------ | ------------------ | ----------------- | ------------------ |
| `"select"`   | 指令针对选中内容   | selected_text     | "翻译这个"         |
| `"output"`   | 直接用语音输出     | transcription     | "帮我写邮件"       |
| `"extract"`  | 语音混合指令和内容 | extracted_content | "翻译：今天天气好" |

**流转路径**:

```
Skill Router → SkillRouteResponse.input_source
    │
    ├── Mode B: effective_input_source heuristic
    │   (有选中文本 → 默认 "select"，除非 routing 显式返回 "extract")
    │   → 设置 initial_content + instruction_text
    │
    └── Mode C: 保存到 PendingSkillConfirmation.input_source
        → confirm_skill 根据 input_source 选主输入:
           select  → pending.selected_text
           extract → pending.extracted_content
           output  → pending.polish_result 或 transcription
```

### Instruction 模式 (PromptBuilder)

**位置**: `src-tauri/src/actions/post_process/prompt_builder.rs`

当 `input_source="select"` 时，用户的语音是指令，选中内容是被操作的对象。PromptBuilder 新增 `[instruction]` 字段：

```
[instruction]
解释一下。

[input-text]
配置每个模型的设置，包括采样参数。
```

Input Protocol 自动生成包含：

```
- instruction: user's spoken command — when present, execute this instruction
  on input-text instead of the default processing task
```

**触发条件**:

- Mode B: `initial_content` 被设为选中文本时，`instruction_text = transcription`
- confirm_skill: `input_source="select"` 时，transcription 通过 `secondary_output` 传入，在 `maybe_post_process_transcription` 中当 `skill_mode=true` 且 `streaming_transcription != transcription` 时自动设为 instruction

## 修复清单

### 已有修复 (会话之前已提交)

| 位置                    | 修复                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `pipeline.rs:67-71`     | Smart Routing 条件加 `!skill_mode && !has_selected_text_raw`   |
| `pipeline.rs:360`       | Multi-model 条件加 `!has_selected_text_raw`                    |
| `pipeline.rs:1331`      | Mode C 条件去掉 `!is_explicit && override_prompt_id.is_none()` |
| `pipeline.rs:191-207`   | 准确的 skip-reason 日志                                        |
| `commands/mod.rs:373`   | `confirm_skill` 调用 `skip_smart_routing: true`                |
| `transcribe.rs:385-394` | FinishGuard 检查 pending skill 后决定是否隐藏 overlay          |

### 本次提交

| 提交       | 内容                                | 文件                                 |
| ---------- | ----------------------------------- | ------------------------------------ |
| `ceb9e7ec` | 提取 `execute_smart_polish` 模块    | routing.rs, mod.rs, pipeline.rs      |
| `002164e2` | 接入 Mode C 并行块                  | pipeline.rs                          |
| `51a4cc37` | `input_source` 全链路传递           | lib.rs, pipeline.rs, commands/mod.rs |
| `d61ae6c0` | Mode B 去掉 override_prompt_id 门卫 | pipeline.rs                          |
| `b22eda3d` | 选中文本 input_source 启发式        | pipeline.rs                          |
| `7ca1e9f4` | PromptBuilder instruction 模式      | prompt_builder.rs, pipeline.rs       |

## 修复前的问题链

修复前，以下每一层都阻断了下一层，导致技能永远无法执行：

```
1. Smart Routing 拦截 → skill_mode 和有选中文本时 PassThrough 提前返回
2. Multi-model 抢先返回 → 有选中文本时跳过 Mode C 意图识别
3. App 规则阻断 Mode B → override_prompt_id 导致 is_explicit=true
4. App 规则阻断 Mode C → 同上
5. confirm_skill 中 Smart Routing 再次拦截 → 把指令判为 pass_through
6. FinishGuard 隐藏 overlay → 确认按钮闪一下消失
7. input_source 丢失 → 翻译了指令本身而非选中内容
8. 技能不知道"做什么" → AI 问答原样返回内容（无 instruction 字段）
```

## 风险评估

### 零风险 (纯新增，不影响现有路径)

- `SmartPolishResult` 类型
- `PendingSkillConfirmation` 新增 Option 字段（默认 None）
- `PromptBuilder.instruction` 字段（默认 None，不调用时无效果）
- `build_hotword_injection` / `has_repetition_pattern` 可见性扩大

### 低风险 (有条件守护，普通路径不受影响)

- **Mode B 条件放宽**: invoke_skill 总是进入技能路由。路由返回 "default" 时 fall through 到正常润色
- **Mode C 条件放宽**: 有选中文本时总做意图识别。无匹配时用 polish fallback
- **Smart Routing 跳过**: 仅 skill_mode 或有选中文本时跳过，A1 路径不受影响
- **Smart Polish 替换 Default Polish**: Smart Routing 关闭时内部直接 fall through 到 FullPolish
- **instruction 注入**: 仅 skill_mode 且内容替换时触发

### A1 场景完全不受影响

普通录音无选中文本时：Smart Routing 条件全满足走原路径；Mode B/C 条件不满足不进入；Multi-model 条件不受影响；PromptBuilder 无 instruction。

## 调试指南

### 日志关键字

| 日志前缀                                       | 含义                                         |
| ---------------------------------------------- | -------------------------------------------- |
| `[UnifiedPipeline]`                            | unified_post_process 中的 Smart Routing 决策 |
| `[ModeRouting]`                                | VotypeInputMode 解析结果                     |
| `[SkillRouter]`                                | Skill Routing LLM 调用和结果                 |
| `[SmartPolish]`                                | execute_smart_polish 内部决策                |
| `[PostProcess] Skill mode routed to`           | Mode B 技能路由结果                          |
| `[PostProcess] Entering intent detection mode` | Mode C 进入意图识别                          |
| `[PostProcess] Intent detection conditions`    | Mode C 条件检查                              |
| `[SkillConfirmation]`                          | confirm_skill 执行/取消                      |

### 排查流程

1. **技能不触发**: 检查 `[ModeRouting]` 确认 votype_mode，检查 `Intent detection conditions` 确认各条件值
2. **匹配到技能但结果错误**: 检查 `input_source` 值，确认 `[instruction]` 是否注入到 user message
3. **确认框闪消失**: 检查 `FinishGuard` 是否正确跳过 `hide_recording_overlay`
4. **Smart Polish 行为异常**: 检查 `[SmartPolish]` 日志确认分类结果
5. **Mode B 被阻断**: 确认没有 `!is_explicit` 条件，检查 `effective_skill_mode` 值
