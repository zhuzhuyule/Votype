# auto-reply 机制借鉴迁移路线图

> **⚠️ 本轮仅完成设计，未写任何实现代码。下列 5 份 spec 全部处于"已定稿、待用户确认"状态，所有实现工作在用户对第 6 节的问题清单逐条拍板之后才启动。**

- 日期：2026-07-18
- 关联 spec：`docs/specs/2026-07-18-*.spec.md`（5 份，均已定稿）
- 本文性质：迁移路线图（实施顺序 / 依赖协调 / 待拍板清单），不含新增设计决策

---

## 1. 背景

DreDabe/auto-reply 是一个基于 VLM 的桌面自动回复系统：它用视觉模型读屏、以 RPA 方式驱动 IM 客户端完成自动回复。我们分析后的结论是——**其视觉 RPA 路线不借鉴**（Votype 的输入是语音而非屏幕，且视觉驱动脆弱、维护成本高），但其若干**机制设计**在同类桌面 agent 产品中已被验证清晰可维护，值得移植到 Votype 的 manager + rusqlite + PromptBuilder 架构中：经验沉淀三件套（experience-store / learn-from-session / buildMemorySection）→ 经验卡片引擎；轨迹五元组 + fail-open 记录器 + 时间轴 UI（trace-types / trace-recorder / MemoryWindow）→ Pipeline 轨迹回放；三级自动回复优先级（全局 / 模式 / 对象，"具体覆盖一般"+ 单点解析）→ 统一策略层级；ProviderBundleManifest 的声明式 provider 元数据（剔除其动态代码加载）→ Provider Manifest 化；skill-server 的 status/start/pause 克制三端点 + SKILL.md → 本地 API Agent Skill 化（并剔除其 `Access-Control-Allow-Origin: *` 反面教材）。本轮已为这 5 项各产出一份完整 spec 并全部定稿。

## 2. 迁移项总表

| #   | 迁移项                      | 优先级                                     | 工时估算 | 关键依赖                                                                                                                                 | Spec                                                                             |
| --- | --------------------------- | ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | 经验卡片引擎                | **P1**                                     | 3-5 天   | **DB 层 WAL P0 修复须先行**（归纳统计 / usage 写入全走阻塞连接）；review 反馈列、`update_reviewed_text`、PromptBuilder system 层追加先例 | [experience-card-engine](../specs/2026-07-18-experience-card-engine.spec.md)     |
| 2   | Pipeline 轨迹回放调试视图   | **P2**                                     | 2-3 天   | `pipeline_decisions` / `llm_call_log` / review 三列已落库；expert_mode gate 先例；与 #1 共享 history.rs MIGRATIONS 追加点（零代码交集）  | [pipeline-trace-replay](../specs/2026-07-18-pipeline-trace-replay.spec.md)       |
| 3   | 统一润色策略层级            | **P2**                                     | 2-3 天   | AppProfile / TitleRule / app_category 七类映射已存在；无 LLM、无 DB，纯函数重构 + parity 测试                                            | [unified-policy-hierarchy](../specs/2026-07-18-unified-policy-hierarchy.spec.md) |
| 4   | Provider 元数据 Manifest 化 | **P3**                                     | 2-3 天   | 模型目录外置先例（catalog.json, commit 711b274c）；无 P0 依赖                                                                            | [provider-config-schema](../specs/2026-07-18-provider-config-schema.spec.md)     |
| 5   | 本地 API Agent Skill 化     | **P3**（但 **Phase A 安全加固实质为 P0**） | 2-3 天   | Phase A（CSPRNG key + opt-in 默认）是 Phase B/C 的硬前置，两个独立 PR 交付                                                               | [local-api-agent-skill](../specs/2026-07-18-local-api-agent-skill.spec.md)       |

## 3. 建议实施顺序（交叉评审共识）

以下顺序为 5 份 spec 交叉评审后的共识结论，实施时直接采用：

1. **第一位：local-api-agent-skill 的 Phase A（CSPRNG key + opt-in 默认）。**
   理由：它就是 2026-07 全项目审查"本地 server 弱鉴权 / 明文密钥、默认开启"这条 **P0 的载体**——弱 key（SHA256 可推测输入截 29 字符）与 server 默认开启是审查确认的在线漏洞，修复不等待任何功能排期；且它与其余 4 份 spec **零文件交集**（只动 openai_api_server.rs / settings.rs 一行默认值 / settings_cmds.rs / Cargo.toml / AdvancedSettings.tsx），可独立 PR 即刻先行合入。其 **Phase B/C（skill 化：`/skill/*` 端点 + SKILL.md）按 P3 押后**，且不得先于 Phase A 合并——不允许在弱 key 状态下上线新的麦克风控制面。

2. **第二位：unified-policy-hierarchy。**
   理由：纯函数重构（`policy_resolver.rs` 同步纯函数 + parity 单测护栏），**无 LLM、无 DB**，不受 WAL P0 修复排期影响；同时它收敛的是 4 处已发生行为漂移的解析逻辑，越早收敛、后续每加一个策略维度的成本越低。

3. **experience-card-engine 必须排在 DB 层 WAL P0 修复之后。**
   理由：其归纳统计与 usage 写入**全部走阻塞连接**（当前 `get_connection` 每次 `Connection::open` + 5s busy_timeout）。spec 虽已用 fire-and-forget + 小查询设计解除硬依赖，但若在 WAL 修复前落地，热路径 DB 行为将二次变化、排障归因困难。作为本批唯一 P1 项，建议紧随 WAL 修复后启动。

4. **provider-config-schema 与 pipeline-trace-replay 无 P0 依赖，可灵活穿插**在上述节点之间填充排期。唯一约束：trace-replay 与 experience-card-engine 共享 history.rs MIGRATIONS 追加点，若并行开发须遵守第 4 节的迁移协调约定。

### P0 搭车关系一览

| 全项目审查 P0 项              | 本批次的搭车 / 依赖关系                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 本地 server 弱鉴权 / 默认开启 | **由 local-api-agent-skill Phase A 直接承载修复**（CSPRNG ≥128 bit、legacy key 升级即轮换、opt-in 默认、开关即启动、摘要比较） |
| DB 层阻塞无 WAL               | **experience-card-engine 的排期前置条件**；trace-replay 只加一列一读命令，不受阻塞                                             |
| 明文密钥存储                  | 不在本批范围（local-api spec 威胁模型中已诚实声明，加密存储另立议题）                                                          |

## 4. 共享基建与冲突协调

### 4.1 settings.rs 是唯一共同热点

四份 spec 都要动 `src-tauri/src/settings.rs`，但各自只碰互不重叠的字段：

| Spec                     | settings.rs 改动                                                               |
| ------------------------ | ------------------------------------------------------------------------------ |
| experience-card-engine   | 新增 `experience_cards_enabled`（serde default = true）                        |
| unified-policy-hierarchy | 新增 `CategoryPolicy` 结构体与 `category_policies` 字段（`#[serde(default)]`） |
| provider-config-schema   | `default_post_process_providers()` 改为 provider_catalog 驱动                  |
| local-api-agent-skill    | `default_openai_compatible_api_enabled()` 返回值 `true` → `false`              |

并行开发会产生**平凡但必然的合并冲突**。协调策略：**串行合并，或严格按字段分区各自改动、互不触碰对方行**；rebase 时以字段为单位机械合并即可，不存在语义冲突。

### 4.2 history.rs MIGRATIONS 协调（experience-card ↔ trace-replay）

两份 spec 都向 `history.rs` 的 MIGRATIONS 数组追加迁移（experience 建新表 + ALTER `transcription_history`；trace-replay 仅 ALTER `pipeline_decisions` 加一列），语句无交叉依赖，任意顺序可合并。三条铁律（trace-replay spec 已固化）：

1. **追加制**：只向数组尾部追加，注释序号取当时 HEAD + 1（撰写时 HEAD 为 Migration 48）；
2. **后合并者顺延序号**：并行开发时，后合并的一方负责把自己的条目顺延到对方之后并更新注释序号；
3. **禁止在既有条目间插入**：rusqlite_migration 按数组位置前进，中间插入会使已发布用户的 DB 错位重放。

### 4.3 三条"建议 → 确认"通道：沿用心智、统一 status 字符串

项目内现存 / 即将存在三条同构的建议确认通道：

1. hotword 的 suggested → active（`managers/hotword.rs` `accept_suggestion`）；
2. app-rule suggestion 的建议对话框（`managers/suggestion_engine.rs`）;
3. experience cards 的 suggested 面板（本批新增，`'suggested' | 'active' | 'disabled' | 'dismissed'`）。

评审结论：**有意沿用同一用户心智，不抽共享确认框架**（三者数据模型、确认粒度、UI 形态各异，抽象收益小于成本，YAGNI）。但要求**统一 status 字符串集**——三条通道的状态字面量收敛为同一组词汇（`suggested` / `active` / `disabled` / `dismissed`），新代码不得另造 `pending` / `confirmed` / `ignored` 等同义变体，避免未来做跨通道统计或统一面板时出现字符串方言。

## 5. 附带工艺改进（不立 spec 的两个小项）

以下两项为借鉴 auto-reply 的横切工艺改进，体量小、不值得立 spec，随相关代码被触碰时顺手落地：

### 5.1 前台应用轮询器采用渐进退避

参考 auto-reply 的 **5s → 60s 指数退避**与**分层检测**（便宜检查在前、昂贵确认在后）：前台应用轮询在焦点长期不变时逐级拉长间隔（焦点切换事件到来即重置回最小间隔），且每轮先做便宜的进程名 / bundle id 比对，仅在便宜检查发现变化时才执行昂贵的窗口标题读取与类别解析。目标是把常驻后台的空转成本压到接近零。

### 5.2 全部遥测 / 日志落库路径遵循 fail-open 原则

`PipelineLogManager::log_decision` 吞错只打日志的语义（pipeline_log.rs:61-65）确立为**全项目遥测落库的统一原则**：`pipeline_decisions`、`llm_call_log`、`experience_card_usage` 及未来一切观测类写入，**写入失败只打日志，绝不影响主流程**——不重试、不上抛、不阻塞转写 / 润色 / paste 路径。本批两份 spec（trace-replay 的 `intent_raw_response` 落库、experience-card 的 usage fire-and-forget）均已按此原则设计，后续新增观测写入点一律对齐。

## 6. 待用户确认问题汇总（共 10 项）

以下逐条抄录自 5 份 spec 的"待用户确认"节，**这是用户下一步的拍板清单**。确认结果请回写各 spec。

### 来自 [experience-card-engine](../specs/2026-07-18-experience-card-engine.spec.md)（1 项）

1. **实施排期是否置于 DB WAL P0 修复之后。** 2026-07 全项目审查已将"DB 层阻塞无 WAL"列为 P0；架构评审建议本 spec 排在其后。本 spec 已通过 usage fire-and-forget 与小查询设计解除硬依赖，先做也可行，但若 WAL 修复临近，建议顺序执行以免热路径 DB 行为二次变化。请拍板先后顺序。

### 来自 [pipeline-trace-replay](../specs/2026-07-18-pipeline-trace-replay.spec.md)（4 项）

2. **视图容器：Dialog vs 行内展开。** spec 采用 Dialog（EditHistoryDialog 先例，时间轴内容高、行内塞虚拟列表体验差）；若更倾向与错误面板一致的行内展开，请指出，改动仅限前端。
3. **`intent_raw_response` 截断上限 2000 字符是否合适。** 正常 intent 输出 <200 字符，2000 为模型跑飞兜底；若希望完整留存（不截断）或更小上限，请拍板。
4. **仅展示最新一次 run 是否可接受。** 重新润色后旧 run 的行仍在库但 UI 不可见；如果 prompt 调优时需要对比同一条目的多次 run，run 切换器需从排除范围提入 Phase 1。
5. **与 experience-card-engine 的合并顺序。** 两 spec 迁移无交叉依赖、任意顺序可合并，已约定"后合并者顺延序号"；如希望固定先后（例如经验卡片先行），请指定，避免两个分支同时 rebase。

### 来自 [unified-policy-hierarchy](../specs/2026-07-18-unified-policy-hierarchy.spec.md)（2 项）

6. **clipboard 大小写统一的"修复即变化"（决策 8）。** 存量用户中 app 名大小写与 `app_to_profile` 键不匹配者，升级后 `disable_selection_clipboard_fallback` 将从静默失效变为突然生效。推荐：**接受**——这是配置本意，且为该 spec 唯一有意行为修正，已由验收场景 5 固化并要求显式记录。
7. **类别 prompt 下拉排除哨兵 prompt（决策 11）。** Phase 0 不允许在类别层选择 `__PASS_THROUGH__` / `__LITE_POLISH__`，resolver 对手改注入的哨兵值按未配置处理。推荐：**接受排除**——零成本且不阻塞任何 Phase 0 场景；放开留待 Phase 1 验证 routing.rs:1057 通路后再议。

### 来自 [provider-config-schema](../specs/2026-07-18-provider-config-schema.spec.md)（2 项）

8. **Phase 0 范围裁剪。** 草稿标题所指的 config_schema / SchemaConfigForm（M2）已按评审 YAGNI 意见整体移入排除范围，本期只交付"元数据 manifest 外置 + 前端换数据源"。推荐接受裁剪（声明价值已完整交付，schema 留待首个异构 provider 出现时 bump api_version 引入）；若仍希望本期落地 schema 表单，请明示。
9. **内置名单是否维持现状。** 推荐维持——openai/anthropic/custom/iflow/gitee 预装不可删、openrouter/zai 预装可删，iflow 仅补齐前端展示元数据修复漂移。替代方案（iflow 降级为普通可删模板）会改变老用户的 ensure 补齐行为，不推荐。

### 来自 [local-api-agent-skill](../specs/2026-07-18-local-api-agent-skill.spec.md)（1 项）

10. **Phase A 是否物理拆分为独立 spec 文件。** YAGNI 评审要求把安全修复拆成独立 spec 先行合入。本次修订受"只落盘一个 spec 文件"的约束，改为在该 spec 内以两阶段 / 两 PR（Phase A 先行合入、Phase B/C depends_on Phase A）承接其实质。若希望严格执行"独立 spec 文件"，需另行把 Phase A 部分（决策 1-5 + 场景 1/2/4/8 + 对应边界）抽出为 `docs/specs/2026-07-18-local-api-security-hardening.spec.md` 并调整原文件 depends_on 指向它——内容无需重写，纯文件拆分。

## 7. 声明

**再次强调：本轮工作到此为止只有设计产出（5 份 spec + 本路线图），没有任何代码改动。所有 spec 须待用户对第 6 节的 10 个问题逐条确认后，方可按第 3 节的顺序进入开发。**
