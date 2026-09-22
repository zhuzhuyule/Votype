---
name: "跨模型 Prompt 鲁棒性体系"
tags: [post-processing, prompt, eval, model-profile, observability]
depends_on:
  - "PromptManager 版本感知加载与用户自定义保护 (managers/prompt.rs:78-138)"
  - "prompt_builder.rs 已有的规则块注入模式：FieldTag / build_input_protocol_note / POLISH_MODE_NOTE (prompt_builder.rs:63-120)"
  - "SmartAction 三档路由 PassThrough / LitePolish / FullPolish (routing.rs:10-18)"
  - "llm_call_log / llm_call_stats 已按 (model_id, provider, call_type) 聚合，但无 prompt 标识字段 (managers/llm_metrics.rs MIGRATION_SQL)"
  - "review_action / review_edit_distance 用户反馈已在库 (CLAUDE.md Observability 节)"
  - "已知限制：extensions.rs 多模型候选有独立 HTTP 实现，不走 core.rs (CLAUDE.md)"
estimate: "Phase 0: 1-2d · Phase 1: 2-3d · Phase 2: 2-3d · Phase 3: 1-2d"
---

## 意图

"把润色 prompt 从『面向单一理想模型的整篇文案』重构为『硬约束层 + 目标层』两段结构，配套离线回归评测集、按模型能力分级的 prompt 变体路由、以及 prompt 粒度的线上效果统计，使同一份管线在用户自带的异构 LLM 上表现可验证、可回归、可持续改进。"

解决的问题：

1. **Votype 的核心卖点即是痛点。** 用户自带模型 + 多模型对比意味着润色 prompt 必须同时在强模型（GPT/Claude 级）和弱模型（小参数/端侧）上工作。当前 `system_lite_polish.md` / `system_text_optimization.md` 是单篇文案，禁止条款、示例、任务指令混排，弱模型经常违反"不重组句式""不增删信息"却无从发现。
2. **prompt 改动无回归防线。** 修改任何一个 `system_*.md` 后，唯一验证手段是人工试用。没有"改了 A 场景、B 模型悄悄劣化"的检测机制。对比 Vokie：它把 system prompt 托管在云端、只面向自家单一模型精调，所以没有这个问题；我们必须用评测体系补掉这个结构性差异。
3. **线上数据没有按 prompt 维度切开。** `llm_call_log` 记录了模型和耗时，但 review 接受率、编辑距离无法归因到"哪个版本的 prompt 对这个模型"，改 prompt 全靠感觉。

## 约束

- **禁止引入云端 prompt 托管 / prompt_refs 机制。** 开源 + 本地可审计是产品定位，prompt 资产必须随仓库分发。（借鉴 Vokie 的是它的契约*写法*，不是它的分发*方式*。）
- **不新增任何常驻 LLM 调用。** 评测 harness 只在显式运行时打 API；能力探测只在用户点击按钮时打 3 次。
- **PromptManager 用户自定义语义不变**：`get_prompt` 的版本同步逻辑（prompt.rs:97-115）不得弱化——用户改过的文件永远不被内置更新覆盖。契约 fragment 文件（见决策 2）走只读通道，不进入用户可覆写目录。
- 新 settings 字段一律 `#[serde(default)]`，旧配置文件前后向兼容。
- 评测断言必须是**确定性纯函数**（正则/计数/集合比较），不引入 LLM-as-judge。
- `pipeline.rs` 的 4 步路由结构、`IntentDecision` 字段、bypass 规则（长度阈值 / 智能路由关闭 / ReviewRewrite）不改语义；本 spec 只改变第 4 步**组装出的 prompt 内容**。
- 遵守 CLAUDE.md runtime rules（非 async 上下文禁 `tokio::spawn` 等）；resolver/断言函数保持同步纯函数。
- 提交前 `bun tsc`/`cargo clippy` 清零 warning（build 不含类型检查，须单独跑）。

## 已定决策

### 决策 1：两层契约结构 —— `contract_core`（硬约束） + `goal_block`（目标层）

所有润色类 prompt（`system_lite_polish`、`system_text_optimization`、`system_votype_rewrite`）拆为两段注入：

- **contract_core**：与模型无关的最小硬约束集，短句祈使、编号列表。吸收 Vokie 表达场契约中被验证有效的三条规则：
  - 语义硬约束：必须保留事实、主体、对象、动作、数字、否定、程度、不确定性、承诺、条件、因果、问句；不添加、不总结、不改变信息间逻辑关系；
  - 精确输入保护：整条主体为命令、代码、路径、URL、邮箱、搜索词、表单值时冻结一切改写；混合输入只冻结精确片段；
  - 最终状态约束：先完成用户自有修正（ASR 纠错/热词），冻结语义后再应用表达目标。
- **goal_block**：表达目标。Phase 0 只有两个既有档位映射——LitePolish ≈ `faithful + linear`、FullPolish ≈ `polished + segmented|structured`。九宫格二维化（措辞 × 整理独立档位）**不在本 spec**，但 contract_core 的文件命名按 `wording`/`structure` 双轴预留（决策 2 的 fragment 命名空间），未来接入二维 UI 是纯增量。

不选"整篇 prompt 按模型复制多份"：N 模型 × M 场景的文案矩阵不可维护；分层后硬约束单点修改、全模型生效。

### 决策 2：契约 fragment 文件与加载通道

```
src-tauri/resources/prompts/
  contract_core.md                  # 硬约束，所有润色 prompt 共用
  contract_examples/
    lite.strong.md  lite.weak.md    # LitePolish few-shot 组（强模型 5 例 / 弱模型 2 例）
    full.strong.md  full.weak.md    # FullPolish few-shot 组
```

- 新增 `PromptManager::get_fragment(&self, app_handle, rel_path) -> String`：**只读内置 resource，不同步到 `~/.votype/skills/system/`，用户不可覆写**。契约是系统一致性资产，允许覆写会制造无法复现的评测结果。
- 润色 prompt 模板（用户可覆写的整篇文件）保留 `{{contract}}` 与 `{{examples}}` 两个占位符：`prompt_builder` 注入前检测——模板含占位符则注入；**用户自定义模板已删除占位符则尊重用户，不强行注入**（保护存量自定义 prompt 不炸）。
- 内置模板中 contract_core 文案与既有"禁止"小节合并去重，避免同一规则两种说法（弱模型会困惑）。

### 决策 3：评测 harness —— `evals/` + cargo test（#[ignore]）

```
evals/
  cases/*.json          # 用例，git 跟踪
  models.json           # 参评模型清单：{ name, provider_kind, base_url_env, api_key_env, model_id }
  reports/              # 输出，git 不跟踪
  README.md
```

用例格式：

```json
{
  "id": "num-negation-01",
  "input": "这个方案不行，大概要3天，不是2天",
  "context": { "scenario": "workChat", "hotwords": [], "language": "zh" },
  "action": "lite_polish",
  "assertions": [
    { "type": "keep_numbers" },
    { "type": "keep_negation" },
    { "type": "length_ratio", "min": 0.4, "max": 1.2 },
    { "type": "forbid_list_markers" },
    { "type": "forbid_punct_start" }
  ]
}
```

- 断言类型集合（初始，均为确定性规则）：`keep_numbers` / `keep_negation` / `keep_question` / `keep_terms`（热词与英文 token 大小写保留）/ `length_ratio` / `forbid_list_markers` / `forbid_punct_start` / `forbid_meta_prefix`（"输出："之类前缀）。
- 入口：`cargo test -p votype --features eval --release prompt_eval -- --ignored`。runner 直接调 `execute_llm_request_typed`（指定 call_type 与消息组装走 prompt_builder 现行路径，保证"评的就是线上那份 prompt"），并发度 1，尊重速率。
- 报告：`evals/reports/{date}-{model}.md` + `.json`，含 (case × assertion) 通过矩阵与总通过率。**首轮全量运行固化为基线**；此后 CI 之外靠约定：改任何 prompt/契约文件必须附基线对比，通过率下降的 (model, case) 需逐个解释。
- 未配置 `models.json` 中某模型的 env 时：该模型整个 skip 并在报告标注，不 fail。API 错误走 `execute_llm_request_with_retry`，仍失败记为 error 行，不 panic。
- 用例来源：Phase 1 交付 ≥ 30 条，其中 ≥ 1/3 来自历史 `pipeline_decisions` 里出过错的样本与 bug 报告脱敏改写；必须包含精确输入保护（整条 URL/代码）、纯语气词、中英混合至少 3 条。

不选"做成 Tauri 内可视化页面"：先让工程师/agent 能在命令行跑，UI 进排除范围。

### 决策 4：模型能力档案 + 手动探测定级

- `settings.rs` 的 cached model 增加 `prompt_tier: Option<PromptTier>`，`PromptTier = Strong | Weak`，`None`（Unknown）按 Strong 处理（保持现状行为，零迁移风险）。
- 探测命令 `probe_prompt_tier(app, model)`（`#[tauri::command]`）：3 条固定探针（① 含数字+否定+问句的长口语，要求保语义轻顺句；② 含明显列表信号的文本；③ 整条为 URL/code 的精确输入）。用 `execute_llm_request_typed` temperature 0 执行，决策 3 的同一套断言函数判分：全部通过 → Strong；①或③任一失败 → Weak（③失败是一票否决——精确输入被改写是事故级）。②失败不影响定级（列表能力只是加分项）。
- **仅设置页模型卡片上的"探测能力档位"按钮触发**，带预估用量提示；不自动、不后台跑。用户可在探测后手动改 Strong/Weak 覆盖。
- 探测结果与失败原因写入 `pipeline_decisions`（新增 call_type/decision 记录复用现有表，不加新表）。

### 决策 5：路由接入点

- 第 4 步执行前（`pipeline.rs` / `extensions.rs` 调 prompt_builder 处），按**当次实际执行模型**的 `prompt_tier` 选择 `contract_examples/*.{tier}.md` 注入 `{{examples}}`，contract_core 不变。
- tier=Weak 的额外降级：FullPolish 请求在 goal_block 中只保留 structure 目标、禁用措辞改写类指令（措辞改坏是弱模型最高频事故，结构整理出错可感知、损失小）；LitePolish 不变。
- **多模型对比路径**：`extensions.rs` 有独立 HTTP 实现（已知限制）。本 spec 的接入要求仅一条——其 system prompt 必须出自 prompt_builder 的同一个组装函数；若当前已复用则零改动，若未复用则将它的组装段替换为调用共享函数，不碰它自己的发送/解析代码。每候选按各自 tier 组装。
- intent 模型（smart routing）本身也是用户配置的弱模型重灾区，但 `system_smart_routing` 输出为 JSON 分类，已有 fallback 兜底（routing.rs 失败 → None → full polish），**不改**，进排除范围。

### 决策 6：prompt 粒度线上统计

- 迁移：`llm_call_log` 加列 `prompt_hash TEXT`（值 = `PromptManager::content_hash`，prompt.rs:27 已有工具函数；contract+examples 组装后整篇 system prompt 的 hash）。`is_fallback` 已在 `LlmCallRecord` 结构里，确认落库。
- 新视图 `v_prompt_effectiveness`：按 (model_id, provider, prompt_hash) 聚合 调用数 / 错误率 / 与 review_action、review_edit_distance join 出的接受率（关联键：history_id，llm_call_log 已有该列）。
- 设置页模型卡片显示"近 30 天该模型润色接受率"，纯只读展示，不做自动切换变体（数据量小的用户会出现噪声驱动的劣化选择）。

## 边界

### 允许修改

- `src-tauri/src/actions/post_process/prompt_builder.rs`（注入 `{{contract}}` / `{{examples}}`、tier 参数）
- `src-tauri/src/actions/post_process/pipeline.rs`（组装调用点传 tier）
- `src-tauri/src/actions/post_process/extensions.rs`（仅 prompt 组装段收敛到共享函数）
- `src-tauri/src/managers/prompt.rs`（`get_fragment`）
- `src-tauri/src/managers/llm_metrics.rs`（prompt_hash 列与写入）
- `src-tauri/src/managers/pipeline_log.rs`（探测决策记录）
- `src-tauri/src/settings.rs`（`prompt_tier` 字段）
- `src-tauri/src/commands/`（探测 command 注册）
- `src-tauri/resources/prompts/`（现有文件重构 + contract fragment）
- 新增 `evals/` 目录、`src-tauri/tests/prompt_eval.rs`
- `src/` 设置页模型管理组件（探测按钮、接受率展示）

### 禁止

- 禁止改动 `transcribe.rs` 的音频/识别链路与 `shortcut/`——本特性纯 post-process。
- 禁止云端拉取/热更新 prompt（意图节已定）。
- 禁止新增第三方 eval/断言框架依赖，规则断言手写。
- 禁止自动触发任何探测/评测的后台任务。
- 禁止破坏 PromptManager 现有"用户文件优先"逻辑（决策 2 的 fragment 只读通道是新增面，不是修改存量）。

## 排除范围

- **九宫格二维 UI（措辞 × 整理拖动调节 + 按场景记忆）**：contract 命名已预留双轴，UI 与意图模型输出二维化独立立项（后续 spec）。
- LLM-as-judge 语义等价评判。
- 评测结果的应用内可视化页面。
- 基于接受率的自动变体切换/自动 prompt 优化。
- `system_smart_routing`、summary 系列 prompt 的契约化改造（Phase 0 只做润色三件套）。
- 云端 prompt 更新通道（签名 manifest 方案另议，涉及分发模型信任问题）。
- `length_routing_threshold` 等既有 bypass 规则调整。

## 验收场景

### 1. eval_baseline_happy（Happy path · Phase 1）

- **Given**: `evals/models.json` 配置了 ≥ 2 个可达模型（一强一弱），cases ≥ 30 条
- **When**: 运行 `cargo test --features eval prompt_eval -- --ignored`
- **Then**: 生成 `evals/reports/` 下每模型一份 md+json，含 (case×assertion) 矩阵与总通过率；退出码 0

### 2. prompt_change_regressed（Error path · Phase 1）

- **Given**: 已有基线报告
- **When**: 修改 contract_core 使某模型 `keep_negation` 由过变不过，重跑评测
- **Then**: 该 (model, case) 在报告中标红为 regression，runner 以非 0 退出，阻止"顺手改 prompt"静默劣化

### 3. probe_tier_assignment（Happy path · Phase 2）

- **Given**: 用户已配置某端侧小模型，`prompt_tier` 为 None
- **When**: 在设置页点击"探测能力档位"，模型对探针③（整条 URL）返回了被改写的文本
- **Then**: 定级为 Weak 并持久化；后续该模型的 FullPolish 自动使用 lite 级 few-shot 组且 goal_block 禁用措辞改写；模型卡片显示当前 tier，用户可手动覆盖为 Strong

### 4. probe_unreachable（Error path · Phase 2）

- **Given**: 某模型 base_url 已失效
- **When**: 点击探测
- **Then**: 走 `execute_llm_request_with_retry` 重试后返回明确错误 toast，`prompt_tier` 保持 None（≠ Strong/Weak），下次润色行为与今天完全一致

### 5. custom_prompt_no_injection（Edge case · Phase 0）

- **Given**: 用户在 `~/.votype/skills/system/system_lite_polish.md` 自定义了 prompt 且删掉了 `{{contract}}` 占位符
- **When**: 正常听写触发 LitePolish
- **Then**: 按其自定义内容原样发送，不强行注入契约块；PromptManager 的内置更新同步仍遵循"用户已改 → 不覆盖"（prompt.rs:108-114）

### 6. exact_input_freeze（Edge case · Phase 0/1）

- **Given**: contract_core 已注入，用户说出一整条 `https://example.com/a?b=1` 的 URL 或 shell 命令
- **When**: FullPolish 执行（任意 tier 模型）
- **Then**: 输出与输入逐字符一致（精确输入保护断言 `keep_verbatim` 通过）；评测集中此类用例在所有参评模型上必须 100% 通过（硬门槛，区别于其他断言允许基线抖动 ±）

### 7. multi_model_per_tier（Edge case · Phase 2/决策 5）

- **Given**: 多模型对比候选含一个 Weak + 一个 Strong
- **When**: 触发多模型 FullPolish
- **Then**: 两候选各自收到按 tier 组装的 system prompt（llm_call_log 中两行 prompt_hash 不同），候选面板与排序逻辑不变

### 8. stats_attribution（Happy path · Phase 3）

- **Given**: 同一模型先后使用两个不同 hash 的 prompt 完成润色且用户在 review 中有采纳/编辑行为
- **When**: 查询 `v_prompt_effectiveness`
- **Then**: 两行分别聚合，接受率与平均编辑距离按 (model_id, prompt_hash) 可区分；旧数据 prompt_hash 为 NULL 不污染新行

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |
