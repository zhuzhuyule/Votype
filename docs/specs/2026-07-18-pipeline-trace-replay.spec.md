---
name: "Pipeline 轨迹回放调试视图"
tags: [observability, dashboard, pipeline, debug, expert-mode]
depends_on:
  - "pipeline_decisions 表（history.rs migration 40/41/48，行 398-455）与 PipelineLogManager 的 fail-open 写入（pipeline_log.rs:61-65 log_decision 吞错只打日志）"
  - "llm_call_log 表（llm_metrics.rs MIGRATION_SQL，migration 33/35）已按 history_id 记录 call_type='intent'/'single_polish'/'multi_model'/'rewrite' 的逐调用指标"
  - "transcription_history.post_process_history（PostProcessStep JSON 数组）留存润色输出；review_action / review_edit_distance / review_selected_candidate（migration 39，history.rs:395-397）留存用户编辑反馈"
  - "settings.expert_mode 字段（settings.rs:995，serde default = false）与 Sidebar.tsx:116 的 expertMode gate 先例"
  - "DashboardEntryCard.tsx 已有行内展开面板（错误面板）与 post_process_history 解析展示（:110-117）先例；EditHistoryDialog.tsx 对话框先例"
  - "commands/history.rs 已聚合 llm_metrics 读取命令先例（get_model_speed_stats:668 / get_llm_usage_stats:680）"
  - "弱依赖：docs/specs/2026-07-18-experience-card-engine.spec.md —— 本期零代码交集，仅共享 history.rs MIGRATIONS 追加点与后续集成点（见排除范围与已定决策·迁移协调）"
estimate: "2-3 days"
---

## 意图

"把每次 pipeline 运行的决策过程渲染成**时间轴卡片流**（路由判定 → 意图原始输出 → 模型选择 → 润色输出 → 用户编辑），藏在 expert 模式的历史条目详情入口后，供 prompt 调优复盘：一眼看清『这次转写为什么走了这条路、意图模型到底输出了什么、最终润色改了什么、用户又改回了什么』。纯展示，不做重放执行。"

解决的问题：pipeline 的决策数据大半已落库（`pipeline_decisions` 一行一 run、`llm_call_log` 一行一调用、`transcription_history.post_process_history` 留存润色输出、review 三列留存用户反馈），但它们散在三张表里，没有任何 UI 能按一次 run 串起来看。更关键的缺口是：**意图模型的原始输出目前完全不留存**——routing.rs:250-259 把 `response_text` 解析成 action/needs_hotword/language 后原文即丢弃，解析失败时更是整段蒸发（`.ok()?` 直接返回 None 回退 FullPolish）。而"意图模型输出了什么怪东西"恰是 smart routing prompt 调优最需要的第一手样本。参考实现为 auto-reply 的 trace-types（五元组时间轴）/ trace-recorder（append-only + fail-open）/ MemoryWindow（时间轴卡片流 UI），本 spec 将其**读侧**思路适配到 votype：不引入新的轨迹存储层，补一列缺失数据 + 一条组装读命令 + 一个时间轴视图。

## 约束

- **本特性不新增任何 LLM 调用**——纯数据留存 + 只读展示。
- **不改变 4 步路由决策逻辑**：intent 原始输出的捕获只是旁路携带（routing.rs 的 JSON 解析语义、回退行为、SmartAction 映射一律不动）。
- **落库失败绝不影响主流程（fail-open）**：`intent_raw_response` 随既有 `log_decision` 的同一条 INSERT 落库，沿用其吞错只打日志的语义（pipeline_log.rs:61-65）；不新增独立写路径、不加重试。参考 trace-recorder 的串行 write-chain 思路——votype 侧 `log_decision` 本就是 run 结束时的单次同步写，天然串行，无需新基础设施。
- `intent_raw_response` 落库前按**字符**截断至 ≤2000 chars（`chars().take(2000)`，UTF-8 安全；正常 intent 输出 <200 字符，2000 已覆盖模型跑飞场景），防表膨胀。
- 视图入口默认隐藏在 **expert 模式**（`settings.expert_mode`）后，前端 gate；后端命令不做鉴权 gate（数据本就在本地 SQLite，无信任边界变化）。
- 新命令 `get_pipeline_trace` 为普通 `#[tauri::command]` async 函数，rusqlite 同步读沿既有 history 命令模式执行；**不得**从同步上下文 `tokio::spawn`、不得在 coordinator 线程 `block_on`（CLAUDE.md 运行时规则）。
- 读侧一律 `busy_timeout` 5s 的短连接（沿 pipeline_log.rs:55-59 / llm_metrics.rs:86-90 既有模式），查询失败返回错误给前端空态，不 panic。
- specta：新增返回类型全部 derive `specta::Type`，命令挂入 lib.rs `collect_commands!`（:464），`src/bindings.ts` 重生成。
- i18n 文案进 `src/i18n/locales/{en,zh}/translation.json`，不硬编码。
- **迁移协调（同批评审预警）**：本 spec 与 experience-card-engine 均向 history.rs MIGRATIONS 数组**尾部追加**，协调策略见已定决策，禁止在既有条目间插入。
- 提交前消除所有编译 warning。

## 已定决策

- **扩展 `pipeline_decisions`，不新增 step 级表。** 本 spec 唯一 schema 变更 = `ALTER TABLE pipeline_decisions ADD COLUMN intent_raw_response TEXT;`。理由：votype 的 pipeline 是**固定 4 步**结构，`pipeline_decisions` 一行按列即与步骤一一对应（history*hit/elapsed → intent*_ → model*selection/selected*_ → result*type/error*\*），时间轴五张卡片是**读侧组装**问题，不是写侧结构问题；盘点后唯一缺失的数据就是 intent 原始输出。不选 step 级表（trace-recorder 的 jsonl 类比）：那种 append-only 变长轨迹适合步数不定的 agent 执行，落到 votype 意味着 4 个步骤各加一个写点、4 个新失败面、读侧还要 JOIN 重建——为已有单行结构付出通用性代价，违反 YAGNI。

- **intent 原始输出的捕获点 = `execute_smart_action_routing`（routing.rs:39），解析成败都带回。** 改其返回值为携带 `raw_response: Option<String>`（截断后）的结构（如 `IntentRoutingOutcome { decision: Option<IntentDecision>, raw_response: Option<String> }` 或等价形式），pipeline.rs 在两处 intent 填充点（:305-310、:361-362 一带）及解析失败回退分支写入 `decision.intent_raw_response`。理由：解析失败的样本（markdown 包裹、非法 JSON、跑飞长文）恰是 prompt 调优价值最高的部分，只在成功路径留存等于把最需要的样本继续丢掉；捕获为纯旁路，`.ok()?` 的回退行为不变。skill routing / rewrite 的 raw 输出不在本期（见排除范围）。

- **读侧 = 单条组装命令 `get_pipeline_trace(history_id) -> PipelineTrace`，放 commands/history.rs。** 后端一次组装三源数据，前端不做多命令拼接：
  - `decision: Option<PipelineDecisionView>` —— `pipeline_decisions` 中该 history_id 的**最新一行**（`ORDER BY id DESC LIMIT 1`，与 error indicator 取最新先例一致，history.rs:589-596），含全部步骤列 + `intent_raw_response`；
  - `llm_calls: Vec<LlmCallView>` —— `llm_call_log` 中该 history_id 的全部行（按 id ASC），含 call_type/model/provider/duration_ms/tokens/tokens_per_sec/error/is_fallback/created_at；
  - `review: ReviewFeedbackView` —— `transcription_history` 的 review_action / review_edit_distance / review_selected_candidate 三列。
    不选新建 commands/pipeline_trace.rs：commands/history.rs 已有聚合 llm_metrics 读取的先例（:668/:680），新模块要动 mod.rs + lib.rs 两处 wiring，收益为零。读函数分别落在各自 manager：`PipelineLogManager::get_latest_decision_view`、`LlmMetricsManager::get_calls_for_history`、`HistoryManager::get_review_feedback`。
    润色输出**不经此命令重复下发**：前端打开视图时已持有 `HistoryEntry`（含 `post_process_history` / `post_processed_text` / `transcription_text`），复用即可。

- **前端入口 = DashboardEntryCard 动作区新增"轨迹"IconButton（仅 `expertMode` 为 true 时渲染），点击打开 `PipelineTraceDialog` 对话框。** 不选行内展开（错误面板先例）：时间轴含五张卡片 + 多段原文/输出全文，行内塞进虚拟列表（VirtualDetailsList）会把单卡撑得极高且滚动测量抖动；同目录已有 EditHistoryDialog 对话框先例。Dialog 打开时才 invoke `get_pipeline_trace`（惰性加载），关闭即弃，不缓存。

- **时间轴五张卡片的字段映射（数据源全部为已核实字段）：**
  1. **路由判定**：`input_length`、`smart_routing_enabled`、`bypass_reason`、`history_hit` + `history_elapsed_ms`、`app_name`、`has_cursor_context`；
  2. **意图原始输出**：`intent_action` / `intent_needs_hotword` / `intent_language` / `intent_model_id` / `intent_provider_id` / `intent_elapsed_ms`、`intent_overridden` + `intent_override_reason`、**`intent_raw_response` 原文**（等宽字体 + 一键复制）；`intent_action IS NULL` 且 raw 非空时显示"解析失败"徽标；
  3. **模型选择**：`model_selection`、`selected_model_id` / `selected_provider_id`、`is_multi_model`；叠加 `llm_calls` 中 `is_fallback=1` 的行提示"发生了 fallback"；
  4. **润色输出**：`result_type`、`total_elapsed_ms`、`error_type` / `error_detail`；`post_process_history` 逐步骤展示（prompt_name / model / result，先例 DashboardEntryCard:110-117）；每张 `llm_calls` 行的 duration/tokens/速度/error 作为指标行；
  5. **用户编辑**：`review_action` / `review_edit_distance` / `review_selected_candidate`、`post_processed_text` 终稿；`review_action` 为 NULL 时显示"未经 review"占位。
     卡片状态徽标沿参考实现 MemoryWindow 的 phase/outcome badge 视觉语言（成功/失败/跳过三态），但**不引入** observe/think/act/verify 四阶段模型——votype 的五步有固定业务语义，直接用业务名。

- **仅展示最新一次 run。** 同一 history_id 因"重新润色"（commands/history.rs reprocess_history_entry:562）可能有多行 `pipeline_decisions`，视图取最新一行（旧行留库不删）。不做 run 切换器：与 error indicator 的"最新决策"语义保持一致，Phase 0 复盘场景看最近一次足够（演进项见排除范围）。

- **迁移序号协调策略（回应同批评审预警）：MIGRATIONS 追加制，后合并者顺延序号。** 具体约定：
  - rusqlite_migration 的 MIGRATIONS 数组是**位置序**，本 spec 不锁定序号——只约定"向数组尾部追加一条 `M::up`，注释序号取当时 HEAD + 1"（撰写时 HEAD 为 Migration 48，history.rs:454-455）；
  - 与 experience-card-engine 并行开发时，**后合并的一方**负责把自己的条目顺延到对方之后并改注释序号；
  - 两个 spec 的语句无交叉依赖（本 spec 仅 ALTER `pipeline_decisions` 加一列；对方建新表 + ALTER `transcription_history`），任意合并顺序均可成功执行；
  - **禁止**在既有条目之间插入（已发布用户的 DB 按数组位置前进，中间插入会错位重放）。

- **不做保留期清理。** `pipeline_decisions` 现状本就无清理策略，本 spec 加的单列已截断 2000 字符，增量成本可控；统一清理策略是既有技术债，不在本 spec 顺手做（见排除范围）。

- **删除行为随现状。** history 条目删除后 `pipeline_decisions` 行成为孤儿行（现状如此），入口卡片随条目消失，视图不可达，无需级联处理。

## 边界

### 允许修改

- `src-tauri/src/managers/pipeline_log.rs`：`PipelineDecisionRecord` 加 `intent_raw_response: Option<String>` 字段；`log_decision_inner` 的 INSERT 加对应列；新增 `get_latest_decision_view(history_id)` 读函数与 `PipelineDecisionView`（derive specta::Type）
- `src-tauri/src/managers/llm_metrics.rs`：新增 `get_calls_for_history(history_id)` 读函数与 `LlmCallView`（derive specta::Type）
- `src-tauri/src/managers/history.rs`：**仅** MIGRATIONS 数组尾部追加一条 `M::up("ALTER TABLE pipeline_decisions ADD COLUMN intent_raw_response TEXT;")` + 新增 `get_review_feedback(history_id)` 小读函数与 `ReviewFeedbackView`（derive specta::Type）
- `src-tauri/src/actions/post_process/mod.rs`：intent 路由返回值结构调整（携带 raw_response）
- `src-tauri/src/actions/post_process/routing.rs`：**仅** `execute_smart_action_routing` 返回类型与 raw 捕获（含截断），解析逻辑与回退语义不动
- `src-tauri/src/actions/post_process/pipeline.rs`：**仅** intent 填充点（:305-310、:361-362 一带）及解析失败回退分支写 `decision.intent_raw_response`
- `src-tauri/src/commands/history.rs`：新增 `get_pipeline_trace` 命令与 `PipelineTrace` 组装结构
- `src-tauri/src/lib.rs`：`collect_commands!` 注册新命令
- 新建 `src/components/settings/dashboard/PipelineTraceDialog.tsx`：时间轴卡片流对话框
- `src/components/settings/dashboard/DashboardEntryCard.tsx`：expert 模式下动作区新增"轨迹"入口按钮 + Dialog 挂载
- `src/bindings.ts`：specta 重生成
- `src/i18n/locales/en/translation.json`、`src/i18n/locales/zh/translation.json`：新文案 key

### 禁止

- 修改 `unified_post_process_inner` 的 4 步路由决策逻辑、SmartAction 解析/回退语义、多模型 gate —— 本特性是观测，不是干预
- 修改 `src-tauri/src/actions/post_process/extensions.rs` —— 多模型自有 HTTP 通路是已知技术债，不扩散
- 修改 `pipeline_decisions` / `llm_call_log` **既有列**的写入语义（只加一列、只加读函数）
- 新增任何 LLM 调用、prompt 文件
- 做重放执行（用改过的 prompt 重跑 pipeline）—— 视图纯只读
- 修改 `src/review/`（review 窗口）
- 在 MIGRATIONS 既有条目之间插入迁移；修改 experience-card-engine spec 边界内的文件（managers/experience.rs 等）
- 引入新的轨迹文件存储（jsonl / 独立目录）—— 数据全部走既有 SQLite 表

## 排除范围

- **重放执行 / what-if**（改 prompt 重跑对比）—— 本期纯展示；重跑已有独立入口 reprocess_history_entry
- **经验卡片引用标注（memoryRefs 类比）** —— 后续与 experience-card-engine 的集成点：该 spec 的 `experience_card_usage (card_id, history_id)` 表已含叠加所需关联，届时在"润色输出"卡片上标注"注入经验卡片 ×N + 跳转"即可；本期两特性零代码交集，仅共享 MIGRATIONS 追加点（协调策略见已定决策）
- 实时步进推送（trace:step 事件类比）—— 视图为事后查询，打开时一次加载
- 自动回放动画 / 播放滑条（参考实现的 replay bar）—— 静态时间轴卡片流已满足复盘诉求
- 多次 run 的切换器（仅最新 run；旧行留库）
- skill routing / voice rewrite 的原始输出留存（本期只补 smart routing intent）
- multi-model 候选**全文**落库与展示（候选文本现状不持久化，仅 llm_call_log 指标行 + review_selected_candidate）
- 意图 system prompt 快照留存（prompt 版本漂移追溯）—— 演进项
- `pipeline_decisions` / `llm_call_log` 统一保留期清理策略 —— 既有技术债，另立议题
- 跨条目聚合分析（路由命中率报表、错误趋势）
- 轨迹导出（JSON/CSV）
- 非 expert 模式的任何入口（含快捷键、右键菜单）

## 验收场景

### 1. happy_path_full_polish_five_cards

- **Given**: `expert_mode=true`；一条经 smart routing → FullPolish 的转写：`pipeline_decisions` 有该 history_id 的行（intent_action='FullPolish'、`intent_raw_response` 非空、selected_model_id 非空、result_type='SingleModel'）；`llm_call_log` 有 call_type='intent' 与 'single_polish' 各一行；`post_process_history` 有一个步骤；用户在 review 窗口接受（review_action='accept'）
- **When**: Dashboard 中该条目的动作区点击"轨迹"按钮
- **Then**:
  - 打开 PipelineTraceDialog，自上而下渲染五张卡片：路由判定 / 意图原始输出 / 模型选择 / 润色输出 / 用户编辑
  - 意图卡片显示 intent 模型输出的**原始 JSON 文本**、intent_action、耗时（intent_elapsed_ms）、模型与 provider
  - 润色卡片显示 post_process_history 的 prompt_name/model/result 与 llm_call_log 的 duration/tokens/速度指标行
  - 用户编辑卡片显示 review_action='accept'、终稿文本
  - 全程仅发生一次 `get_pipeline_trace` invoke，无任何 LLM 调用发生（`llm_call_log` 行数不变）

### 2. edge_non_expert_mode_entry_hidden

- **Given**: `expert_mode=false`；同上有完整轨迹数据的条目
- **When**: 进 Dashboard 查看该条目卡片
- **Then**:
  - 动作区**不渲染**"轨迹"按钮，卡片其余动作（Insert/Edit/⚠️ 等）与现状完全一致
  - 打开设置把 expert 模式开关打开后回到 Dashboard → 按钮出现，无需重启

### 3. error_path_db_write_failure_fail_open

- **Given**: pipeline run 结束时 `pipeline_decisions` 写入失败（如 DB 被锁超过 busy_timeout / 磁盘只读）
- **When**: 一次正常转写 + 润色流程执行
- **Then**:
  - 润色结果照常产出并粘贴，用户可感知流程**零变化**（fail-open）
  - 日志出现 `[PipelineLog] Failed to log decision` 记录
  - 之后打开该条目的轨迹视图 → 显示"该条目无 pipeline 轨迹数据"空态（decision 为 null），不报错、不白屏

### 4. edge_intent_parse_failure_raw_retained

- **Given**: intent 模型返回 markdown 代码块包裹的非法 JSON，routing 解析失败、pipeline 按既有语义回退 FullPolish
- **When**: run 结束落库后打开该条目的轨迹视图
- **Then**:
  - `pipeline_decisions.intent_raw_response` 存有截断后的原始返回文本，`intent_action` 为 NULL
  - 意图卡片显示"解析失败"徽标 + 原始输出全文（可复制）
  - 路由行为与改动前完全一致（仍 FullPolish，产出正常）——捕获是纯旁路

### 5. edge_old_entry_no_decision_row

- **Given**: `expert_mode=true`；一条早于 migration 40 的旧 history 条目（或 post_process_enabled=false 时产生的 Skipped 条目），`pipeline_decisions` 无对应行
- **When**: 点击其"轨迹"按钮
- **Then**:
  - Dialog 打开并显示"该条目无 pipeline 轨迹数据"空态文案（i18n），不崩溃
  - 若该条目仍有 `llm_call_log` 行或 review 反馈，对应卡片降级展示已有部分，缺失步骤显示占位

### 6. edge_multi_model_and_rerun_latest

- **Given**: 一条 history 先走了 multi-model run（3 个候选，llm_call_log 有 3 行 call_type='multi_model'，用户选中候选 → review_selected_candidate 非空），随后用户"重新润色"产生第二行 `pipeline_decisions`（单模型）
- **When**: 打开轨迹视图
- **Then**:
  - 视图展示**最新一次** run（单模型）的决策卡片
  - 润色卡片的指标区仍列出该 history_id 全部 llm_call_log 行（含 3 行 multi_model 的模型/耗时/速度/错误），候选全文不展示
  - 用户编辑卡片显示 review_selected_candidate 原值

### 7. edge_intent_raw_truncated_at_2000_chars

- **Given**: intent 模型跑飞输出 10000 字符（含多字节中文）
- **When**: run 落库
- **Then**:
  - `intent_raw_response` 恰好存前 2000 个**字符**（非字节），无 UTF-8 截断 panic
  - 轨迹视图意图卡片显示截断提示（"已截断至 2000 字符"）
  - 主流程与路由行为不受影响

### 8. typescript_types_synced

- **Given**: 后端新增 `get_pipeline_trace` 命令与 `PipelineTrace` / `PipelineDecisionView` / `LlmCallView` / `ReviewFeedbackView` 类型
- **When**: 运行 `bun tauri dev` 触发 specta 重生成，随后 `bun run build`
- **Then**:
  - `src/bindings.ts` 出现 `getPipelineTrace` 命令与上述类型定义
  - `bun run build` 无 TS 错误；`cargo build` 无 warning

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |

## 待用户确认

1. **视图容器：Dialog vs 行内展开。** spec 采用 Dialog（EditHistoryDialog 先例，时间轴内容高、行内塞虚拟列表体验差）；若你更倾向与错误面板一致的行内展开，请指出，改动仅限前端。
2. **`intent_raw_response` 截断上限 2000 字符是否合适。** 正常 intent 输出 <200 字符，2000 为模型跑飞兜底；若你希望完整留存（不截断）或更小上限，请拍板。
3. **仅展示最新一次 run 是否可接受。** 重新润色后旧 run 的行仍在库但 UI 不可见；如果 prompt 调优时你需要对比同一条目的多次 run，run 切换器需从排除范围提入 Phase 1。
4. **与 experience-card-engine 的合并顺序。** 两 spec 迁移无交叉依赖、任意顺序可合并，已约定"后合并者顺延序号"；如果你希望固定先后（例如经验卡片先行），请指定，避免两个分支同时 rebase。
