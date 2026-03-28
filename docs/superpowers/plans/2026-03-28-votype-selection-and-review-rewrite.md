# Votype Selection And Review Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主程序在“有选中 / 无选中”两态下稳定路由，同时让 `review_window` 在语音触发时冻结当前全文并按口述指令整体改写。

**Architecture:** 后端新增更明确的 Votype 输入模式和 review 文本快照状态。主程序有选中时走专用改写 prompt，`review_window` 在快捷键按下时冻结最新同步到后端的全文，并在录音结束后把“冻结全文 + 口述指令”送入专用改写链，最终整体替换全文。

**Tech Stack:** Tauri v2, Rust, React, TipTap, async OpenAI-compatible post-process pipeline

---

### Task 1: 扩展模式判定与 review 快照状态

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/window_context.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/review_window.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/shortcut/handler.rs`
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/window_context.rs`

- [ ] **Step 1: 写失败测试**

在 `window_context.rs` 中新增测试，覆盖：

- `main` 有选中时进入主程序选中编辑模式
- `review_window` 聚焦时进入全文改写模式

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test window_context::tests --lib`

Expected: 新测试失败，因为模式尚未定义。

- [ ] **Step 3: 实现模式与 review 快照状态**

实现内容：

- 扩展 `VotypeInputMode`
- `resolve_votype_input_mode` 支持主程序选中态
- `review_window.rs` 新增当前编辑器全文快照和“录音冻结快照”存取接口
- `shortcut/handler.rs` 在 `review-window-local` 按下时冻结全文

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test window_context::tests --lib`

Expected: PASS

### Task 2: review_window 前端同步全文快照

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src/review/ReviewWindow.tsx`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/shortcut/review_cmds.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/lib.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src/bindings.ts`

- [ ] **Step 1: 写失败测试或最小可验证断言**

为后端命令增加最小单测或调用路径断言，确保可以设置 review 编辑器全文状态。

- [ ] **Step 2: 运行最小验证确认失败**

Run: `cargo test review_window --lib`

Expected: 若无显式测试，则至少新增命令后编译前失败。

- [ ] **Step 3: 实现前端到后端的全文同步**

实现内容：

- 新增 `set_review_editor_content_state(text: String)` 命令
- `ReviewWindow.tsx` 在编辑器内容更新时把当前纯文本同步到后端

- [ ] **Step 4: 运行验证确认通过**

Run: `cargo test --lib`

Expected: PASS

### Task 3: 主程序选中态接入专用改写 prompt

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/transcribe.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/core.rs`
- Test: `/Users/zac/code/github/asr/Handy/src-tauri/src/window_context.rs`

- [ ] **Step 1: 写失败测试**

增加模式测试，确认主程序有选中时不会再被归为普通插入模式。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test window_context::tests --lib`

Expected: FAIL

- [ ] **Step 3: 实现主程序选中态专用链路**

实现内容：

- 在模式判定中保留主程序选中态
- 新增一个专用的 Votype rewrite 请求 helper
- 主程序有选中时，用“选中内容 + 口述指令”生成替换文本

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test window_context::tests --lib`

Expected: PASS

### Task 4: review_window 从内联插入切到全文改写

**Files:**

- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/transcribe.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src-tauri/src/actions/post_process/pipeline.rs`
- Modify: `/Users/zac/code/github/asr/Handy/src/review/ReviewWindow.tsx`
- Modify: `/Users/zac/code/github/asr/Handy/src/lib/events.ts`

- [ ] **Step 1: 写失败测试或验证断言**

为 review rewrite 路径增加最小断言，确认它不再走 `review-window-inline-apply` 的内联插入模式。

- [ ] **Step 2: 运行验证确认失败**

Run: `cargo test --lib`

Expected: 现有实现不满足 review rewrite 规则。

- [ ] **Step 3: 实现全文改写路径**

实现内容：

- 读取按下录音键时冻结的全文
- 调用专用 rewrite helper
- 通过新的前端事件整体替换 `review_window` 文本

- [ ] **Step 4: 运行验证确认通过**

Run: `cargo test --lib && bunx prettier --check src/review/ReviewWindow.tsx src/lib/events.ts`

Expected: PASS

### Task 5: 全量验证

**Files:**

- Verify only

- [ ] **Step 1: 运行 Rust 校验**

Run: `cargo fmt --check && cargo test --lib`

Expected: PASS

- [ ] **Step 2: 运行前端格式校验**

Run: `bunx prettier --check src/App.tsx src/bindings.ts src/lib/events.ts src/review/ReviewWindow.tsx src/review/ReviewWindow.css src/review/DiffViewPanel.tsx`

Expected: PASS
