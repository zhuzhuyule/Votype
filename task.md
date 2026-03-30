# 任务大纲：纯净架构之 Sherpa 彻底清除行动

## Phase 1: 核心依赖解耦与环境构建清理 (Build & Dependencies)

- [x] **[Cargo.toml](file:///Users/zac/code/github/asr/Handy/src-tauri/Cargo.toml)**: 移除 `sherpa-rs-sys` 依赖项
- [ ] **[src-tauri/build.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/build.rs)**: 移除 [sherpa_safe.cc](file:///Users/zac/code/github/asr/Handy/src-tauri/cpp/sherpa_safe.cc) 的 [cc](file:///Users/zac/code/github/asr/Handy/src-tauri/cpp/sherpa_safe.cc) 构建编译器配置
- [x] **[src-tauri/src/sherpa.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/sherpa.rs)**: 物理删除该 FFI 高级包装模块
- [ ] **[src-tauri/cpp/sherpa_safe.cc](file:///Users/zac/code/github/asr/Handy/src-tauri/cpp/sherpa_safe.cc)**: 物理删除该 C++ 源文件
- [ ] **[src-tauri/tauri.conf.json](file:///Users/zac/code/github/asr/Handy/src-tauri/tauri.conf.json)**: 检查并移除 `resources` 节点下关于 Sherpa 模型的绑定

## Phase 2: 后端实体与转写核心剔除 (Backend Core Logic)

- [x] **[managers/model.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/model.rs)**: 移除 `SherpaOnnxAsrMode`/`Family`/[Spec](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/model.rs#46-52) 结构体及 `ModelInfo.sherpa` 字段
- [x] **[managers/model.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/model.rs)**: 移除 `EngineType::SherpaOnnx` 相关变体与所有硬编码默认模型
- [x] **[managers/transcription.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs)**: 移除 `sherpa_session`、[sherpa_offline_session](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#1143-1170)、[punctuation](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#2099-2130) 等字段及会话控制
- [x] **[managers/transcription.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs)**: 剥离 [transcribe](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#355-541) 与 [transcribe_local_only](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#542-635) 内部的 [SherpaOnline](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#35-45)/[SherpaOffline](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#62-82) 专属流式分支
- [x] **[managers/transcription.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs)**: 彻底删除实时推理辅助、打断轮询以及标点修复 ([apply_punctuation](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/transcription.rs#2099-2130)) 逻辑

## Phase 3: 后端关联配置与命令接口肃清 (Backend Config & API)

- [x] **[src-tauri/src/settings.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs)**: 移除 [default_punctuation_model](file:///Users/zac/code/github/asr/Handy/src-tauri/src/settings.rs#753-756) 对 Sherpa 模型的挂载
- [x] **[commands/models.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/commands/models.rs)**: 移除专门拦截 Sherpa Punctuation 引擎不允许选为 Active 的校验逻辑
- [ ] **[actions/transcribe.rs](file:///Users/zac/code/github/asr/Handy/src-tauri/src/actions/transcribe.rs)**: 全局扫描，移除对 Sherpa 分发链路或专属类型的任何残留

## Phase 4: 前端类型解绑与视效净化 (Frontend Types & UI)

- [ ] **[src/lib/types.ts](file:///Users/zac/code/github/asr/Handy/src/lib/types.ts) & [src/lib/events.ts](file:///Users/zac/code/github/asr/Handy/src/lib/events.ts)**: 将 `EngineType` 及 `LoadedEngine` 类型定义中针对 Sherpa 的描述词（`sherpa_onnx`/`sherpa_onnx_punctuation`）删除
- [ ] **组件 [ModelSelector.tsx](file:///Users/zac/code/github/asr/Handy/src/components/model-selector/ModelSelector.tsx) / [ModelDropdown.tsx](file:///Users/zac/code/github/asr/Handy/src/components/model-selector/ModelDropdown.tsx) / [ModelCard.tsx](file:///Users/zac/code/github/asr/Handy/src/components/settings/asr-models/components/ModelCard.tsx) / [ModelFilters.tsx](file:///Users/zac/code/github/asr/Handy/src/components/settings/asr-models/components/ModelFilters.tsx)**: 移除专门针对 [SherpaOnnx](file:///Users/zac/code/github/asr/Handy/src-tauri/src/managers/model.rs#46-52) 或 `SenseVoice`/`Paraformer` 流式的特例图标或家族字段渲染
- [ ] **多语言支持 `src/i18n/locales/*.json`**: 执行全局搜索，清理数百条像 `models.sherpa-sensevoice-zh-en-...` 等针对废弃模型的文案

## Phase 5: 测试、格式化与回归验证 (Verify & Launch)

- [ ] 运行 `cargo check` 于工作目录，定位并逐行修复由上述大范围重构引发的编译告警和悬空引用
- [ ] 运行 `bun run format` 修复所有的 ts/tsx/rs 格式问题
- [ ] 运行 `bun tauri dev` 进入系统，肉眼确实验证模型页干净无误，录音并调用 Parakeet 运转流畅
