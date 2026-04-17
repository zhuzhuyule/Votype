# Review 窗口悬浮英文预览与插入语义重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 review 窗口中的英文翻译面板改为底部透明 dock 内的悬浮预览卡，并明确 `Cmd + Enter` / `Ctrl + Enter` / `Tab` 三条插入语义。

**Architecture:** 保持单一 review window，不新增 webview。前端在 `ReviewWindow` 内把布局拆成主审阅层和透明预览层，英文预览卡只在应用启用“插入前翻译英文”时展示；后端继续复用现有翻译与回退逻辑，但通过显式插入路径区分英文、润色结果和 ASR 原文。

**Tech Stack:** React 18、TypeScript、Tauri invoke、Rust review commands、现有 i18n JSON 文案。

---

## 文件结构

- `src/review/ReviewWindow.tsx`
  - 主控 review 窗口布局、翻译状态、快捷键路由、三种插入路径的前端参数组装。
- `src/review/ReviewWindow.css`
  - review shell、透明 preview dock、悬浮英文卡、hover 插入按钮的样式。
- `src/review/DiffViewPanel.tsx`
  - 单结果润色模式中的 hover 区和“插入润色”按钮挂载点。
- `src/review/MultiCandidateView.tsx`
  - 多候选模式下当前选中 candidate 的 hover 区和“插入润色”按钮挂载点。
- `src/review/ReviewFooter.tsx`
  - 如需保留/调整 ASR 原文入口时复用现有 footer 行为，避免语义冲突。
- `src-tauri/src/shortcut/review_cmds.rs`
  - 把英文/润色/原文三条插入路径的后端语义固定下来，保留英文路径对预览结果的复用。
- `src/i18n/locales/zh/translation.json`
- `src/i18n/locales/en/translation.json`
  - 新增 hover 按钮、悬浮卡状态、失败提示等文案。

## Task 1: 固定后端插入语义

**Files:**

- Modify: `src-tauri/src/shortcut/review_cmds.rs`
- Test: `src-tauri` build check via `rtk cargo check`

- [ ] **Step 1: 先梳理现有 review 插入命令签名**

Run:

```bash
sed -n '1,260p' /Users/zac/code/github/asr/Handy/src-tauri/src/shortcut/review_cmds.rs
```

Expected:

- 能看到 `confirm_reviewed_transcription(...)`
- 已存在 `translated_text_for_insert` 和 `translation_source_text`

- [ ] **Step 2: 设计最小命令扩展**

在 `confirm_reviewed_transcription` 上新增一个显式插入目标字段，限定为三种之一：

```rust
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ReviewInsertTarget {
    English,
    Polished,
    AsrOriginal,
}
```

函数签名目标形态：

```rust
pub async fn confirm_reviewed_transcription(
    app: AppHandle,
    text: String,
    history_id: Option<i64>,
    cached_model_id: Option<String>,
    learn_from_edit: bool,
    original_text_for_learning: Option<String>,
    translated_text_for_insert: Option<String>,
    translation_source_text: Option<String>,
    insert_target: Option<ReviewInsertTarget>,
) -> Result<(), String>
```

- [ ] **Step 3: 实现最小后端分支**

目标逻辑：

```rust
let insert_target = insert_target.unwrap_or(ReviewInsertTarget::Polished);

let text = match insert_target {
    ReviewInsertTarget::English => {
        // 仅英文路径走 should_translate_review_insert + 预览复用 + 回退
    }
    ReviewInsertTarget::Polished | ReviewInsertTarget::AsrOriginal => text,
};
```

要求：

- `Polished` 和 `AsrOriginal` 都不能触发英文翻译判断
- `English` 才允许复用 `translated_text_for_insert`
- 保持已有 history、focus、paste 流程不变

- [ ] **Step 4: 运行后端检查**

Run:

```bash
cd /Users/zac/code/github/asr/Handy/src-tauri && rtk cargo check
```

Expected:

- `Finished dev profile` 或等价成功输出

- [ ] **Step 5: 提交这一小步**

```bash
cd /Users/zac/code/github/asr/Handy
rtk git add src-tauri/src/shortcut/review_cmds.rs
rtk git commit -m "refactor review insert target semantics"
```

## Task 2: 把 ReviewWindow 改成主层 + 透明 dock

**Files:**

- Modify: `src/review/ReviewWindow.tsx`
- Modify: `src/review/ReviewWindow.css`
- Test: `bun run build`

- [ ] **Step 1: 先确认现有翻译面板挂载点和测量逻辑**

Run:

```bash
sed -n '1400,1580p' /Users/zac/code/github/asr/Handy/src/review/ReviewWindow.tsx
sed -n '421,560p' /Users/zac/code/github/asr/Handy/src/review/ReviewWindow.css
```

Expected:

- 看到当前 `.review-translation-panel`
- 看到 `measureAndResize(false)` 依赖正文高度

- [ ] **Step 2: 在 ReviewWindow 中拆出新布局骨架**

目标 JSX 结构：

```tsx
<div className="review-window-container" ref={containerRef}>
  <div className="review-shell">{/* 原 header + 正文 + footer */}</div>

  {translationEnabled && (
    <div className="review-preview-dock">
      <div className="review-translation-float">
        {/* header + content + hover action */}
      </div>
    </div>
  )}
</div>
```

要求：

- 非翻译应用不渲染 dock
- 旧的流式 `.review-translation-panel` 要删除

- [ ] **Step 3: 补充透明 dock 与悬浮卡样式**

目标样式骨架：

```css
.review-shell {
  position: relative;
  z-index: 1;
}
.review-preview-dock {
  position: relative;
  height: 140px;
  margin: 0 16px 16px;
  pointer-events: none;
}
.review-translation-float {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  border-radius: 14px;
  background: rgba(20, 24, 31, 0.6);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

要求：

- 悬浮卡内部正文可滚动
- 默认不可编辑
- 风格明显区别于主润色区，但不重做全站主题

- [ ] **Step 4: 调整窗口测量**

在 `measureAndResize` 中把 preview dock 高度纳入总高度：

```tsx
const previewDock = container.querySelector(".review-preview-dock");
const previewH = previewDock?.getBoundingClientRect().height ?? 0;
const totalH = headerH + contentH + footerH + previewH;
```

要求：

- 非翻译应用时高度不变
- 翻译应用时英文卡阴影和底部留白不能被裁掉

- [ ] **Step 5: 运行前端构建**

Run:

```bash
cd /Users/zac/code/github/asr/Handy && bun run build
```

Expected:

- `✓ built in` 输出

- [ ] **Step 6: 提交这一小步**

```bash
cd /Users/zac/code/github/asr/Handy
rtk git add src/review/ReviewWindow.tsx src/review/ReviewWindow.css
rtk git commit -m "redesign review translation float layout"
```

## Task 3: 实现英文悬浮卡内容与安静状态

**Files:**

- Modify: `src/review/ReviewWindow.tsx`
- Modify: `src/review/ReviewWindow.css`
- Modify: `src/i18n/locales/zh/translation.json`
- Modify: `src/i18n/locales/en/translation.json`
- Test: `bun run build`

- [ ] **Step 1: 固化卡片状态规则**

目标渲染逻辑：

```tsx
const translationCardText =
  translatedText ||
  translationError ||
  t("transcription.review.translationUpdating", "翻译中...");

const showTranslationStatus = !translatedText || translationStatus === "error";
```

要求：

- 首次无译文时正文直接显示“翻译中...”
- 有译文后不显示“1 秒后更新”之类状态
- 仅失败时保留失败提示

- [ ] **Step 2: 清理旧的等待文案依赖**

删除或停用不再需要的界面文案分支，例如：

```tsx
t("transcription.review.translationWaiting", ...)
t("transcription.review.translationReady", ...)
```

若保留 key 以兼容旧代码，也不要再在新 UI 中使用。

- [ ] **Step 3: 给悬浮卡补 header / content / hover 层级**

目标 JSX 片段：

```tsx
<div className="review-translation-float-header">
  <span className="review-translation-title">...</span>
  {showTranslationStatus ? (
    <span className="review-translation-status">...</span>
  ) : null}
</div>
<div className="review-translation-float-content">{translationCardText}</div>
```

要求：

- header 紧凑
- content 区滚动，不让 header 漂走

- [ ] **Step 4: 补文案并构建**

新增或确认这些 key：

```json
"insertPolished": "插入润色"
"insertEnglish": "插入英文"
"translationUpdating": "翻译中..."
"translationFailedFallback": "翻译失败，插入时将回退原文"
```

Run:

```bash
cd /Users/zac/code/github/asr/Handy && bun run build
```

Expected:

- 构建成功，无缺失 i18n key 导致的类型或运行时报错

- [ ] **Step 5: 提交这一小步**

```bash
cd /Users/zac/code/github/asr/Handy
rtk git add src/review/ReviewWindow.tsx src/review/ReviewWindow.css src/i18n/locales/zh/translation.json src/i18n/locales/en/translation.json
rtk git commit -m "polish review translation float states"
```

## Task 4: 实现三种插入快捷键与按钮路由

**Files:**

- Modify: `src/review/ReviewWindow.tsx`
- Test: `bun run build`
- Test: `src-tauri` build check via `rtk cargo check`

- [ ] **Step 1: 在前端明确三条插入函数**

目标函数形态：

```tsx
const handleInsertEnglish = useCallback(async () => { ... });
const handleInsertPolished = useCallback(async () => { ... });
const handleInsertOriginal = useCallback(async () => { ... });
```

要求：

- `handleInsertEnglish` 传 `insertTarget: "english"`
- `handleInsertPolished` 传 `insertTarget: "polished"`
- `handleInsertOriginal` 传 `insertTarget: "asr_original"`

- [ ] **Step 2: 更新快捷键绑定**

在 Tiptap shortcuts 和多候选全局 keydown 里统一为：

```tsx
"Mod-Enter": () => { insertEnglishRef.current(); return true; }
"Ctrl-Enter": () => { insertPolishedRef.current(); return true; }
"Tab": () => { insertOriginalRef.current(); return true; }
```

若 `Mod-Enter` 在 Windows/Linux 上与 `Ctrl-Enter` 冲突，则保留：

- `Meta-Enter` 走英文
- `Ctrl-Enter` 走润色

实现时必须按现有平台判断把歧义消掉，不能让同一组合命中两条路径。

- [ ] **Step 3: 让英文插入继续复用预览**

`handleInsertEnglish` 继续传递：

```tsx
...buildTranslationInsertPayload(currentText.trim())
```

`handleInsertPolished` 和 `handleInsertOriginal` 不能附带英文复用 payload，避免误插英文。

- [ ] **Step 4: 前后端双重检查**

Run:

```bash
cd /Users/zac/code/github/asr/Handy && bun run build
cd /Users/zac/code/github/asr/Handy/src-tauri && rtk cargo check
```

Expected:

- 两条命令都成功

- [ ] **Step 5: 提交这一小步**

```bash
cd /Users/zac/code/github/asr/Handy
rtk git add src/review/ReviewWindow.tsx src-tauri/src/shortcut/review_cmds.rs
rtk git commit -m "wire review insert shortcuts by target"
```

## Task 5: 为润色区和英文区增加 hover 插入按钮

**Files:**

- Modify: `src/review/DiffViewPanel.tsx`
- Modify: `src/review/MultiCandidateView.tsx`
- Modify: `src/review/ReviewWindow.tsx`
- Modify: `src/review/ReviewWindow.css`
- Test: `bun run build`

- [ ] **Step 1: 为单结果润色区预留 hover 按钮插槽**

在 `DiffViewPanel` 增加显式 props：

```tsx
onInsertPolished?: () => void;
showInsertPolished?: boolean;
```

目标渲染：

```tsx
{
  showInsertPolished ? (
    <button className="review-hover-insert-btn" onClick={onInsertPolished}>
      {t("transcription.review.insertPolished", "插入润色")}
    </button>
  ) : null;
}
```

- [ ] **Step 2: 多候选模式只给当前选中面板显示按钮**

在 `MultiCandidateView` 为当前选中 candidate 加同类 props：

```tsx
onInsertSelectedCandidate?: (candidateId: string, text: string) => void;
```

规则：

- 仅 `candidate.id === selectedCandidateId`
- 且 hover 当前卡片时显示“插入润色”

- [ ] **Step 3: 英文悬浮卡 hover 显示“插入英文”**

在 `ReviewWindow` 的英文卡内容区加入按钮：

```tsx
{
  translatedText ? (
    <button
      className="review-hover-insert-btn review-hover-insert-btn-english"
      onClick={() => void handleInsertEnglish()}
    >
      {t("transcription.review.insertEnglish", "插入英文")}
    </button>
  ) : null;
}
```

要求：

- 仅 hover 时显示
- 无译文不显示按钮

- [ ] **Step 4: 统一 hover 按钮样式**

目标样式片段：

```css
.review-hover-insert-btn {
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}
.review-polish-surface:hover .review-hover-insert-btn,
.review-translation-float:hover .review-hover-insert-btn {
  opacity: 1;
  transform: translateY(0);
}
```

要求：

- 不遮挡主要文字阅读
- 英文和润色按钮视觉保持一致

- [ ] **Step 5: 前端构建并提交**

Run:

```bash
cd /Users/zac/code/github/asr/Handy && bun run build
```

Expected:

- 构建成功

```bash
cd /Users/zac/code/github/asr/Handy
rtk git add src/review/DiffViewPanel.tsx src/review/MultiCandidateView.tsx src/review/ReviewWindow.tsx src/review/ReviewWindow.css
rtk git commit -m "add hover insert actions to review surfaces"
```

## Task 6: 收尾验证与 spec 回填

**Files:**

- Modify: `docs/specs/2026-04-17-review-translation-float.spec.md`
- Test: `bun run build`
- Test: `src-tauri` build check via `rtk cargo check`
- Optional inspect: `rtk git diff --stat`

- [ ] **Step 1: 运行最终验证**

Run:

```bash
cd /Users/zac/code/github/asr/Handy && bun run build
cd /Users/zac/code/github/asr/Handy/src-tauri && rtk cargo check
cd /Users/zac/code/github/asr/Handy && rtk git diff --stat
```

Expected:

- 前后端检查通过
- diff 范围主要集中在 spec 中允许修改的文件

- [ ] **Step 2: 人工验证关键交互**

手工检查清单：

```text
1. 翻译应用打开 review 后，正文空间没有被旧面板挤压
2. 英文卡位于窗口底部透明 dock 中
3. Cmd+Enter 插入英文
4. Ctrl+Enter 插入润色
5. Tab 插入 ASR 原文
6. 润色区 hover 才显示“插入润色”
7. 英文卡 hover 才显示“插入英文”
8. 翻译失败时，Ctrl+Enter 与 Tab 不受影响
```

- [ ] **Step 3: 回填 spec 偏差**

若实现与 spec 不同，在：

```bash
/Users/zac/code/github/asr/Handy/docs/specs/2026-04-17-review-translation-float.spec.md
```

中更新“实施偏差”表。例如：

```markdown
| 原计划                     | 实际实现                                  | 原因             |
| -------------------------- | ----------------------------------------- | ---------------- |
| 多候选仅当前选中卡显示按钮 | 同时允许键盘插入但 hover 仍只在选中卡显示 | 保持键盘语义稳定 |
```

- [ ] **Step 4: 提交收尾**

```bash
cd /Users/zac/code/github/asr/Handy
rtk git add docs/specs/2026-04-17-review-translation-float.spec.md
rtk git commit -m "document review translation float delivery"
```
