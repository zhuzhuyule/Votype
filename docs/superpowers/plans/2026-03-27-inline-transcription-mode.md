# Inline Transcription Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline editing mode to the Review window so users can dictate, edit, and refine text directly without the floating review → confirm → paste cycle.

**Architecture:** Extend the existing Review window with a top-level `inline` mode alongside the current `review` mode. Frontend intercepts shortcuts in inline mode (bypassing `isEditableTarget` guard), captures cursor context, and dispatches to backend. Backend stores inline context and routes the transcription pipeline to emit `review-window-inline-*` events instead of showing a new review window. Frontend receives events and updates the TipTap editor in-place using atomic transactions.

**Tech Stack:** React 18, TipTap/ProseMirror (already installed), Tauri 2.x commands/events, Rust async pipeline

**Spec:** `docs/superpowers/specs/2026-03-27-inline-transcription-mode-design.md`

---

## File Structure

### New Files

| File                                   | Responsibility                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/review/InlineEditor.tsx`          | TipTap editor configured for inline mode: editable, StarterKit with undoRedo (depth:20), anchor tracking (`pendingRange`), atomic transaction helpers for ASR/polish writes |
| `src/review/InlineStatusIndicator.tsx` | Footer-left status component: icon + text + pulse animation for listening state                                                                                             |
| `src/review/SectionTitleBar.tsx`       | "Transcription Result" label + undo/redo buttons, reads editor `.can().undo()/.redo()`                                                                                      |
| `src/review/useInlineState.ts`         | Hook managing inline mode state: `pendingRange`, `inlineStatus` (idle/listening/transcribing/polishing/complete/executing), context capture helpers                         |

### Modified Files

| File                                             | Changes                                                                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/review/ReviewWindow.tsx`                    | Add top-level mode state (`review` \| `inline`), render InlineEditor when inline, update shortcut handler to bypass `isEditableTarget` in inline mode, submit context + dispatch, listen for `review-window-inline-*` events |
| `src/review/ReviewHeader.tsx`                    | Add mode toggle button (review ↔ inline), visible in all header states                                                                                                                                                      |
| `src/review/ReviewFooter.tsx`                    | Render InlineStatusIndicator on left side when inline mode active                                                                                                                                                            |
| `src/review/main.tsx`                            | Register listeners for new `review-window-inline-*` events, forward to ReviewWindow via props/state                                                                                                                          |
| `src/review/ReviewWindow.css`                    | Styles for inline editor, status indicator pulse animation, highlight flash                                                                                                                                                  |
| `src/i18n/locales/en/translation.json`           | i18n keys: `inline.listening`, `inline.transcribing`, `inline.polishing`, `inline.executing`, `inline.complete`, `inline.modeToggle`, `inline.closeConfirm`, `inline.sectionTitle`, `inline.undo`, `inline.redo`             |
| `src/i18n/locales/zh/translation.json`           | Chinese translations for above keys                                                                                                                                                                                          |
| `src-tauri/src/review_window.rs`                 | Add `InlineContext` struct + static storage, `inline_submit_context` command, `emit_inline_*` helper functions, close confirmation event                                                                                     |
| `src-tauri/src/actions/transcribe.rs`            | In `stop()` pipeline: check for stored inline context → if present, emit `review-window-inline-*` events instead of showing review window; emit partial results to review window in addition to overlay                      |
| `src-tauri/src/actions/post_process/pipeline.rs` | Accept optional `inline_context` (before/after cursor text), inject into polish prompt when present                                                                                                                          |
| `src-tauri/src/shortcut/review_cmds.rs`          | Register `inline_submit_context` Tauri command                                                                                                                                                                               |
| `src-tauri/src/lib.rs`                           | Register `inline_submit_context` in command handler list                                                                                                                                                                     |
| `src-tauri/src/commands/mod.rs`                  | Update callers of `maybe_post_process_transcription` to pass `None` for new `inline_context` param                                                                                                                           |
| `src-tauri/src/commands/history.rs`              | Update caller of `maybe_post_process_transcription` to pass `None` for new `inline_context` param                                                                                                                            |

---

## Task 1: i18n Keys

**Files:**

- Modify: `src/i18n/locales/en/translation.json`
- Modify: `src/i18n/locales/zh/translation.json`

- [ ] **Step 1: Add English i18n keys**

Add to the English translation file under a new `"inline"` section:

```json
"inline": {
  "listening": "Listening...",
  "transcribing": "Transcribing...",
  "polishing": "Polishing...",
  "executing": "Executing...",
  "complete": "Complete",
  "modeToggle": "Edit Mode",
  "closeConfirmTitle": "Unsaved Changes",
  "closeConfirmMessage": "Content has been modified. Confirm close?",
  "closeConfirmOk": "Close",
  "closeConfirmCancel": "Cancel",
  "sectionTitle": "Transcription Result",
  "undo": "Undo",
  "redo": "Redo",
  "placeholder": "Press shortcut to start dictating..."
}
```

- [ ] **Step 2: Add Chinese i18n keys**

Add matching keys in Chinese:

```json
"inline": {
  "listening": "收听中...",
  "transcribing": "转写中...",
  "polishing": "润色中...",
  "executing": "执行中...",
  "complete": "完成",
  "modeToggle": "编辑模式",
  "closeConfirmTitle": "未保存的更改",
  "closeConfirmMessage": "内容已修改，确认关闭？",
  "closeConfirmOk": "关闭",
  "closeConfirmCancel": "取消",
  "sectionTitle": "转写结果",
  "undo": "撤销",
  "redo": "重做",
  "placeholder": "按下快捷键开始语音输入..."
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en/translation.json src/i18n/locales/zh/translation.json
git commit -m "feat(inline): add i18n keys for inline transcription mode"
```

---

## Task 2: Inline State Hook (`useInlineState`)

**Files:**

- Create: `src/review/useInlineState.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";

export type InlineStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "polishing"
  | "executing"
  | "complete";

interface PendingRange {
  start: number;
  end: number;
}

export function useInlineState(editor: Editor | null) {
  const [status, setStatus] = useState<InlineStatus>("idle");
  const pendingRangeRef = useRef<PendingRange | null>(null);
  const lastConfirmedContentRef = useRef<string>("");

  const captureContext = useCallback(() => {
    if (!editor)
      return { before_cursor: "", after_cursor: "", selected_text: null };
    const { from, to, empty } = editor.state.selection;
    const doc = editor.state.doc;

    // Use textBetween to correctly handle ProseMirror positions (which count
    // node boundaries) — doc.textContent + slice would produce wrong offsets.
    if (!empty) {
      return {
        before_cursor: doc.textBetween(0, from, "\n"),
        after_cursor: doc.textBetween(to, doc.content.size, "\n"),
        selected_text: doc.textBetween(from, to, "\n"),
      };
    }
    return {
      before_cursor: doc.textBetween(0, from, "\n"),
      after_cursor: doc.textBetween(from, doc.content.size, "\n"),
      selected_text: null,
    };
  }, [editor]);

  const startRecording = useCallback(() => {
    if (!editor) return;
    const { from } = editor.state.selection;
    pendingRangeRef.current = { start: from, end: from };
    setStatus("listening");
  }, [editor]);

  const insertPartialResult = useCallback(
    (text: string) => {
      if (!editor || !pendingRangeRef.current) return;
      const { start } = pendingRangeRef.current;
      const end = pendingRangeRef.current.end;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.replaceWith(start, end, editor.schema.text(text));
          return true;
        })
        .run();
      pendingRangeRef.current = { start, end: start + text.length };
    },
    [editor],
  );

  const replaceWithPolished = useCallback(
    (text: string) => {
      if (!editor || !pendingRangeRef.current) return;
      const { start, end } = pendingRangeRef.current;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.replaceWith(start, end, editor.schema.text(text));
          return true;
        })
        .run();
      pendingRangeRef.current = null;
      setStatus("complete");
      setTimeout(() => setStatus("idle"), 1500);
    },
    [editor],
  );

  const replaceDocument = useCallback(
    (text: string) => {
      if (!editor) return;
      editor.commands.setContent(text);
      setStatus("complete");
      setTimeout(() => setStatus("idle"), 1500);
    },
    [editor],
  );

  const markConfirmed = useCallback(() => {
    if (!editor) return;
    lastConfirmedContentRef.current = editor.state.doc.textContent;
  }, [editor]);

  const hasUnsavedChanges = useCallback(() => {
    if (!editor) return false;
    return editor.state.doc.textContent !== lastConfirmedContentRef.current;
  }, [editor]);

  // Cancel any in-progress operation. Used when:
  // - New recording starts during polish (keep ASR text, start fresh)
  // - User manually edits during polish (user intent takes priority)
  // - Command executing + new recording (cancel command, keep original)
  const cancelInProgress = useCallback(() => {
    pendingRangeRef.current = null;
    setStatus("idle");
  }, []);

  const resetState = useCallback(() => {
    pendingRangeRef.current = null;
    setStatus("idle");
  }, []);

  return {
    status,
    setStatus,
    pendingRange: pendingRangeRef,
    captureContext,
    startRecording,
    insertPartialResult,
    replaceWithPolished,
    replaceDocument,
    markConfirmed,
    hasUnsavedChanges,
    cancelInProgress,
    resetState,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/review/useInlineState.ts
git commit -m "feat(inline): add useInlineState hook for inline mode state management"
```

---

## Task 3: InlineStatusIndicator Component

**Files:**

- Create: `src/review/InlineStatusIndicator.tsx`
- Modify: `src/review/ReviewWindow.css`

- [ ] **Step 1: Create the status indicator component**

```tsx
import { useTranslation } from "react-i18next";
import type { InlineStatus } from "./useInlineState";

const STATUS_CONFIG: Record<
  InlineStatus,
  { icon: string; i18nKey: string | null; pulse: boolean }
> = {
  idle: { icon: "", i18nKey: null, pulse: false },
  listening: { icon: "🎤", i18nKey: "inline.listening", pulse: true },
  transcribing: { icon: "⏳", i18nKey: "inline.transcribing", pulse: false },
  polishing: { icon: "✨", i18nKey: "inline.polishing", pulse: false },
  executing: { icon: "⚡", i18nKey: "inline.executing", pulse: false },
  complete: { icon: "✅", i18nKey: "inline.complete", pulse: false },
};

interface Props {
  status: InlineStatus;
  promptName?: string;
}

export function InlineStatusIndicator({ status, promptName }: Props) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];

  if (!config.i18nKey) return null;

  const text =
    status === "polishing" && promptName
      ? `${t(config.i18nKey)} ${promptName}`
      : t(config.i18nKey);

  return (
    <div
      className={`inline-status-indicator ${config.pulse ? "inline-status-pulse" : ""} ${status === "complete" ? "inline-status-fade" : ""}`}
    >
      <span className="inline-status-icon">{config.icon}</span>
      <span className="inline-status-text">{text}</span>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS styles**

Add to `ReviewWindow.css`:

```css
.inline-status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--gray-11);
  transition: opacity 0.3s ease;
}

.inline-status-icon {
  font-size: 14px;
}

.inline-status-pulse {
  animation: inline-pulse 1.5s ease-in-out infinite;
}

@keyframes inline-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.inline-status-fade {
  animation: inline-fade-out 1.5s ease forwards;
}

@keyframes inline-fade-out {
  0% {
    opacity: 1;
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/review/InlineStatusIndicator.tsx src/review/ReviewWindow.css
git commit -m "feat(inline): add InlineStatusIndicator component with pulse animation"
```

---

## Task 4: SectionTitleBar Component

**Files:**

- Create: `src/review/SectionTitleBar.tsx`

- [ ] **Step 1: Create the section title bar**

```tsx
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
}

export function SectionTitleBar({ editor }: Props) {
  const { t } = useTranslation();
  const canUndo = editor?.can().undo() ?? false;
  const canRedo = editor?.can().redo() ?? false;

  return (
    <div className="inline-section-title-bar">
      <span className="inline-section-title">{t("inline.sectionTitle")}</span>
      <div className="inline-section-actions">
        <button
          className="inline-undo-redo-btn"
          disabled={!canUndo}
          onClick={() => editor?.commands.undo()}
          title={t("inline.undo")}
        >
          ◀
        </button>
        <button
          className="inline-undo-redo-btn"
          disabled={!canRedo}
          onClick={() => editor?.commands.redo()}
          title={t("inline.redo")}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS to ReviewWindow.css**

```css
.inline-section-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--gray-4);
  font-size: 12px;
  color: var(--gray-11);
}

.inline-section-title {
  font-weight: 500;
}

.inline-section-actions {
  display: flex;
  gap: 4px;
}

.inline-undo-redo-btn {
  background: none;
  border: 1px solid var(--gray-6);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  color: var(--gray-11);
  transition: background 0.15s;
}

.inline-undo-redo-btn:hover:not(:disabled) {
  background: var(--gray-3);
}

.inline-undo-redo-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/review/SectionTitleBar.tsx src/review/ReviewWindow.css
git commit -m "feat(inline): add SectionTitleBar with undo/redo buttons"
```

---

## Task 5: InlineEditor Component

**Files:**

- Create: `src/review/InlineEditor.tsx`

- [ ] **Step 1: Create the inline TipTap editor**

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  initialContent?: string;
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
}

export interface InlineEditorRef {
  getEditor: () => ReturnType<typeof useEditor>;
}

export const InlineEditor = forwardRef<InlineEditorRef, Props>(
  ({ initialContent, onEditorReady }, ref) => {
    const { t } = useTranslation();

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // StarterKit v3 includes undoRedo (formerly History) by default
          undoRedo: { depth: 20, newGroupDelay: 500 },
        }),
        Placeholder.configure({
          placeholder: t("inline.placeholder"),
        }),
      ],
      content: initialContent || "",
      editable: true,
      editorProps: {
        attributes: {
          class: "inline-editor-content",
        },
      },
    });

    useImperativeHandle(ref, () => ({
      getEditor: () => editor,
    }));

    useEffect(() => {
      if (editor && onEditorReady) {
        onEditorReady(editor);
      }
    }, [editor, onEditorReady]);

    return (
      <div className="inline-editor-wrapper">
        <EditorContent editor={editor} />
      </div>
    );
  },
);

InlineEditor.displayName = "InlineEditor";
```

**Note on undo grouping for streaming partials:** The `newGroupDelay: 500` config groups rapid edits (< 500ms apart) into a single undo step. Since streaming partial results arrive rapidly, they will naturally be grouped. If finer control is needed, use `editor.chain().command(({ tr }) => { tr.setMeta("addToHistory", false); ... }).run()` for intermediate partials and only allow the final result to create an undo entry.

- [ ] **Step 2: Add CSS to ReviewWindow.css**

```css
.inline-editor-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  max-height: calc(720px - 120px);
}

.inline-editor-content {
  outline: none;
  min-height: 100px;
  font-size: 14px;
  line-height: 1.6;
}

.inline-editor-content .is-empty::before {
  content: attr(data-placeholder);
  color: var(--gray-8);
  pointer-events: none;
  float: left;
  height: 0;
}

.inline-highlight-flash {
  animation: inline-flash 0.6s ease;
}

@keyframes inline-flash {
  0% {
    background-color: var(--accent-3);
  }
  100% {
    background-color: transparent;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/review/InlineEditor.tsx src/review/ReviewWindow.css
git commit -m "feat(inline): add InlineEditor component with TipTap and History extension"
```

---

## Task 6: Backend — Inline Context Storage & Command

**Files:**

- Modify: `src-tauri/src/review_window.rs`
- Modify: `src-tauri/src/shortcut/review_cmds.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add InlineContext struct and storage to review_window.rs**

Add near the top of `review_window.rs`, after the existing static mutexes:

```rust
#[derive(Debug, Clone, serde::Deserialize)]
pub struct InlineContext {
    pub before_cursor: String,
    pub after_cursor: String,
    pub selected_text: Option<String>,
}

static INLINE_CONTEXT: std::sync::Mutex<Option<InlineContext>> = std::sync::Mutex::new(None);

pub fn store_inline_context(ctx: InlineContext) {
    *INLINE_CONTEXT.lock().unwrap() = Some(ctx);
}

pub fn take_inline_context() -> Option<InlineContext> {
    INLINE_CONTEXT.lock().unwrap().take()
}

pub fn has_inline_context() -> bool {
    INLINE_CONTEXT.lock().unwrap().is_some()
}
```

- [ ] **Step 2: Add inline_submit_context Tauri command to review_cmds.rs**

```rust
#[tauri::command]
#[specta::specta]
pub async fn inline_submit_context(
    before_cursor: String,
    after_cursor: String,
    selected_text: Option<String>,
) -> Result<(), String> {
    crate::review_window::store_inline_context(
        crate::review_window::InlineContext {
            before_cursor,
            after_cursor,
            selected_text,
        },
    );
    Ok(())
}
```

- [ ] **Step 3: Register the command in lib.rs**

Find the `.invoke_handler(tauri::generate_handler![...])` block in `lib.rs` and add `review_cmds::inline_submit_context` to the handler list.

- [ ] **Step 4: Verify build**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/review_window.rs src-tauri/src/shortcut/review_cmds.rs src-tauri/src/lib.rs
git commit -m "feat(inline): add InlineContext storage and inline_submit_context command"
```

---

## Task 7: Backend — Inline Event Emission Helpers

**Files:**

- Modify: `src-tauri/src/review_window.rs`

- [ ] **Step 1: Add event payload structs and emission helpers**

Add to `review_window.rs`:

```rust
#[derive(Clone, serde::Serialize)]
pub struct InlineStartPayload {
    pub binding_id: String,
}

#[derive(Clone, serde::Serialize)]
pub struct InlinePartialPayload {
    pub text: String,
    pub is_final: bool,
}

#[derive(Clone, serde::Serialize)]
pub struct InlineResultPayload {
    pub text: String,
    pub history_id: Option<i64>,
}

#[derive(Clone, serde::Serialize)]
pub struct InlinePolishPayload {
    pub text: String,
    pub success: bool,
}

#[derive(Clone, serde::Serialize)]
pub struct InlineSkillPayload {
    pub text: String,
    pub success: bool,
}

pub fn emit_inline_start(app: &tauri::AppHandle, binding_id: &str) {
    let _ = app.emit("review-window-inline-start", InlineStartPayload {
        binding_id: binding_id.to_string(),
    });
}

pub fn emit_inline_partial(app: &tauri::AppHandle, text: &str, is_final: bool) {
    let _ = app.emit("review-window-inline-partial", InlinePartialPayload {
        text: text.to_string(),
        is_final,
    });
}

pub fn emit_inline_result(app: &tauri::AppHandle, text: &str, history_id: Option<i64>) {
    let _ = app.emit("review-window-inline-result", InlineResultPayload {
        text: text.to_string(),
        history_id,
    });
}

pub fn emit_inline_polish(app: &tauri::AppHandle, text: &str, success: bool) {
    let _ = app.emit("review-window-inline-polish", InlinePolishPayload {
        text: text.to_string(),
        success,
    });
}

pub fn emit_inline_skill(app: &tauri::AppHandle, text: &str, success: bool) {
    let _ = app.emit("review-window-inline-skill", InlineSkillPayload {
        text: text.to_string(),
        success,
    });
}
```

- [ ] **Step 2: Verify build**

Run: `cd src-tauri && cargo check`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/review_window.rs
git commit -m "feat(inline): add inline event payload structs and emission helpers"
```

---

## Task 8: Backend — Inline Mode in Transcription Pipeline

**Files:**

- Modify: `src-tauri/src/actions/transcribe.rs`
- Modify: `src-tauri/src/actions/post_process/pipeline.rs`

This is the most complex task. The transcription pipeline in `TranscribeAction::stop()` needs to branch based on whether inline context was stored.

- [ ] **Step 1: Add inline context parameter to post-processing**

In `pipeline.rs`, add an `inline_context` parameter to `maybe_post_process_transcription()`:

```rust
// Add to the function signature, after `selected_text: Option<String>`:
    inline_context: Option<crate::review_window::InlineContext>,
```

When `inline_context` is `Some`, inject the `before_cursor` and `after_cursor` into the polish prompt's user message as surrounding context. The exact injection point depends on how the prompt template is built — look for where `selected_text` context is injected in `core.rs` and follow the same pattern.

- [ ] **Step 2: Branch the stop() pipeline for inline mode**

In `transcribe.rs`, in the async block spawned by `stop()`, after transcription completes and before the post-processing/review window section:

1. Call `crate::review_window::take_inline_context()` to check if inline mode is active
2. If `Some(inline_ctx)`:
   - Emit `review-window-inline-result` with the ASR text
   - Run post-processing with `inline_context` passed through
   - On success: emit `review-window-inline-polish` with polished text
   - On failure: emit `review-window-inline-polish` with `success: false`
   - If `inline_ctx.selected_text.is_some()`: treat as skill/command, emit `review-window-inline-skill` instead
   - Skip the normal review window display and auto-paste logic
   - Still save to history
3. If `None`: follow existing flow unchanged

- [ ] **Step 3: Forward realtime partials to inline mode**

Find where `realtime-partial` events are emitted (for the recording overlay). When inline context is present, also emit `review-window-inline-partial` with the same text. Check `has_inline_context()` to determine this.

- [ ] **Step 4: Update all callers of maybe_post_process_transcription**

Add `None` for the new `inline_context` parameter at all existing call sites:

- `src-tauri/src/actions/transcribe.rs` — 2 call sites (around lines 1199 and 1318)
- `src-tauri/src/commands/mod.rs` — 2 call sites (around lines 334 and 475)
- `src-tauri/src/commands/history.rs` — 1 call site (around line 287)
- Check `src-tauri/src/actions/post_process/manual.rs` for any wrappers

Only the new inline branch passes `Some(inline_ctx)`.

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo check`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions/transcribe.rs src-tauri/src/actions/post_process/pipeline.rs
git commit -m "feat(inline): route transcription pipeline for inline mode with context injection"
```

---

## Task 9: Frontend — Review Window Mode State & Event Listeners

**Files:**

- Modify: `src/review/main.tsx`
- Modify: `src/review/ReviewWindow.tsx`

- [ ] **Step 1: Add inline event listeners in main.tsx**

In the `useEffect` that registers event listeners (around line 63), add listeners for the new events:

```typescript
const unlistenInlineStart = await listen<{ binding_id: string }>(
  "review-window-inline-start",
  (event) => {
    setInlineEvent({ type: "start", data: event.payload });
  },
);

const unlistenInlinePartial = await listen<{ text: string; is_final: boolean }>(
  "review-window-inline-partial",
  (event) => {
    setInlineEvent({ type: "partial", data: event.payload });
  },
);

const unlistenInlineResult = await listen<{
  text: string;
  history_id: number | null;
}>("review-window-inline-result", (event) => {
  setInlineEvent({ type: "result", data: event.payload });
});

const unlistenInlinePolish = await listen<{ text: string; success: boolean }>(
  "review-window-inline-polish",
  (event) => {
    setInlineEvent({ type: "polish", data: event.payload });
  },
);

const unlistenInlineSkill = await listen<{ text: string; success: boolean }>(
  "review-window-inline-skill",
  (event) => {
    setInlineEvent({ type: "skill", data: event.payload });
  },
);
```

Add a new state: `const [inlineEvent, setInlineEvent] = useState<InlineEvent | null>(null);`

Pass `inlineEvent` as a prop to `ReviewWindow`, and clean up all unlisten in the return.

**Important:** The existing `main.tsx` only renders `ReviewWindow` when `reviewData` or `multiCandidateData` is set. For standalone inline mode (opened from tray without prior transcription), add a third rendering condition: a `standaloneInlineMode` state that is set to `true` when the window is opened directly for inline editing. This ensures `ReviewWindow` renders even without review data.

- [ ] **Step 2: Add top-level mode state to ReviewWindow.tsx**

Add a `topMode` state:

```typescript
const [topMode, setTopMode] = useState<"review" | "inline">("review");
```

When `reviewData` is set (via `review-window-show`), set `topMode` to `"review"`. Provide `setTopMode` to Header for the toggle button.

- [ ] **Step 3: Handle inline events in ReviewWindow**

Add a `useEffect` that watches the `inlineEvent` prop and dispatches to `useInlineState` methods:

```typescript
useEffect(() => {
  if (!inlineEvent || topMode !== "inline") return;
  switch (inlineEvent.type) {
    case "start":
      // If polish/executing is in progress, cancel it first (spec Section 9)
      if (
        inlineState.status === "polishing" ||
        inlineState.status === "executing"
      ) {
        inlineState.cancelInProgress();
      }
      inlineState.startRecording();
      break;
    case "partial":
      inlineState.insertPartialResult(inlineEvent.data.text);
      if (inlineEvent.data.is_final) inlineState.setStatus("transcribing");
      break;
    case "result":
      inlineState.insertPartialResult(inlineEvent.data.text);
      inlineState.setStatus("polishing");
      break;
    case "polish":
      if (inlineEvent.data.success) {
        inlineState.replaceWithPolished(inlineEvent.data.text);
      } else {
        inlineState.setStatus("idle");
      }
      break;
    case "skill":
      if (inlineEvent.data.success) {
        inlineState.replaceDocument(inlineEvent.data.text);
      } else {
        inlineState.setStatus("idle");
      }
      break;
  }
}, [inlineEvent]);
```

- [ ] **Step 4: Commit**

```bash
git add src/review/main.tsx src/review/ReviewWindow.tsx
git commit -m "feat(inline): add mode state and inline event handling to ReviewWindow"
```

---

## Task 10: Frontend — Shortcut Handling in Inline Mode

**Files:**

- Modify: `src/review/ReviewWindow.tsx`

- [ ] **Step 1: Update the shortcut handler to bypass isEditableTarget in inline mode**

Find the keydown handler (around line 1062) and modify it:

```typescript
// Before the existing isEditableTarget check, add:
const isInlineMode = topMode === "inline";

// Replace the isEditableTarget guard:
// OLD: if (isEditableTarget(event.target as HTMLElement)) return;
// NEW:
if (!isInlineMode && isEditableTarget(event.target as HTMLElement)) return;
```

- [ ] **Step 2: Add context submission before dispatch**

When the shortcut matches in inline mode, capture context and submit it before dispatching:

```typescript
if (isInlineMode && inlineEditorRef.current) {
  const context = inlineState.captureContext();
  await invoke("inline_submit_context", {
    beforeCursor: context.before_cursor,
    afterCursor: context.after_cursor,
    selectedText: context.selected_text,
  });
}

// Then dispatch as before:
await invoke("dispatch_transcribe_binding_from_review", {
  bindingId,
  isPressed: true,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/review/ReviewWindow.tsx
git commit -m "feat(inline): bypass isEditableTarget guard and submit context in inline mode"
```

---

## Task 11: Frontend — Header Mode Toggle

**Files:**

- Modify: `src/review/ReviewHeader.tsx`

- [ ] **Step 1: Add mode toggle button to ReviewHeader**

Add a new prop `topMode: "review" | "inline"` and `onToggleMode: () => void` to the header props interface.

Render a toggle button in the header, visible in all sub-modes:

Use Tabler icons (already used throughout the codebase) instead of emoji:

```tsx
import { IconPencil, IconEye } from "@tabler/icons-react";

<button
  className="inline-mode-toggle-btn"
  onClick={onToggleMode}
  title={t("inline.modeToggle")}
>
  {topMode === "review" ? <IconPencil size={16} /> : <IconEye size={16} />}
</button>;
```

Position it on the right side of the header, before existing controls.

- [ ] **Step 2: Add CSS**

```css
.inline-mode-toggle-btn {
  background: none;
  border: 1px solid var(--gray-6);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.inline-mode-toggle-btn:hover {
  background: var(--gray-3);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/review/ReviewHeader.tsx src/review/ReviewWindow.css
git commit -m "feat(inline): add mode toggle button to ReviewHeader"
```

---

## Task 12: Frontend — Footer Status Integration

**Files:**

- Modify: `src/review/ReviewFooter.tsx`

- [ ] **Step 1: Add status indicator to footer**

Add props for inline mode:

```typescript
interface ReviewFooterProps {
  // ... existing props
  isInlineMode?: boolean;
  inlineStatus?: InlineStatus;
  promptName?: string;
}
```

Render `InlineStatusIndicator` on the left side when `isInlineMode` is true:

```tsx
<div className="review-footer">
  <div className="review-footer-left">
    {isInlineMode ? (
      <InlineStatusIndicator
        status={inlineStatus ?? "idle"}
        promptName={promptName}
      />
    ) : (
      reason && <span className="review-footer-reason">{reason}</span>
    )}
  </div>
  <div className="review-footer-right">{/* existing buttons */}</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/review/ReviewFooter.tsx
git commit -m "feat(inline): integrate InlineStatusIndicator into ReviewFooter"
```

---

## Task 13: Frontend — Inline Mode Rendering in ReviewWindow

**Files:**

- Modify: `src/review/ReviewWindow.tsx`

- [ ] **Step 1: Conditionally render InlineEditor when in inline mode**

In the main render of `ReviewWindow.tsx`, add a conditional branch:

```tsx
{topMode === "inline" ? (
  <>
    <SectionTitleBar editor={inlineEditor} />
    <InlineEditor
      ref={inlineEditorRef}
      initialContent={inlineInitialContent}
      onEditorReady={(editor) => {
        setInlineEditor(editor);
        inlineState.markConfirmed();
      }}
    />
  </>
) : (
  // existing review mode rendering (editor, diff view, multi-candidate, etc.)
)}
```

- [ ] **Step 2: Add close confirmation in ESC handler**

Modify the existing ESC/cancel handler to check for unsaved changes in inline mode. Use a state-driven Radix `AlertDialog` (already available via `@radix-ui/themes`) instead of `window.confirm` to stay consistent with the app's design:

```typescript
const [showCloseConfirm, setShowCloseConfirm] = useState(false);

// In ESC handler:
if (topMode === "inline" && inlineState.hasUnsavedChanges()) {
  setShowCloseConfirm(true);
  return; // Don't close yet
}
// proceed with existing cancel/close logic
```

Render the dialog in JSX:

```tsx
<AlertDialog.Root open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
  <AlertDialog.Content>
    <AlertDialog.Title>{t("inline.closeConfirmTitle")}</AlertDialog.Title>
    <AlertDialog.Description>
      {t("inline.closeConfirmMessage")}
    </AlertDialog.Description>
    <Flex gap="3" justify="end">
      <AlertDialog.Cancel>
        <Button variant="soft">{t("inline.closeConfirmCancel")}</Button>
      </AlertDialog.Cancel>
      <AlertDialog.Action>
        <Button color="red" onClick={handleForceClose}>
          {t("inline.closeConfirmOk")}
        </Button>
      </AlertDialog.Action>
    </Flex>
  </AlertDialog.Content>
</AlertDialog.Root>
```

- [ ] **Step 3: Handle transition from review to inline after confirm**

When the user confirms a review result (in `handleInsert`), if we want to transition to inline mode, set the `inlineInitialContent` to the confirmed text and switch mode:

```typescript
// After successful insert, optionally stay in window:
setInlineInitialContent(text);
setTopMode("inline");
```

Note: This step needs careful consideration — currently `handleInsert` also hides the window and pastes. The transition to inline mode should be an alternative path (e.g., a "Keep Editing" button). For now, just wire up the state; the UX for this transition will be refined.

- [ ] **Step 4: Wire window resize for inline mode**

When entering inline mode with empty content, call `invoke("resize_review_window", { width: 480, height: 320, reposition: false })` to set the default size.

- [ ] **Step 5: Commit**

```bash
git add src/review/ReviewWindow.tsx
git commit -m "feat(inline): render InlineEditor in inline mode with close confirmation"
```

---

## Task 14: Integration Testing & Polish

**Files:**

- All modified files

- [ ] **Step 1: Manual integration test — inline mode entry**

1. Start the app with `bun tauri dev`
2. Trigger a transcription via shortcut → review window appears in `review` mode
3. Click the mode toggle → switches to `inline` mode with editable content
4. Verify: text is editable, undo/redo buttons work, section title bar shows

- [ ] **Step 2: Manual integration test — inline recording**

1. In inline mode, press the transcribe shortcut
2. Verify: Footer shows "Listening..." with pulse animation
3. Speak → verify ASR results appear at cursor position
4. Verify: status transitions through listening → transcribing → polishing → complete
5. Verify: polished text replaces ASR text with highlight flash

- [ ] **Step 3: Manual integration test — voice command**

1. In inline mode, select some text
2. Press the transcribe shortcut
3. Speak a correction command (e.g., "把这个改成...")
4. Verify: command executes, text is replaced, no confirmation dialog

- [ ] **Step 4: Manual integration test — close confirmation**

1. Edit text in inline mode
2. Press ESC
3. Verify: confirmation dialog appears
4. Click Cancel → stays in editor
5. Click Close → window closes

- [ ] **Step 5: Manual integration test — undo/redo**

1. In inline mode, perform several ASR insertions
2. Press Cmd+Z → verify each insertion is undone as a unit
3. Press Cmd+Shift+Z → verify redo works
4. Click undo/redo buttons in section title bar → same behavior

- [ ] **Step 6: Format code**

Run: `bun format`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(inline): integration polish and formatting"
```

---

## Execution Order & Dependencies

```
Task 1 (i18n) ─────────────────────┐
Task 2 (useInlineState) ───────────┤
Task 3 (InlineStatusIndicator) ────┤
Task 4 (SectionTitleBar) ──────────┤── All independent, can parallelize
Task 5 (InlineEditor) ─────────────┤
Task 6 (Backend context storage) ──┤
Task 7 (Backend event helpers) ────┘
                                    │
Task 8 (Backend pipeline) ─────────┤── Depends on 6, 7
                                    │
Task 9 (Frontend events+state) ────┤── Depends on 2
Task 10 (Frontend shortcuts) ──────┤── Depends on 2, 9
Task 11 (Header toggle) ───────────┤── Depends on 9
Task 12 (Footer status) ───────────┤── Depends on 3
Task 13 (ReviewWindow rendering) ──┤── Depends on 4, 5, 9, 10, 11, 12
                                    │
Task 14 (Integration testing) ─────┘── Depends on all above
```

Tasks 1-7 are independent and can be executed in parallel. Tasks 8-13 have sequential dependencies. Task 14 is the final integration pass.
