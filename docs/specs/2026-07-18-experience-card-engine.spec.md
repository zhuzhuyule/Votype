---
name: "经验卡片引擎"
tags: [post-processing, memory, prompt-injection, feedback-loop, learning]
depends_on:
  - "transcription_history 已有 review_action / review_edit_distance 反馈列 (history.rs migration 39, 行 394-396)"
  - "update_reviewed_text 已捕获用户编辑前文本 original_text_for_learning (history.rs:1164, 1169)，唯一调用方为 shortcut/review_cmds.rs:117"
  - "单模型 FullPolish 执行段：unified_post_process_inner 委托 maybe_post_process_transcription (pipeline.rs:876)，PromptBuilder 链在 pipeline.rs:2284"
  - "PromptBuilder 含 resolved_references 的 system 层追加先例 (prompt_builder.rs:212 字段, :570 拼装)"
  - "execute_llm_request_with_retry 可用 (actions/post_process/core.rs:1605)"
  - "PromptManager 外置 prompt 加载 (managers/prompt.rs:78)"
  - "hotwords suggested→active 确认流先例 (managers/hotword.rs:1616 accept_suggestion)"
  - "MIGRATION_SQL 常量挂入 MIGRATIONS 先例 (history.rs:341 llm_metrics / :453 suggestion_engine)"
estimate: "3-5 days"
---

## 意图

"从用户在 review 窗口对润色结果的**真实修改**中，用单次 LLM 调用归纳出 1-3 条可泛化的『经验卡片』（scenario 触发条件 / guidance 怎么做 / rationale 为什么），每张卡片带 evidence 回溯到具体 history 条目；卡片经**用户确认**后注入单模型 FullPolish 的 system prompt；之后用同链路转写的真实编辑距离记录每张卡片的实际效果（used/success），统计在设置面板展示，供用户手动裁决停用。"

解决的问题：votype 现有学习链路（hotword / vocabulary_corrections）只能沉淀**词级**纠错对，无法沉淀"用户总是把长句拆短""在 IM 里去掉敬语""数字保留阿拉伯形式"这类**风格与判断级**偏好。用户反复做同一种编辑，系统却每次都犯同样的错。经验卡片把这类编辑模式提炼成 prompt 级指令，并记录可量化的闭环数据（注入 → 后续编辑距离），让"这条经验到底有没有用"有据可查。参考实现为 auto-reply 的 experience-store / learn-from-session / buildMemorySection 三件套，本 spec 将其适配到 votype 的 manager + rusqlite + PromptBuilder 架构。

## 约束

- 归纳信号**只用文字**：`transcription_text`（ASR 原文）、`review_pre_edit_text`（用户编辑前所见文本，本特性新增列）、`post_processed_text`（用户终稿），不传音频、不传截图。
- 归纳 prompt 外置为 `src-tauri/resources/prompts/system_experience_induction.md`，经 `PromptManager::get_prompt`（prompt.rs:78）加载，禁止硬编码在 Rust 中。
- 归纳 LLM 调用必须走 `execute_llm_request_with_retry`（core.rs:1605），并向 `llm_call_log` 记 `call_type='experience_induction'`（llm_metrics.rs `log_call`:93）。
- 归纳触发点在 `update_reviewed_text`（history.rs:1164）的 async 上下文内 spawn 后台任务——内层任务允许 `tokio::spawn`，沿用同函数内 hotword LLM 分析的既有模式（history.rs:1238）；**不得阻塞 review 保存路径**，归纳失败不影响 review 结果落库。
- 卡片注入只经 `PromptBuilder`，拼入 **system 层**（沿 `resolved_references` 追加 system 层的先例，prompt_builder.rs:212/570），不改动 user message 的 FieldTag 字段协议。
- 卡片必须用户确认后（status='active'）才参与注入；'suggested' / 'dismissed' 状态零影响输出。
- 注入预算：每次最多 **3 张**卡片、拼装段总长 **≤600 字符**（对齐 session-context 500 字符预算的同数量级）。
- **usage 记录 fire-and-forget**：润色 LLM 成功返回后经 `tokio::spawn` 异步写 `experience_card_usage`（当前 `get_connection` 每次 `Connection::open` + 5s busy_timeout，history.rs:811-815，同步写会加重 paste 延迟）；usage 写失败仅记日志，**不影响润色结果返回**。注入前的选卡为单条 ≤3 行的小 SELECT，Phase 0 接受其同步成本。
- 两处 UNIQUE 约束的插入语义均为 **INSERT OR IGNORE**：`UNIQUE(scenario, guidance)` 吸收归纳重复产出；`UNIQUE(card_id, history_id)` 吸收历史详情页"重新润色"（commands/history.rs:481-510 以同一 history_id 重走 pipeline）造成的重复注入，usage 重复时保留首行及其 outcome。
- 本特性的编辑距离一律在 `ExperienceManager` 内部对 `review_pre_edit_text` vs 终稿**现算真 Levenshtein**（O(n·m)，文本 ≤ 数千字符，后台/结算上下文可行）；**不改** history.rs 既有 `review_edit_distance` 列（history.rs:1263-1271 的对齐近似）的写入语义。
- 存储用 SQLite 新表；migration 以 `crate::managers::experience::MIGRATION_SQL` 常量挂入 history.rs 的 MIGRATIONS 列表（沿 `llm_metrics::MIGRATION_SQL` 先例，history.rs:341）。
- 卡片统计不落 counter 列，used/success 由 `experience_card_usage` 表聚合查询得出，避免计数漂移。
- 不引入定时器 / cron 基础设施；触发完全由编辑事件驱动。
- 提交前消除所有编译 warning。

## 已定决策

- **归纳 = 单次 LLM 调用 + 文字摘要。** 不做多轮 agent、不聚类多 session。输入为最多 **10 条**待归纳编辑样本的文字摘要（每条含 app_name、prompt 名、三段文本各截断 300 字符，摘要整体 ≤8000 字符，参考实现的 12k 截断策略），教练视角 prompt 要求输出严格 JSON 数组（0-3 条），容错解析沿参考实现：剥 markdown code fence、取首 `[` 至末 `]`；**解析失败视为归纳失败**（样本保留、进冷却），**合法 JSON 但 0 条视为归纳成功**（样本消费）。

- **半自动确认制：卡片落库即 'suggested'，确认后才 'active'。** 沿 hotwords 的 suggested→active 先例（hotword.rs:1616 `accept_suggestion`）。不选全自动：LLM 归纳的指令会直接改变所有后续润色输出，错误经验的伤害是持续性的，必须有人工闸门。

- **待归纳样本用独立队列表 `experience_pending_samples`，不用 history_id watermark。** 表结构：`history_id INTEGER PRIMARY KEY, created_at INTEGER`；`update_reviewed_text` 判定"有效编辑"后 INSERT OR IGNORE 入队。理由：watermark（max history_id）会永久漏掉对旧条目（id ≤ watermark）的编辑——历史详情页的通路可对任意旧条目产生反馈；队列表按"编辑事件"而非"条目 id 序"收集，天然覆盖旧条目，且归纳消费/失败保留的语义比 watermark 前移/不前移更直白。归纳时队列 JOIN `transcription_history` 取三段文本，期间被删除的条目自然掉出。

- **归纳触发 = 队列内样本 ≥ N=5，事件驱动；不做每日定时。** 理由：(1) 信号就是编辑事件，没有新编辑时定时任务纯空转；(2) 触发点 `update_reviewed_text` 天然在 async 上下文，零新增基础设施；(3) 桌面应用常年睡眠/关闭，定时器不可靠，事件驱动在下一次编辑时自然补触发。并发与冷却状态用 `ExperienceManager` 内存原子量（`AtomicBool` 单飞 + `AtomicI64` 冷却时间戳），不落表；重启后冷却清零的代价仅是持续失败场景下多一次 LLM 尝试，可接受。归纳成功后**删除本批已消费的队列行**（最旧的 ≤10 条）。

- **"有效编辑"定义：`review_action='edit_accept'` 且真 Levenshtein(`review_pre_edit_text`, 终稿) > 2 且 `review_pre_edit_text` 非空。** accept/reject 不含用户改法信息；真距离 ≤2 视为标点级微调无归纳价值；pre_edit 非空天然把样本限定在本特性上线之后。**不用**既有 `review_edit_distance` 列做该判定——其对齐位置近似在中文前部插入一字时距离 ≈ 全文长度，会把微调误判为有效样本。

- **新增列 `transcription_history.review_pre_edit_text`（TEXT, nullable），在 `update_reviewed_text` 且 `learn_from_edit=true` 且前端**显式传入** `original_text_for_learning` 时写入。** 不使用 history.rs:1198 的 DB 回退值（其注释已说明可能混入模型切换/候选选择差异）。理由：现状 `post_processed_text` 被终稿覆盖，若只用"ASR 原文 vs 终稿"做归纳，会把**润色模型的改动**与**用户不满的改动**混为一谈，教练模型无法归因；编辑前文本在该函数中已经在手，持久化只需一列一参数，是最小代价换干净信号。**生命周期**：该列是 `transcription_history` 行内列，随历史条目删除/清空自然删除，无需独立清理策略。

- **卡片 schema（`experience_cards` 表）：**
  - `id` TEXT PK（uuid）
  - `scenario` TEXT NOT NULL（触发条件，一句话）
  - `guidance` TEXT NOT NULL（怎么做，具体可执行）
  - `rationale` TEXT（为什么）
  - `source` TEXT NOT NULL DEFAULT 'induced'（Phase 0 仅此一种）
  - `evidence_history_ids` TEXT NOT NULL DEFAULT '[]'（JSON 数组，指向 `transcription_history.id`；由归纳输出的 refIds 过滤为真实存在的样本 id 后写入，UI 可据此展示"来自哪几条转写"；被指向的历史条目删除后，面板跳转显示"条目已删除"占位而非报错）
  - `status` TEXT NOT NULL DEFAULT 'suggested'（'suggested' | 'active' | 'disabled' | 'dismissed'）
  - `created_at` / `confirmed_at` INTEGER（unix 秒）
  - `UNIQUE(scenario, guidance)` + INSERT OR IGNORE 防重复落库；归纳 prompt 输入附带已有卡片清单（**含 dismissed 卡**）要求模型不重复产出（语义级去重不做，见排除范围）。

- **dismiss = 软删（status='dismissed'），不物理删除。** 理由：物理删除后下一轮归纳 prompt 的"已有卡片清单"不再含它，同样的坏经验会被反复建议；软删卡留在去重清单里 + UNIQUE 约束双重兜底。物理删除仅保留给 active/disabled 卡的手动清理；dismissed 卡 Phase 0 不在面板展示（恢复入口见排除范围）。

- **注入点 = `maybe_post_process_transcription` 的单模型执行段（pipeline.rs:2284 的 PromptBuilder 链）。** 这是日常单模型 FullPolish 的真实路径（unified_post_process_inner 在 pipeline.rs:876 委托至此）；**不选** `execute_default_polish`（routing.rs:507）——它唯一被 `execute_smart_polish` 调用，而后者唯一调用点是 pipeline.rs:1825 的"有选中文本的并行意图检测"分支，且该分支润色结果在技能命中时被丢弃，归因污染。注入 gate（全部满足才注入）：`experience_cards_enabled=true`、非 skill 模式（effective_skill_mode=false）、非 rewrite 模式（review_document_text 为 None）、`prompt.id == settings.post_process_selected_prompt_id` 且非内置哨兵（`__PASS_THROUGH__` / `__LITE_POLISH__`）。在 builder 链上新增 `.experience_cards(...)`，拼装为 system 层追加段（编号列表：`【scenario】guidance（原因：rationale）`，格式沿参考实现 buildMemorySection）。不注 LitePolish（轻量改错的"最小改动"原则与风格偏好指令冲突，且会稀释效果归因）；不注 multi-model（extensions.rs 是自有 HTTP 实现的已知债务，且多候选+用户选择使归因不清）；不注 manual / ReviewRewrite（显式指令场景，用户意图已明确）。

- **used/success 判定语义：**
  - **used**：卡片被注入且该次 FullPolish LLM 调用成功返回。`maybe_post_process_transcription` 已持有 `history_id: Option<i64>` 参数，成功后经 `tokio::spawn` 为每张注入卡片 INSERT OR IGNORE 一行 `experience_card_usage (card_id, history_id, injected_at, outcome=NULL)`，`UNIQUE(card_id, history_id)`；history_id 为 None 时跳过记录（无法归因）。
  - **success**：该 history 行后续 review 反馈为 `review_action='accept'`，或 `'edit_accept'` 且真 Levenshtein(`review_pre_edit_text`, 终稿) ≤ 2 → outcome='success'。
  - **failure**：`'edit_accept'` 且真距离 > 2 → outcome='edited'；reject（history.rs:2143 `reject_post_process_result`）→ outcome='rejected'；**cascade reject**（history.rs:2165 `cascade_reject_post_process`，经 commands/history.rs:653 暴露）→ 先 SELECT 受影响的 history_id 列表，逐个 outcome='rejected'。
  - **无反馈**（用户未走 review，`review_action` 保持 NULL）：outcome 保持 NULL，**不进成功率分母**。
  - 结算只更新 `outcome IS NULL` 的 usage 行——首个反馈定局，重复反馈不改写。
  - 结算钩子：`update_reviewed_text`、`reject_post_process_result`、`cascade_reject_post_process` 写完反馈后调用 `ExperienceManager::resolve_outcomes(...)`。

- **不做自动停用。** used/success/无反馈统计只在设置面板展示，停用完全由用户手动裁决。理由：自动停用的触发条件（resolved 样本 ≥ 阈值）在"FullPolish 单模型 + history_id 已知 + 用户走 review"的窄漏斗下数月难以达到，Phase 0 收不到能执裁的数据；拿到真实分布后 Phase 1 再定阈值（见排除范围）。

- **注入选取排序：`confirmed_at` DESC 取前 3 且拼装段累计 ≤600 字符；超预算的卡整张跳过、不截断卡内文本**（截断会破坏指令完整性）。不做成功率参与排序：Phase 0 active 卡片只会有个位数张、resolved 样本近乎为零，平滑成功率排序就是噪声排序；成功率只做面板展示。

- **确认 UI = 设置页 post-processing 分区新面板 `ExperienceCards.tsx`，不做弹窗。** 理由：卡片是多行长文本、一次可能 1-3 张、需要斟酌取舍，不适合 app-rule-suggestion 那种即时 dialog（该 spec 的实施偏差也记录了 overlay 内嵌卡片的教训）；沉淀式面板确认沿 hotword suggested 面板的用户心智。新卡产生时 emit `experience-cards-updated` 事件，面板自刷新；Phase 0 不做系统级通知。面板功能：suggested 列表（确认 / 忽略〔软删为 dismissed〕）、active/disabled 列表（停用 / 恢复 / 物理删除）、每卡展示 used / success / 无反馈计数与 evidence 条目跳转（被删条目显示占位）。

- **归纳用模型 = 当前 FullPolish 默认模型解析结果**（settings.selected_prompt_model 链路）。归纳低频（≥5 次有效编辑才一次）且质量敏感，不值得为省钱单独配模型。

- **失败与积压保护（参数为定案，实现不再另议）：** 触发阈值 **N=5**；归纳 LLM 失败或解析失败时样本**保留在队列**（下次编辑自然重试），并进 **30 分钟**冷却期，防止持续失败时每次编辑都烧一次调用；单批消费样本上限 **10 条**；suggested 积压 ≥ **20 张**时暂停归纳（日志说明），用户清理后下一次有效编辑恢复。

- **全局开关 `experience_cards_enabled`（settings.rs，serde default = true，默认开启）。** 关闭时：不注入、不写 usage、不入队、不归纳、不结算；已有卡片与统计数据保留。默认开的理由：确认制保证用户未确认前对润色输出零影响；归纳频率极低（≥5 次有效编辑才一次调用），静默 LLM 费用可忽略；而归纳建议正是功能被发现的入口——默认关则该功能对绝大多数用户永远不存在。

## 边界

### 允许修改

- 新建：
  - `src-tauri/src/managers/experience.rs`：ExperienceManager（MIGRATION_SQL 常量、卡片 CRUD、真 Levenshtein、注入选取、usage 记录与结算、样本入队与归纳触发/执行）
  - `src-tauri/resources/prompts/system_experience_induction.md`：归纳教练 prompt（严格 JSON 输出协议 + 已有卡片去重清单）
  - `src-tauri/src/commands/experience.rs`：`list_experience_cards` / `confirm_experience_card` / `dismiss_experience_card` / `set_experience_card_status` / `delete_experience_card`
  - `src/components/settings/post-processing/ExperienceCards.tsx`：确认/管理面板
- 修改：
  - `src-tauri/src/managers/mod.rs`：注册 `experience` 模块
  - `src-tauri/src/managers/history.rs`：MIGRATIONS 挂 `experience::MIGRATION_SQL`（含 `review_pre_edit_text` 列的 ALTER）；`update_reviewed_text` 写 `review_pre_edit_text`、调用 outcome 结算、样本入队与归纳触发检查；`reject_post_process_result`（2143）与 `cascade_reject_post_process`（2165）追加 outcome 结算调用
  - `src-tauri/src/actions/post_process/prompt_builder.rs`：新增 `.experience_cards(...)` 与 system 层拼装
  - `src-tauri/src/actions/post_process/pipeline.rs`：**仅** `maybe_post_process_transcription` 的单模型执行段（2100-2400 一带）——注入 gate 判定、取卡、builder 链挂 `.experience_cards(...)`、LLM 成功后 spawn 记 usage
  - `src-tauri/src/settings.rs`：新增 `experience_cards_enabled` 字段（serde default = true）
  - `src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`：注册命令、模块与 ExperienceManager state
  - `src/components/settings/post-processing/PostProcessingPanel.tsx`：挂载新面板入口
  - `src/bindings.ts`：specta 重生成
  - `src/i18n/locales/*/translation.json`：新面板文案 key

### 禁止

- 修改 `src-tauri/src/actions/post_process/extensions.rs` —— 多模型自有 HTTP 通路是已知技术债，本特性不扩散进去
- 修改 `pipeline.rs` 中 `unified_post_process_inner` 的 4 步路由决策逻辑与多模型 gate —— 注入只发生在 `maybe_post_process_transcription` 单模型执行段内部，不参与也不影响路由
- 修改 `routing.rs` —— 注入点不在 `execute_default_polish` / `execute_smart_polish`（见已定决策）
- 改变 `review_action` / `review_edit_distance` 既有写入语义（只新增列、只追加调用，不改既有赋值逻辑）
- 修改 hotword / vocabulary 既有学习链路的行为 —— 两条学习通路并存互不干扰
- 在 Rust 代码中硬编码任何归纳/注入 prompt 文本
- 引入定时任务、cron、新后台线程基础设施
- 修改 review 窗口前端（`src/review/`）—— 结算完全在后端钩子完成
- 在归纳/结算/usage 记录路径上同步阻塞 review 保存或 paste 流程

## 排除范围

- **低效卡片自动停用（low_success 阈值机制）** —— Phase 0 窄漏斗下 resolved 样本量不足以执裁，且需先验证真 Levenshtein 下的 outcome 分布；Phase 1 拿到数据后再定阈值
- LitePolish / multi-model / manual / ReviewRewrite 路径的卡片注入（评估 FullPolish 闭环效果后再议）
- 卡片与当前上下文的场景匹配（按 app/category 过滤注入）—— Phase 0 全量排序取前 3，scenario 字段由润色 LLM 自行判断适用性
- 手动新建卡片、编辑卡片文本
- 卡片语义级去重（embedding / LLM 判重）—— 仅 UNIQUE 约束 + prompt 内附已有卡片清单（含 dismissed）
- 独立归纳模型配置项 —— 归纳一律用 FullPolish 默认模型
- 新卡产生的系统级通知 / overlay 弹窗 / 设置入口徽标提醒 —— 仅 `experience-cards-updated` 事件 + 面板自刷新
- dismissed 卡的面板展示与恢复入口
- 多 session 聚类归纳、AWM 式 SOP 沉淀（参考实现的 Phase 1 方向）
- 卡片导入/导出、跨设备同步
- 归纳失败的重试队列基础设施（失败靠样本留队 + 下次编辑自然重试）
- 对无 review 反馈的转写做任何效果归因或估计
- 用真 Levenshtein 回填/修正既有 `review_edit_distance` 列

## 验收场景

### 1. happy_path_induce_and_confirm

- **Given**: `experience_cards_enabled=true`；`experience_pending_samples` 队列已有 4 条样本；无归纳任务在飞、无冷却、suggested 积压 < 20
- **When**: 用户在 review 窗口做出第 5 次有效编辑（`edit_accept`、真 Levenshtein > 2、显式传入编辑前文本），`update_reviewed_text` 落库并入队后触发归纳检查
- **Then**:
  - 后台 spawn 归纳任务，`execute_llm_request_with_retry` 调用 FullPolish 默认模型，system prompt 来自 `system_experience_induction.md`（PromptManager 加载）
  - LLM 返回 2 条合法卡片 JSON → 以 `status='suggested'` INSERT OR IGNORE 落库，`evidence_history_ids` 为过滤后真实存在的样本 history id
  - 本批已消费的 5 条队列行被删除；emit `experience-cards-updated`
  - `llm_call_log` 出现 `call_type='experience_induction'` 行
  - 设置面板出现 2 张待确认卡片；用户点确认 → 该卡 `status='active'`、`confirmed_at` 写入；此前**任何润色输出均未受这 2 张卡影响**

### 2. happy_path_inject_and_success

- **Given**: 1 张 active 卡片；下一次转写路由到单模型 FullPolish 路径（unified_post_process_inner 委托 `maybe_post_process_transcription`，pipeline.rs:876），`history_id` 已知，注入 gate 全部满足（非 skill、非 rewrite、prompt 为默认 FullPolish）
- **When**: `maybe_post_process_transcription` 单模型执行段构建 prompt（pipeline.rs:2284 builder 链）并执行
- **Then**:
  - PromptBuilder system 层出现经验段（编号 `【scenario】guidance（原因：rationale）` 格式），user message 字段协议不变
  - LLM 成功返回后经 `tokio::spawn` 异步写入 `experience_card_usage (card_id, history_id, outcome=NULL)`，润色结果返回不等待该写入
  - 用户在 review 窗口直接接受（`review_action='accept'`）→ 结算钩子把该行 outcome 更新为 'success'
  - 设置面板该卡 used=1、success=1

### 3. error_path_induction_llm_failure

- **Given**: 满足归纳触发条件，但 LLM 提供方持续 5xx（`execute_llm_request_with_retry` 重试后仍失败）
- **When**: 归纳任务执行
- **Then**:
  - 无卡片落库；队列样本**保留**（留待下次编辑自然重试）；冷却时间戳写入，30 分钟内后续编辑不再触发
  - 错误写入日志与 `llm_call_log`（error 字段非空）
  - review 保存流程不受任何影响（用户编辑已正常落库）；应用不崩溃、单飞锁正确释放

### 4. error_path_induction_parse_error

- **Given**: 归纳 LLM 返回被 markdown 代码块包裹且截断的非法 JSON
- **When**: 容错解析（剥 code fence、取首 `[` 至末 `]`）仍失败
- **Then**: 按归纳失败处理——不落库、不 emit 事件、队列样本保留、记冷却与警告日志；不重复调用 LLM。（对照：合法 JSON 空数组 `[]` 按归纳成功处理，消费队列样本）

### 5. edge_case_no_review_feedback

- **Given**: active 卡片已注入某次转写（usage 行 outcome=NULL），但用户未打开 review 窗口，文本直接粘贴，`review_action` 保持 NULL
- **When**: 之后任何结算时点
- **Then**: 该 usage 行 outcome 永久保持 NULL；设置面板计入"无反馈"计数；**不进成功率分母**

### 6. edge_case_injection_budget_overflow

- **Given**: 5 张 active 卡片，按 `confirmed_at` DESC 排序后前 2 张拼装共 480 字符，第 3 张 200 字符
- **When**: FullPolish 注入选取
- **Then**: 只注入前 2 张（第 3 张会使累计超 600 字符，整张跳过、不截断文本）；usage 只为实际注入的 2 张记行

### 7. edge_case_suggested_backlog_pause

- **Given**: suggested 卡片积压已达 20 张，队列样本已达 5 条
- **When**: 新的有效编辑触发归纳检查
- **Then**: 跳过归纳（日志说明积压暂停）、不调用 LLM、队列样本保留；用户在面板清理 suggested 至 <20 后，下一次有效编辑正常触发归纳并消费累积样本

### 8. edge_case_global_switch_disabled

- **Given**: 存在 1 张 active 卡片与 4 条队列样本，用户将 `experience_cards_enabled` 关闭
- **When**: 一次单模型 FullPolish 转写完成 + 用户随后在 review 窗口做出一次有效编辑
- **Then**:
  - 润色 system prompt **无**经验段；不写任何 `experience_card_usage` 行
  - `update_reviewed_text` 正常落库 review 反馈，但不写 `review_pre_edit_text`、不结算 outcome、不入队、不触发归纳
  - 已有卡片、usage 统计、队列样本数据全部保留；重新开启后链路恢复

### 9. edge_case_cascade_reject_resolution

- **Given**: 某 history 条目 X 存在 usage 行（outcome=NULL）；X 的 `(transcription_text, post_processed_text)` 与另外若干条目相同
- **When**: 用户在历史页触发 `cascade_reject_post_process`（commands/history.rs:653），命中包括 X 在内的多条
- **Then**: 该函数先 SELECT 受影响的 history_id 列表再置 `post_process_rejected=1`；对每个受影响 id 调用 `resolve_outcomes` → X 的 usage 行 outcome='rejected'；无 usage 行的受影响条目静默跳过

### 10. edge_case_dismissed_card_not_resuggested

- **Given**: 一张卡片被用户忽略（`status='dismissed'`，软删未物理删除）；队列again达到触发条件
- **When**: 下一轮归纳执行，prompt 的"已有卡片清单"包含该 dismissed 卡；LLM 仍产出同 `(scenario, guidance)` 的卡片
- **Then**: INSERT OR IGNORE 落库 0 行，面板不出现重复建议；dismissed 卡状态不变，不参与注入

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |

## 待用户确认

1. **实施排期是否置于 DB WAL P0 修复之后。** 2026-07 全项目审查已将"DB 层阻塞无 WAL"列为 P0；架构评审建议本 spec 排在其后。本 spec 已通过 usage fire-and-forget 与小查询设计解除硬依赖，先做也可行，但若 WAL 修复临近，建议顺序执行以免热路径 DB 行为二次变化。请拍板先后顺序。
