# Draft: AI Analysis UI Refresh

## Requirements (confirmed)

- "统计总结" 中的 "AI 分析" 板块需要整体 UI 更新设计。

## Technical Decisions

- 视觉方向由我定：拟采用「编辑感/科技感混合」风格（大标题 + 结构化分区 + 层叠卡片 + 柔和噪点/渐变背景）。
- 默认保留现有信息架构与文案，仅做视觉与布局层面的更新。
- 适配桌面与移动端。

## Research Findings

- AI 分析区块位于 `src/components/settings/summary/SummaryPage.tsx` 页面底部（Bottom Section: AI Analysis & User Profile）。
- AI 分析内容结构来自 `src/components/settings/summary/summaryTypes.ts` 的 `parseAiAnalysis`，决定各块内容与布局字段。
- 文案来源：`src/i18n/locales/zh/translation.json`。
- 前端未发现测试基础设施：`package.json` 无 test 脚本，未配置 vitest/jest。
- 后端 Rust 有内联测试（`src-tauri/src/...`），但与本次前端 UI 变更无直接关系。

## Open Questions

- 具体指向哪个页面/组件（路径/截图）？
- 目标风格与品牌基调（更偏专业、科技感、温暖、极简等）？
- 是否需要保留现有信息架构/文案/数据结构？
- 仅视觉更新，还是包含交互/动效调整？
- 适配范围：桌面端/移动端都要吗？
- 是否要补齐前端测试基础设施？若不建立测试，将以手动验证流程为主。

## Scope Boundaries

- INCLUDE: AI 分析板块整体 UI 设计更新。
- EXCLUDE: 统计总结其它板块（除非明确要求）。
