---
name: "Review 窗口悬浮英文预览与插入语义重构"
tags: [review-window, translation, ui]
depends_on: [2026-04-15-hotword-force-replace.spec.md]
estimate: "0.5-1 天"
---

## 意图

将当前 review 窗口中“侵占正文空间”的英文翻译面板重构为“下方透明 dock 中的悬浮预览卡”，并明确三条插入语义。

核心意图是：“润色区负责编辑与确认，英文区负责展示与英文插入，原文插入保持独立快捷路径”，从而减少正文空间被辅助信息挤占的问题，同时让英文/润色/ASR 原文三种插入结果具备稳定、可预期的快捷键与 hover 操作。

## 约束

- 必须保留单一 review window，不新增第二个 Tauri 窗口或独立 webview。
- 英文预览仅用于展示，不提供直接编辑能力。
- 现有“插入前翻译英文”的应用级开关仍然作为是否启用英文预览的唯一入口，不新增新的应用规则。
- `Cmd + Enter` / `Ctrl + Enter` / `Tab` 的语义必须互斥且稳定，不能再依赖“按下后再猜测插入哪种文本”。
- 翻译继续使用现有后端翻译链路和回退逻辑，避免重写模型选择与翻译命令。
- 现有 review 窗口的自动翻译 debounce 仍保留 1 秒，但等待阶段不以大块提示文案侵占界面。
- 必须兼容单结果 polish 模式与多候选 multi-candidate 模式。
- 必须遵守 `CLAUDE.md` 中的运行时规则，尤其是不在错误线程使用阻塞式 async 调度。

## 已定决策

- 采用“单窗口分层悬浮”方案，而不是在正文流中继续压缩内嵌翻译区。
  - 原因：问题本质是空间层级而非纯尺寸问题；如果仍放在正文流里，即使缩小也会持续挤占编辑区。

- review window 分为两层：
  - 上层为现有标准 review shell（header、正文、footer）。
  - 下层为透明 `preview dock`，只负责承载悬浮英文卡。
  - 原因：满足“当前置信窗口正下方”的视觉目标，同时复用同一窗口的生命周期与快捷键管理。

- 英文预览卡采用深色半透明玻璃质感，可滚动、不可编辑。
  - 原因：它是辅助结果，不应与可编辑润色区竞争交互权重。

- 插入语义固定为：
  - `Cmd + Enter`：插入英文。
  - `Ctrl + Enter`：插入润色结果。
  - `Tab`：插入 ASR 原文。
  - 原因：三条路径语义清晰，不再依赖运行时条件判断来决定最终插入内容。

- 插入按钮只在 hover 时显示：
  - 润色区 hover 显示“插入润色”。
  - 英文卡 hover 显示“插入英文”。
  - 原因：默认界面更干净，符合“预览为辅助层”的定位。

- 多候选模式中，“当前选中的 candidate 面板”被视为润色区。
  - 原因：避免为每个候选同时暴露插入按钮，降低视觉噪声和误操作概率。

- 英文卡在无译文时正文直接显示“翻译中...”，有译文后不再持续展示更新提示，仅在失败时保留简短失败状态。
  - 原因：减少无价值状态文案，避免抢占注意力。

## 边界

### 允许修改

- `src/review/ReviewWindow.tsx`
- `src/review/ReviewWindow.css`
- `src/review/DiffViewPanel.tsx`
- `src/review/MultiCandidateView.tsx`
- `src/review/ReviewFooter.tsx`
- `src/i18n/locales/zh/translation.json`
- `src/i18n/locales/en/translation.json`
- `src-tauri/src/shortcut/review_cmds.rs`

### 禁止

- 不新增新的 Tauri 窗口、tray 项或 overlay 窗口。
- 不改动应用规则的数据结构，只复用现有 `translate_to_english_on_insert`。
- 不新增新的翻译模型设置或翻译 provider 解析逻辑。
- 不改变历史记录保存语义：历史中仍以 review 结果为主，不额外把英文预览作为新的历史主文本。
- 不在本次中重做整个 review header/footer 的信息架构。

## 排除范围

- 不实现英文预览的直接编辑。
- 不实现“英文/中文双向联动编辑”。
- 不新增独立的“插入中文”全局按钮；中文语义由“插入润色”承担。
- 不为未启用“插入前翻译英文”的应用展示该悬浮卡。
- 不重做 review 窗口的整体视觉主题，仅对英文预览浮层做局部样式升级。

## 验收场景

### 1. happy_path_polish_mode_float_preview

- **Given**: 当前应用开启“插入前翻译英文”，review 窗口以单结果润色模式打开。
- **When**: 用户查看窗口并等待首轮翻译完成。
- **Then**: 主润色区保持原有布局；窗口底部透明 dock 中出现悬浮英文卡；英文卡先显示“翻译中...”，随后显示英文译文；润色区正文空间不再被旧版大翻译面板直接挤压。

### 2. happy_path_insert_semantics

- **Given**: review 窗口中同时存在润色结果、英文预览和 ASR 原文。
- **When**: 用户分别触发 `Cmd + Enter`、`Ctrl + Enter`、`Tab`。
- **Then**: 三种快捷键分别稳定插入英文、润色结果、ASR 原文，且彼此不混淆。

### 3. happy_path_hover_actions

- **Given**: review 窗口已打开且内容已稳定。
- **When**: 用户 hover 润色区或英文卡。
- **Then**: 对应区域才显示“插入润色”或“插入英文”按钮；未 hover 时按钮默认隐藏。

### 4. happy_path_multi_candidate_selected_panel

- **Given**: review 窗口以多候选模式打开，已有当前选中候选。
- **When**: 用户 hover 当前选中的候选面板。
- **Then**: 仅当前选中候选被视为润色区并显示“插入润色”；`Ctrl + Enter` 插入当前选中候选的文本；英文卡仍按当前编辑文本生成英文预览。

### 5. error_path_translation_failed

- **Given**: 当前应用开启英文预览，但翻译请求失败或返回空文本。
- **When**: review 窗口等待翻译结果。
- **Then**: 英文卡显示失败状态；`Cmd + Enter` 继续按既有回退逻辑处理，不能导致窗口卡死；`Ctrl + Enter` 与 `Tab` 仍可正常插入。

### 6. edge_case_edit_then_pending_translation

- **Given**: 英文卡已存在上一版译文，用户刚修改润色文本，新的 debounce 翻译尚未完成。
- **When**: 用户立即按 `Cmd + Enter`。
- **Then**: 系统必须保证最终插入与最新润色文本对应的英文结果；如果最新翻译失败，则按既有回退逻辑处理，而不是错误地插入旧译文。

### 7. edge_case_feature_disabled

- **Given**: 当前应用未开启“插入前翻译英文”。
- **When**: review 窗口打开。
- **Then**: 不显示透明 dock 与英文悬浮卡；`Ctrl + Enter` 与 `Tab` 继续保留原有中文/原文插入语义；英文专属路径不被启用。

## 实施偏差

> 功能完成后填写。记录实际实现与 spec 的差异。

| 原计划                                      | 实际实现                                                                   | 原因                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 多候选仅当前选中卡显示"插入润色" hover 按钮 | 保留现有 `candidate-insert-btn`（每张卡 hover 都可见），未额外限制到选中卡 | 现有 UX 已有单卡 hover 按钮，键盘语义仍只作用于当前选中卡；限制显示会与既有习惯冲突 |
| `bindings.ts` 同步 `insertTarget` 参数      | 暂保持 stale：`invoke()` 直调，首次 `bun tauri dev` 由 specta 导出更新     | 前端未使用 typed binding，运行时直调 Tauri 即可                                     |
| Mod-Enter 统一走英文                        | Mac: `Meta-Enter` → 英文；跨平台 `Ctrl-Enter` → 润色                       | 避免 Win/Linux 上 Mod-Enter 与 Ctrl-Enter 冲突                                      |
