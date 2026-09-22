---
name: "Vokie 能力迁移（总纲）"
tags:
  [
    migration,
    vokie,
    benchmark,
    roadmap,
    insert-reliability,
    context,
    engine,
    ecosystem,
  ]
depends_on:
  - "docs/specs/2026-09-22-upstream-v097-migration.spec.md（Handy 上游总纲，E 期与其 Phase 3/5 有交叉）"
  - "docs/specs/2026-09-22-prompt-robustness-system.spec.md（C 期主线）"
  - "docs/specs/2026-07-18-local-api-agent-skill.spec.md（F1 主线）"
  - "竞品情报：Vokie.app 1.5.23 解包分析（2026-09-22，会话记录）"
estimate: "分 6 期，A/B 各 1-2d，C 见其总纲，D 2-3d，E 取决于上游排期，F1 见其 spec"
---

## 意图

"把竞品 Vokie（com.vokie.desktop 1.5.23，Electron）经市场验证的能力逐项映射进 Votype，按**依赖栈分层**分期迁移：插入可靠性 → 上下文注入 → 表达契约 → 学习闭环 → 流式引擎 → 生态场景。每期登记'新增还是替换哪个组件'与状态标记，使任何时刻可以说清'迁移到哪一期'，并让该替换的大组件（AX 快照、流式引擎、声纹分离）在明确期数暴露，而不是散落在必改路径里。"

排序说明：Vokie 闭源且更新 feed 只暴露最新版，无法逐版本回溯；但其能力间的依赖关系清晰（没有 AX 快照就没有光标上下文；没有稳定插入谈不上学习闭环），按依赖栈推进即等价于按它的产品演化顺序推进，且每期独立可验证。

与上游 Handy 总纲的关系：两份总纲**并行不合并**——上游是"别人已替我们踩坑的实现"，Vokie 是"竞品验证的产品形态"。交叉点在各期"衔接"字段中显式声明，冲突时上游实现优先（有真实用户验证），Vokie 参考补设计细节。

## 约束

- 遵守 CLAUDE.md 全部 runtime rules 与 spec 模板规范。
- 每期独立 PR、独立可回滚；状态标记只增不删（阻塞写 ⏸ + 原因）。
- **不引入云端 prompt 托管 / prompt_refs / 账号额度体系**——BYO-LLM + 本地可审计是 Votype 立场（prompt-robustness spec 已定，此处重申为总纲级禁令）。
- 禁止在迁移中顺带重构无关模块。
- Vokie 侧任何实现细节以本仓库可验证的行为为准（解包证据：`app.asar` 抽取、`runtime/two_pass_asr --help`、`Resources/` 目录），不照抄无法验证的猜测。

## 已定决策

1. **总纲分 6 期按依赖栈排序**，而非按投入产出比混排：A 插入可靠性是 B/D 的前置，C 是 D 的下游（学习闭环产物要喂给契约的 asr-corrections 槽）。
2. **E 期流式引擎采纳上游 Phase 5 为主路径**（transcribe-cpp 0.2.3 StreamRouter，GGUF Whisper streaming），Vokie two-pass（sherpa 流式 Zipformer 一遍 + SenseVoice 二遍）**不排他**：其一遍/二遍模型作为引擎类型后续并入 catalog（transcribe-rs onnx 侧），NDJSON 事件协议与 segment 时间戳结构用于定义 `stream-text-event` payload。替换对象显式登记：`transcribe-cpp 0.1.3 → 0.2.3` + `realtime_worker_loop 伪流式 → 引擎级流式（保留为回退）`。
3. **D 期先审计后动工**：Votype 已有 VocabularyManager（edit diff/候选记录/phonetic_similarity）、cluster_feedback、daily_vocabulary、suggestion_engine——学习闭环并非从零造，缺口（影子模式、晋升规则、候选→asr-corrections 供料）以审计结论为准。
4. **"明确不迁移"清单为终局决策**，重开需新 spec 推翻并在此登记。

## 分期清单（状态即定位）

> 状态图例：⛔ 未开始 · 🚧 进行中 · ✅ 完成 · ⏸ 阻塞（附原因） · ➖ 不做

| 期  | 名称                     | 状态                       | 新增 / 替换组件                                                          |
| --- | ------------------------ | -------------------------- | ------------------------------------------------------------------------ |
| A   | 插入可靠性地基           | ✅ A1 · ✅ A2（B 期解锁）  | insert_guard + ax_snapshot 已交付；paste_tx receipt 校验并入上游 Phase 3 |
| B   | 上下文注入               | ⛔ 依赖 A2                 | prompt_builder 光标元数据槽                                              |
| C   | 表达契约与 prompt 鲁棒性 | 🚧 spec 已立               | 契约 fragment 文件组 + evals/ harness + prompt_tier                      |
| D   | 学习闭环                 | ⛔ 先审计                  | 扩展现有 vocabulary/suggestion，无新大组件                               |
| E   | 流式识别引擎             | ⏸ 等上游总纲 Phase 5 排期 | **替换 transcribe-cpp 0.1.3→0.2.3**；two-pass 为后续引擎位               |
| F   | 生态与场景               | ⛔ F1 已有 spec 待实施     | votype CLI + service.json + deep link；声纹分离为独立大组件              |

### Phase A — 插入可靠性地基

| 项                   | 参考                                                                                                     | 说明                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 应用插入黑名单    | Vokie `Resources/config/app-blacklist.json`（version + 双平台 exact/regex）                              | 命中即**不模拟输入**：文本入剪贴板 + toast 提示用户手动粘贴。纯函数 matcher，内置默认清单（终端、密码管理、微信、Office 等）+ `~/.votype/` 用户覆写文件。落点：外部插入唯一汇聚函数 `clipboard::paste`                                                                                                                                   |
| A2 AX 可编辑文本快照 | Vokie `native/editable-text-snapshot`（fullText/selectedRange/elementId，失败返回 `no_focused_element`） | ✅ 已交付：`ax_snapshot.rs`（状态码与 Vokie 七态对齐、可编辑 role 白名单、AXUIElementGetHash 元素身份、UTF-16→char 偏移修正）；`get_cursor_context` 改为快照适配，失败返回结构化 code。`get_selected_text` 保留 AX+剪贴板回退链不动。衔接：上游总纲 Phase 3 paste_tx 的 receipt 校验以 A2 快照为"插入前状态"，两案在 paste_tx 落地时合并 |
| A3 无焦点剪贴板回退  | —                                                                                                        | ✅ 已完成（91f849ca），登记为 A 期既得项                                                                                                                                                                                                                                                                                                 |

### Phase B — 上下文注入（依赖 A2）

| 项                       | 参考                                                                                         | 说明                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B1 光标元数据入 prompt   | Vokie `buildCloudContextPrompt` 光标块（窗口标题/文件路径/languageId/项目名/URL）            | CursorContext 扩展字段 → prompt_builder 新增 `{{cursor-metadata}}`；IDE 场景对术语保留与热词命中有直接收益 |
| B2 场景→版式强度默认映射 | Vokie `resolveLayoutIntensityHint`（email/document/ide/ai→aggressive，browser→conservative） | 并入 C 期 contract 装配，作为 FullPolish 的 structure 目标默认值，不提供独立 UI                            |

### Phase C — 表达契约与 prompt 鲁棒性

主线即 `2026-09-22-prompt-robustness-system.spec.md`（两层契约 → evals harness → prompt_tier 探测 → prompt_hash 统计），本总纲只登记其吸收的 Vokie 素材：

- 契约文案三条硬规则（语义保留清单、精确输入保护、最终状态约束）与档位继承表述 → contract_core；
- 双轴命名（wording × structure）→ fragment 命名空间预留；九宫格 UI 仍在其排除范围，C 完成后另立 spec；
- **不迁移**：prompt_refs 云端托管、探测自动后台化。

### Phase D — 学习闭环（先审计后动工）

| 项               | 参考                                                            | 说明                                                                            |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| D0 缺口审计      | 现有 vocabulary.rs / cluster_feedback.rs / suggestion_engine.rs | 输出"已覆盖 vs 缺口"清单，D1-D3 依结论裁剪                                      |
| D1 影子模式      | Vokie smartLearningShadow"只观察，不写入"                       | 学习候选只记录不生效，用户可见其效果后再开自动应用                              |
| D2 候选晋升规则  | Vokie PromotionService（weight 60 起）+ analyzeEditFeedback     | 高频"错→对"对晋升为 asr-corrections 供 C 期契约消费                             |
| D3 META 单轮合并 | Vokie 润色单次调用同时返回 scene/contextHotwords                | intent 分类 + 润色合并为一轮（轻量模型），省一跳延迟；须过 evals 回归后才切默认 |

### Phase E — 流式识别引擎（衔接上游总纲 Phase 5）

- 主路径：上游 transcribe-cpp 0.2.3 StreamRouter（tentative/committed 事件、finalize、失败回退 batch）。本总纲不重复排期，只登记依赖。
- Vokie 素材采纳：① NDJSON 事件形状（ready/log/error/first-pass/result + sessionId + start_ms/end_ms segments）→ `stream-text-event` payload 设计评审输入；② 低 CPU 单模型档（`--single-model-streaming` 滚动提交 + 解码窗口上限）→ catalog 模型能力位候选；③ 后续将 sherpa 流式 Zipformer 一遍 + SenseVoice 二遍作为第二引擎槽接入。
- 显式替换登记：transcribe-cpp 版本；realtime_worker_loop 降级为回退路径。

### Phase F — 生态与场景

| 项                     | 参考                                                                                                                | 说明                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| F1 Agent skill 化      | 主线 2026-07-18 spec（安全修复 Phase A 先行）+ Vokie transcribe-skill 形态                                          | 补吸收：PATH 安装 `votype` 命令（借 app 自带运行时）、`service.json` 端口发现、`{{CHANNEL_*}}` 多渠道模板变量               |
| F2 深链                | Vokie `vokie://` URL scheme                                                                                         | `votype://`（触发听写/打开页面），Tauri deep-link 插件，小项                                                                |
| F3 长录音 + 说话人分离 | Vokie fluidaudio-diar + two_pass_asr 声纹面（register/list/rename/unregister/threshold/identify-only，JSON stdout） | **独立大组件**：新 spec 立项。涉及 history 表 speaker 字段、模型下载类目、可能的 helper 子进程形态。市场动机：会议/访谈场景 |
| F4 场景摘要模板        | Vokie skills/{meeting,interview,podcast,training}-summary                                                           | 现有 system*summary*\* 体系的场景化扩充，低优先级顺带做                                                                     |

## 明确不迁移（终局清单）

- prompt_refs 云端托管 / prompt 热更新通道（立场冲突；迭代速度用"本地文件 + 版本感知同步"缓解，已有 PromptManager 机制）。
- 基础润色绑定自家云模型与 ai-passport 额度体系（BYO-LLM + 多模型对比是卖点）。
- BLE 外设生态（遥控器/远程麦克风）、语音表情包、同传 TTS、贴纸。
- Electron 打包相关（asar integrity、VC 运行时随包）。
- 应用黑名单的**云端下发更新**（Vokie 的 version 字段支持远更；我们用本地文件 + 发版更新，避免引入远更通道）。

## 边界

### 允许修改

按期登记，当前仅 A1 生效：

- A1：`src-tauri/src/insert_guard.rs`（新建）、`src-tauri/src/lib.rs`（mod）、`src-tauri/src/clipboard.rs`（paste 入口检查）、`src-tauri/settings.rs`（黑名单开关，serde(default)）、i18n 文案、`src-tauri/Cargo.toml`（regex，若无）
- B–F 期立项时在本节追加，未追加即禁止动。

### 禁止

- 禁止与上游总纲同分支混合提交。
- 禁止 E 期在排期未到时提前魔改 coordinator（A–D 均不依赖流式）。

## 验收场景

### 1. A1 blacklist_hit（Happy path）

- **Given**: 前台为 iTerm2（内置清单命中）
- **When**: 任一插入路径（paste/本地回退）执行
- **Then**: 不发送任何模拟按键/粘贴；文本已入剪贴板；overlay/toast 提示"该应用已列入黑名单，请 ⌘V 手动粘贴"；Rust 日志记录 `[InsertGuard]` 拦截行（注：不写 pipeline_decisions——该表语义限定为后处理管线单次运行累积器，插入守卫不属于管线步骤）

### 2. A1 user_override（Edge case）

- **Given**: 用户在 `~/.votype/app_blacklist.json` 删除了某条目并提升 version
- **When**: 对该 app 触发插入
- **Then**: 正常插入；用户文件整体生效（不做逐条 merge，避免语义漂移）

### 3. A2 no_focused_element（Error path，后续期）

- **Given**: 前台 app 无可编辑焦点元素
- **When**: A2 快照探测执行
- **Then**: 返回结构化 `no_focused_element`，插入路径据此走 A3 回退，不再只有 console warning

### 4. E stream_contract（后续期）

- **Given**: 引擎级流式启用
- **When**: 说话 3 秒
- **Then**: `stream-text-event` 携带 sessionId 与毫秒段时间戳，字段命名与本总纲 E 期登记的 NDJSON 形状一致

## 实施偏差

> 功能完成后回填。

| 原计划 | 实际实现 | 原因 |
| ------ | -------- | ---- |
| —      | —        | —    |
