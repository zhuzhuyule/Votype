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

### Phase 1 — 后处理与文本小修复（低风险，独立）✅ 已完成（e4640df3）

| 项               | 上游参考         | 说明                                                                                                           | 状态 |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| 重试去 reasoning | `148e5492` #1809 | LLM 400/422 时一次性去掉 reasoning 字段重试；接入 `core.rs` 与 `extensions.rs` 两条执行路径                    | ✅   |
| 压缩响应修复     | `1bcbfc4c` #1548 | LLM HTTP 客户端支持 gzip/brotli 响应解压                                                                       | ✅   |
| stream:false     | `2211da65`       | 后处理请求显式关闭流式，避免部分端点默认流式返回异常                                                           | ✅   |
| filler 语言门控  | `4cd49950` #1738 | 双层词表（通用层 + 语言门控层，whatlang/isolang 证据链 ≥0.9 fail-closed），替换 `audio_toolkit/text.rs` 现实现 | ✅   |

### Phase 2 — 音频采集管线（动 recorder，整体对齐）✅ 已完成

| 项                       | 上游参考         | 说明                                                    | 状态                                               |
| ------------------------ | ---------------- | ------------------------------------------------------- | -------------------------------------------------- |
| 无音频录音后卸载模型     | `dc5bdc9d` #2106 |                                                         | ✅                                                 |
| 模型文件被删恢复         | `e4ae0d44` #1918 | 优雅提示 + 可重下                                       | ✅                                                 |
| cpal 阻塞出主线程        | `b4453a29` #1716 | lock-free is_recording                                  | ✅                                                 |
| 尾部音频保护             | `df216832` #1958 | stop 时冲刷重采样器残留 + VadTailReport + 加长 hangover | ✅                                                 |
| mic callback 实时安全    | `d54c88eb` #1954 | rtrb 无锁环 + capture worker（整文件级对齐）            | ✅                                                 |
| 空闲跳过 level/resampler | `db003f38` #1873 | always-on 模式下非录音帧不做 FFT/重采样                 | ✅ 由 #1954 移植吸收（ChunkDisposition::Discard）  |
| capture worker 死亡恢复  | `a4348beb` #1838 | 自动重建流                                              | ✅ needs_reopen + manager 检测重建                 |
| 断连回退默认麦克风       | `c89b7bf3` #1874 |                                                         | ✅ DesiredMicrophone/回退持久化 + settings-changed |
| mic level 校准           | `76b44d83` #1813 | 修平 meter 不动的问题                                   | ➖ 降级为实测调参（见偏差表）                      |

### Phase 3 — 可靠粘贴 `paste_tx/`

- 上游参考：`a70ac84f` #1812、`b1b2d9f9` #1847、`3ed2b219` #1231（保留非文本剪贴板内容）、`bc7facea`（paste delay 上限）。
- 移植 `TxState`/`evaluate` 平台无关核心 + macOS `NSPasteboard` 懒承诺路径；Windows 延迟渲染路径本期只做骨架。
- 与 Votype 现有 `clipboard.rs` paste-and-restore 合并，`settings.reliable_paste` 默认关、失败回退 legacy。

### Phase 4 — VAD 与快捷键交互

| 项                         | 上游参考                            | 说明                                                                     | 状态                                                                                                        |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| compound shortcut 名称修复 | `141f981d` #1862                    | 紧凑存储名 + 展示标签分离；双后端解析测试                                | ✅（keyboard.ts 适配 Votype parseKeyCombination 结构；随带 handy-keys 0.3.2→0.3.4 以获得 printscreen 解析） |
| reset binding ID 校验      | `a6eed754` #2033                    | `get_stored_binding(&AppSettings, id) -> Result` + 2 测试                | ✅                                                                                                          |
| earshot VAD                | `20ada47d` #1967                    | `VoiceActivityDetector` trait 抽象（Phase 2 已铺好），`vad_backend` 设置 | ✅（command 放 commands/audio.rs 无 specta，前端 plain invoke；Selector 挂专家模式组）                      |
| activation 状态机          | `c62a5fcd` #1971 + `c6fa60da` #1910 | Auto PTT + toggle 奇偶性，对齐 coordinator start/stop                    | ✅（纯 CoordinatorState 整机上提，命名映射 Hold=PTT；hold_threshold_ms 设置+滑块仅自动模式显示；overlay generation Votype 已有等效机制跳过） |

### Phase 5 — 引擎级流式转录（重大）

- transcribe-cpp 0.1.3 → 0.2.3（crates.io，macOS metal），适配 `Session::stream()` API 变更。
- 移植 StreamRouter：recorder 逐帧喂 16k PCM、tentative/committed 事件、finalize_stream、失败回退 batch；VAD 退化为仅控起停（Streaming policy, hangover ~1650ms）。
- 前端仅接 overlay/review 的 `stream-text-event` 展示，替换现有 realtime_worker_loop 伪流式（保留为流式模型不可用时的回退）。
- 模型能力位 `supports_streaming` 并入现有 catalog（Phase 2 GGUF 外部化目录）。

### Phase 6 — Secure Input（macOS）✅ 已完成

| 项              | 上游参考         | 说明                                                                                                                         | 状态                                                                                 |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 监控与状态事件  | `d001fcd9` #1785 | 轮询 `IsSecureEventInputEnabled`、sustained 判定、culprit 定位、`secure-input-changed` 事件、tray 警告图标/菜单项/tooltip    | ✅                                                                                   |
| Carbon 影子回退 | `00d25549` #2002 | `reconcile_fallback` 序列化注册防丢 release；degraded/uncovered 分类；Cancel 绑定录音期间动态影子注册；录制器拒绝+toast 提示 | ✅（跳过上游 post-process 条件绑定，Votype 无该绑定）                                |
| 前端横幅        | 同上             | `SecureInputWarning.tsx`（tabler 图标 + plain invoke，未依赖 bindings.ts）；en/zh i18n；`--color-warning` 主题变量           | ✅（KeyboardDiagnostic 调试 UI 按 spec 排除，仅保留 `run_keyboard_diagnostic` 命令） |

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

| Phase | 计划                                                                                     | 实际                                                                                                              | 原因                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1     | filler 语言门控按上游用 supported_languages 目录约束 `detect_output_language`            | 暂传空列表（无约束检测）                                                                                          | Votype 模型目录无逐语言 supported-languages 元数据，桥接留待 Phase 5 引擎升级时接入                               |
| 1     | 上游 FillerWordRemoval 完整 UI 开关组件                                                  | 仅 settings 字段 `filler_word_removal_enabled` + `change_filler_word_removal_enabled_setting` 命令，未加设置页 UI | UI 按总纲约定最小接线；开关可后续补                                                                               |
| 1     | 顺带修复 dev 上已存在的 doctest 失败（phonetic_similarity 示例缺 `use`）                 | 已修（1 行）                                                                                                      | 阻塞 `cargo test` 全绿验证，与 Phase 1 无逻辑关联，单独说明                                                       |
| 2     | #1813 mic level 校准按上游常量直接移植                                                   | 不移植常量，仅采纳其自适应 FFT 窗长（CaptureProcessor 内按采样率选窗）                                            | Votype `visualizer.rs` 已深度魔改（双参 feed/显示曲线），上游 -68/-30 dBFS 常量不适用；meter 平直问题留待实测调参 |
| 2     | recorder 重写保留 Votype 全部周期性调试日志（[audio-input]/[waveform]/[audio-spectrum]） | 删除周期性 dump，保留录音起止 [audio-debug] 汇总与首块延迟日志                                                    | 实时安全回调不能日志；消费线程保留同类统计会显著增加移植偏差，按上游结构收敛                                      |
| 2     | auto_enhance（AudioInputEnhancer）留在 cpal 回调内                                       | 移入 CaptureProcessor::process_raw_chunk（消费线程）                                                              | 上游新架构要求回调 allocation/lock-free；增强属重计算，放消费线程是唯一落点                                       |
| 2     | 同步 `audio_toolkit/bin/cli.rs` 到新 recorder API                                        | 不动（HEAD 即编译不过：3 参 SmoothedVad 旧签名）                                                                  | Cargo.toml `[[bin]]` 已注释，属停用死代码，避免无意义改动                                                         |
