---
name: "上游 Handy v0.9.x 能力迁移（总纲）"
tags: [migration, upstream, engine, audio, paste, shortcut]
depends_on: [feat/transcribe-cpp-engine]
estimate: "分 6 期，详见各期"
---

## 意图

"将上游 cjpais/Handy 在 v0.8.2（我们镜像同步点 2026-03-29）至 v0.9.7（2026-09-18）之间沉淀的能力全量迁移进 Votype：低风险独立模块全部先搬（后处理健壮性、音频管线修复、可靠粘贴、VAD、快捷键交互），核心重大能力全量搬（transcribe-cpp 0.2.x 引擎级流式转录、activation 状态机），UI 仅做必要的最小改动（上游已转 React，可对照移植但不追求视觉对齐）。"

## 约束

- 遵守 CLAUDE.md runtime rules：非 async 上下文禁用 `tokio::spawn`；coordinator 线程禁 `block_on`；快捷键注册同步。
- 每期独立可验证：`cargo test`/`cargo check` 通过 + 对应验收场景，合入 dev 后再开下期。
- 上游提交仅为参考实现，移植时必须适配 Votype 的模块布局（`actions/`、`managers/`、`audio_toolkit/`）与设置体系，禁止整仓 checkout 上游文件覆盖。
- Votype 独有能力（openai_api_server、多模型对比、review window、smart routing）为不可回归项。
- transcribe-cpp 从 0.1.3 升级到 0.2.3 属于破坏性 API 变更窗口，放最后一期。

## 已定决策

- **分 6 期，按风险从低到高**：小修复 → 音频管线 → 粘贴 → VAD/交互 → 流式引擎。理由：先落地能独立验证的修复，把需要动 recorder/coordinator 骨架的改动推后。
- **UI 从简**：上游功能仅需最小前端接线（设置开关、事件监听），不做上游样式移植。理由：用户明确要求。
- **平台优先级 macOS 先行**：Votype 本地 ASR 实际仅 macOS 维护；Windows/Linux 专属修复（wtype/Enigo/registry）仅在有通用回退时顺带移植。
- **不搬项**：accessory 启动（已有）、OpenCC（已有）、filler 基础版（已有，仅做 #1738 语言门控增强）、空转录跳过（已有）、updater/sha256（已有）、API server 与文件转录（上游无）。

## 边界

### 允许修改

- 各期明细见下方"分期清单"内涉及文件；总体为 `src-tauri/src/**`、`src-tauri/Cargo.toml`、必要的 `src/` 接线与 `src-tauri/resources/prompts/`。

### 禁止

- 禁止改动 `src-tauri/src/openai_api_server.rs` 的对外协议（多客户端依赖）。
- 禁止在迁移中顺带重构无关模块（防范围蔓延）。

## 排除范围

- 上游 i18n/翻译批量提交、docs、CI/nix/AppImage 打包类提交。
- 上游 debug UI / live log viewer 的完整体验（仅 Rust 侧环形缓冲可选顺带）。
- 多声道输入通道选择（#1254）：与 Votype recorder 下混模型冲突，暂不做，留观察。

## 分期清单

### Phase 1 — 后处理与文本小修复（低风险，独立）

| 项               | 上游参考         | 说明                                                                                                           |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 重试去 reasoning | `148e5492` #1809 | LLM 400/422 时一次性去掉 reasoning 字段重试；接入 `core.rs` 与 `extensions.rs` 两条执行路径                    |
| 压缩响应修复     | `1bcbfc4c` #1548 | LLM HTTP 客户端支持 gzip/brotli 响应解压                                                                       |
| stream:false     | `2211da65`       | 后处理请求显式关闭流式，避免部分端点默认流式返回异常                                                           |
| filler 语言门控  | `4cd49950` #1738 | 双层词表（通用层 + 语言门控层，whatlang/isolang 证据链 ≥0.9 fail-closed），替换 `audio_toolkit/text.rs` 现实现 |

### Phase 2 — 音频采集管线（动 recorder，整体对齐）

| 项                       | 上游参考         | 说明                                                    |
| ------------------------ | ---------------- | ------------------------------------------------------- |
| 空闲跳过 level/resampler | `db003f38` #1873 | always-on 模式下非录音帧不做 FFT/重采样                 |
| mic level 校准           | `76b44d83` #1813 | 修平 meter 不动的问题                                   |
| 尾部音频保护             | `df216832` #1958 | stop 时冲刷重采样器残留 + VadTailReport + 加长 hangover |
| cpal 阻塞出主线程        | `b4453a29` #1716 | lock-free is_recording                                  |
| mic callback 实时安全    | `d54c88eb` #1954 | rtrb 无锁环 + capture worker（整文件级对齐）            |
| capture worker 死亡恢复  | `a4348beb` #1838 | 自动重建流                                              |
| 断连回退默认麦克风       | `c89b7bf3` #1874 |                                                         |
| 无音频录音后卸载模型     | `dc5bdc9d` #2106 |                                                         |
| 模型文件被删恢复         | `e4ae0d44` #1918 | 优雅提示 + 可重下                                       |

### Phase 3 — 可靠粘贴 `paste_tx/`

- 上游参考：`a70ac84f` #1812、`b1b2d9f9` #1847、`3ed2b219` #1231（保留非文本剪贴板内容）、`bc7facea`（paste delay 上限）。
- 移植 `TxState`/`evaluate` 平台无关核心 + macOS `NSPasteboard` 懒承诺路径；Windows 延迟渲染路径本期只做骨架。
- 与 Votype 现有 `clipboard.rs` paste-and-restore 合并，`settings.reliable_paste` 默认关、失败回退 legacy。

### Phase 4 — VAD 与快捷键交互

- earshot VAD：`20ada47d` #1967；引入 `VoiceActivityDetector` trait 抽象（若 Phase 2 后 VAD 尚无抽象层则此时补），`vad_backend: Silero|Earshot` 设置。
- compound shortcut 名称修复：`141f981d` #1862；reset binding ID 校验：`a6eed754` #2033。
- activation 状态机：`c62a5fcd` #1971（Auto PTT）+ `c6fa60da` #1910（toggle 奇偶性），对齐到 Votype `shortcut/` 与 coordinator start/stop 路径。

### Phase 5 — 引擎级流式转录（重大）

- transcribe-cpp 0.1.3 → 0.2.3（crates.io，macOS metal），适配 `Session::stream()` API 变更。
- 移植 StreamRouter：recorder 逐帧喂 16k PCM、tentative/committed 事件、finalize_stream、失败回退 batch；VAD 退化为仅控起停（Streaming policy, hangover ~1650ms）。
- 前端仅接 overlay/review 的 `stream-text-event` 展示，替换现有 realtime_worker_loop 伪流式（保留为流式模型不可用时的回退）。
- 模型能力位 `supports_streaming` 并入现有 catalog（Phase 2 GGUF 外部化目录）。

### Phase 6 — Secure Input（macOS）

- `d001fcd9` #1785 + `00d25549` #2002：轮询 `IsSecureEventInputEnabled`、占用进程定位、影子快捷键、状态事件；前端最小警告横幅。

## 验收场景

### 1. Phase 1 happy — reasoning 重试

- **Given**: 配置的 LLM 端点对 reasoning_effort 参数返回 400
- **When**: 触发后处理
- **Then**: 自动去参重试成功，llm_call_log 记录一次 fallback

### 2. Phase 2 happy — 尾音不丢

- **Given**: always-on 录音模式，句尾有 300ms 浊音
- **When**: 松开热键停止
- **Then**: 转录文本包含尾句完整词；日志无 VadTailReport 扣帧告警

### 3. Phase 3 edge — receipt 超时

- **Given**: reliable_paste 开启，目标输入框拒收粘贴
- **When**: 8s 内无 receipt
- **Then**: 剪贴板原样恢复，overlay 提示失败，不重复注入按键

### 4. Phase 5 happy — 流式部分结果

- **Given**: 选择支持 streaming 的 GGUF Whisper 模型
- **When**: 按住说话 3 秒
- **Then**: overlay 在停止前已显示 tentative 文本；停止后 committed 文本与 batch 回退路径一致可用

### 5. 回归 — Votype 独有能力

- **Given**: 任一 Phase 合入后
- **When**: 跑现有测试套件 + 手动触发 smart routing / 多模型对比 / API server
- **Then**: 行为与合入前一致

## Implementation Deviations

| Phase | 计划                                                                          | 实际                                                                                                              | 原因                                                                                |
| ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | filler 语言门控按上游用 supported_languages 目录约束 `detect_output_language` | 暂传空列表（无约束检测）                                                                                          | Votype 模型目录无逐语言 supported-languages 元数据，桥接留待 Phase 5 引擎升级时接入 |
| 1     | 上游 FillerWordRemoval 完整 UI 开关组件                                       | 仅 settings 字段 `filler_word_removal_enabled` + `change_filler_word_removal_enabled_setting` 命令，未加设置页 UI | UI 按总纲约定最小接线；开关可后续补                                                 |
| 1     | 顺带修复 dev 上已存在的 doctest 失败（phonetic_similarity 示例缺 `use`）      | 已修（1 行）                                                                                                      | 阻塞 `cargo test` 全绿验证，与 Phase 1 无逻辑关联，单独说明                         |
