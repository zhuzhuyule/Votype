# Inline Transcription Mode Design

> Review window becomes a unified content editing center with inline transcription, voice-command correction, and full skill support.

## Problem

Currently, after transcription completes, results are displayed in a floating review window. The user must confirm and insert text into the target application. This adds friction — especially for users who want to iteratively dictate, review, and refine content within the review window itself.

## Solution

Extend the Review window with an **inline editing mode** that allows:

1. Direct ASR input at cursor position with live text replacement
2. Voice-command corrections without manual editing
3. Full skill/prompt support — same capabilities as the standard flow
4. Undo/redo history for all operations

## Design

### 1. Trigger & Mode Switching

**Shortcut routing — frontend-driven:**

When the Review window has focus, shortcuts are intercepted by the frontend via `matchesShortcut()` in `ReviewWindow.tsx` (the backend `handle_shortcut_event()` blocks transcribe shortcuts when Review is focused). The frontend already calls `dispatch_transcribe_binding_from_review` for this case. Inline mode extends this existing path.

**`isEditableTarget` guard:** The existing shortcut handler in `ReviewWindow.tsx` has an `isEditableTarget()` guard that returns early when the event target is inside a ProseMirror/contenteditable element. In `inline` mode this guard must be bypassed — the shortcut handler should be mode-aware: skip the `isEditableTarget` check when in `inline` mode, keep it in `review` mode. This is safe because transcribe shortcuts use modifier keys or non-character keys that don't conflict with normal text editing.

| Condition                                   | Path                   | Context Source                        |
| ------------------------------------------- | ---------------------- | ------------------------------------- |
| Review window **has focus** + no selection  | **Inline mode**        | `before_cursor` + `after_cursor` text |
| Review window **has focus** + has selection | **Skill/command mode** | Selected text + document content      |
| Review window **no focus**                  | **Standard flow**      | Unchanged (existing floating window)  |

**Mode state in ReviewWindow component:**

- `review` — existing read-only diff review mode (encompasses current `multi`, `polish`, `chat` sub-modes in ReviewHeader)
- `inline` — editable document mode (new, orthogonal to review sub-modes)

The existing `ReviewHeader` modes (`multi` / `polish` / `chat`) are sub-modes within `review`. The new `inline` mode is a top-level mode alongside `review`. The mode toggle in Header switches between these two top-level modes. The toggle is visible in all header states, including after multi-model candidate selection.

Transitions:

- Standard transcription completes → `review` mode (receives `review-window-show`)
- User confirms review result → content stays in document, switches to `inline` for continued editing
- User toggles via Header UI control → switch between modes
- User can also open Review window directly (via system tray menu or dedicated shortcut) → enters `inline` mode with empty document

**Entry points for inline mode:**

1. After confirming a review result — content stays, mode switches to `inline`
2. System tray menu "Open Editor" — opens Review window in `inline` mode with empty document
3. Header mode toggle — user manually switches from `review` to `inline`

### 2. Inline Recording & Text Replacement

**With focus — inline input flow:**

```
Shortcut pressed
  → Record cursor anchor (before_cursor / after_cursor)
  → Footer status: 🎤 Listening...
  → Local model: stream partial results, continuously replace anchor range
  → Remote ASR: insert full result after recording ends
  → ASR finalized → Footer status: ✨ Polishing...
  → Polish complete → replace anchor range with polished text
                    → brief highlight flash on changed region
                    → Footer returns to idle
  → Polish failed → keep ASR text as-is, no extra action
```

**Anchor replacement mechanism:**

Frontend maintains a `pendingRange`:

- `start`: cursor offset at shortcut press time
- `end`: dynamically updated as ASR text is written
- Each partial result → replaces `[start, end]` interval
- Polish result → final replacement of same interval
- On completion → clear `pendingRange`

**With selection — voice command correction:**

When the user selects text in the Review window and presses the shortcut, the ASR result is treated as a voice command operating on the selected content (or entire document if nothing selected but intent is detected as a command).

```
Shortcut pressed (with text selected in Review window)
  → Footer status: 🎤 Listening...
  → ASR complete → ASR text + selected content (or full document) sent as skill input
  → Direct execution (e.g., "change AAL to All right")
  → Result written back to document, no confirmation needed
  → Push to undo stack for quick rollback
```

### 3. Context Passing

**Timing:** Recording starts immediately on shortcut press. Context is captured by the frontend at the same moment and submitted via `inline_submit_context`. The backend only needs this context at polish/skill time (after ASR completes), so there is no race condition — context submission and recording happen in parallel, and context is consumed later.

**Inline mode:**

At shortcut press, frontend captures and submits:

- `before_cursor`: text before cursor position
- `after_cursor`: text after cursor position

These are injected into the polish prompt as context, enabling the LLM to understand the insertion point's surrounding content for higher quality polishing.

**Command mode (with selection):**

- Selected text → selected portion is the operation target, full document as context
- The ASR result is treated as a voice instruction/skill operating on the selection

### 4. UI Layout

```
┌─────────────────────────────────────────┐
│ [Prompt selector] [Mode toggle]  Header │
│─────────────────────────────────────────│
│ Transcription Result  [◀ Undo] [Redo ▶] │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                         │
│  Editable text area                     │
│  (contenteditable / textarea)           │
│                                         │
│─────────────────────────────────────────│
│ 🎤 Listening...           [Insert] Footer│
└─────────────────────────────────────────┘
```

**Header:** Prompt/model selector, mode toggle (review ↔ inline)

**Section title bar:** "Transcription Result" label on the left, undo/redo buttons on the right. Buttons are contextual to the text content they manage.

**Text area:** Editable region. User can freely type, move cursor, select text.

**Footer:** Left side shows status indicator (icon + text), right side retains action buttons (Insert/Copy).

### 5. Status Indicator (Footer)

| State             | Icon | Text                         | Visual                   |
| ----------------- | ---- | ---------------------------- | ------------------------ |
| Idle              | —    | —                            | Default                  |
| Listening         | 🎤   | "Listening..."               | Subtle pulse effect      |
| Transcribing      | ⏳   | "Transcribing..."            | Default                  |
| Polishing         | ✨   | "Polishing..." + prompt name | Default                  |
| Complete          | ✅   | Brief flash then fade        | Changed region highlight |
| Executing command | ⚡   | "Executing..."               | Default                  |

### 6. Undo/Redo

**Implementation:** Leverage TipTap's (ProseMirror) built-in History extension, which already handles Cmd+Z / Cmd+Shift+Z natively. No custom undo stack needed for manual edits.

**ASR/polish operations as atomic transactions:** Wrap each programmatic content change (ASR insert, polish replace, command execution) in a TipTap transaction so the built-in history treats it as a single undoable step. This ensures Cmd+Z reverts the entire polish result, not individual characters.

**Section title bar buttons:** The undo/redo buttons in the section title bar call TipTap's `editor.commands.undo()` / `editor.commands.redo()`. Buttons disabled when `editor.can().undo()` / `editor.can().redo()` returns false.

**Stack depth limit:** Configure TipTap History extension with `depth: 20`.

### 7. Close Confirmation

When the document has unsaved changes (content differs from last confirmed state), pressing ESC or clicking close triggers a confirmation dialog:

- "Content has been modified. Confirm close?"
- Confirm → close and discard
- Cancel → return to editing

No changes → close immediately without prompt.

### 8. Multi-Model Normalization

Multi-model mode is a variant of the editing window:

- Multiple candidates are displayed for selection (existing behavior)
- When the user selects a candidate, that candidate's text replaces the document content
- The `history_id` from the original transcription carries over to the new document state
- After selection, the user can manually switch to `inline` mode via the Header toggle to continue editing
- In `inline` mode, further recording or skill execution operates on the selected candidate's content
- The source text from the original transcription is no longer displayed (diff view is dismissed)

### 9. Concurrency & Edge Cases

| Scenario                            | Behavior                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| New shortcut press during recording | Follow existing activation mode (Hold/Toggle) to stop                    |
| New recording started during polish | Cancel polish, keep ASR text, start new recording at new cursor position |
| User manually edits during polish   | Cancel polish, keep user edits (user intent takes priority)              |
| Command executing + new recording   | Cancel command, keep original document content, start new recording      |
| Review window closed                | Clear all in-progress state, equivalent to cancel                        |

### 10. Backend Events & Commands

**New events (Backend → Frontend):**

| Event                          | Payload                | Purpose                                         |
| ------------------------------ | ---------------------- | ----------------------------------------------- |
| `review-window-inline-start`   | `{ binding_id }`       | Notify frontend to enter inline recording state |
| `review-window-inline-partial` | `{ text, is_final }`   | Streaming partial results (local model)         |
| `review-window-inline-result`  | `{ text, history_id }` | Final ASR result (remote, one-shot)             |
| `review-window-inline-polish`  | `{ text, success }`    | Polish complete, replace content                |
| `review-window-inline-skill`   | `{ text, success }`    | Voice command executed, write back              |

**New commands (Frontend → Backend):**

| Command                 | Payload                                          | Purpose                                |
| ----------------------- | ------------------------------------------------ | -------------------------------------- |
| `inline_submit_context` | `{ before_cursor, after_cursor, selected_text }` | Submit cursor context for polish/skill |

**Frontend routing (in `ReviewWindow.tsx` shortcut handler):**

The review window intercepts shortcuts via `matchesShortcut()` when it has focus (backend `handle_shortcut_event()` blocks transcribe shortcuts for focused review window). The frontend routing:

```
ReviewWindow shortcut handler (matchesShortcut)
  ├─ Has selected text in editor?
  │   └─ Submit context (selected_text + document) via inline_submit_context
  │   └─ Call dispatch_transcribe_binding_from_review → skill/command path
  │
  └─ No selection (cursor in editor)
      └─ Submit context (before_cursor + after_cursor) via inline_submit_context
      └─ Call dispatch_transcribe_binding_from_review → inline recording path
```

The backend determines inline mode by checking whether an `inline_submit_context` was received prior to the dispatch. If context was submitted, the pipeline operates in inline mode (emitting `inline-*` events); otherwise it follows the standard flow. The `dispatch_transcribe_binding_from_review` command signature remains unchanged — no new parameter needed.

## Files Affected

**Backend (Rust):**

- `src-tauri/src/shortcut/handler.rs` — focus detection, routing branch
- `src-tauri/src/actions/transcribe.rs` — inline mode pipeline variant
- `src-tauri/src/actions/post_process/pipeline.rs` — context injection for inline polish
- `src-tauri/src/review_window.rs` — new events, close confirmation

**Frontend (React/TypeScript):**

- `src/review/ReviewWindow.tsx` — dual mode (review/inline), shortcut routing logic, editable text area
- `src/review/ReviewHeader.tsx` — mode toggle control
- `src/review/ReviewFooter.tsx` — status indicator (icon + text)
- `src/review/InlineEditor.tsx` (new) — editable TipTap component with anchor tracking and transaction-based undo
- `src/i18n/locales/en/translation.json` — new i18n keys for status texts
- `src/i18n/locales/zh/translation.json` — Chinese translations for status texts

**Window sizing:** When entering inline mode with empty document, use a default size of 480x320. Auto-resize as content grows via existing `resize_review_window` mechanism, capped at max 1080x720. Beyond the max size, content scrolls within the editor area.

**Event naming:** New inline events use `review-window-inline-*` prefix (e.g., `review-window-inline-start`, `review-window-inline-partial`) for consistency with existing `review-window-*` event naming convention.

**Diff view transition:** When switching from `review` to `inline` mode, the diff source text is discarded and the final/selected text becomes the editable document content. Switching back to `review` mode is not supported (one-way transition per session; a new transcription triggers fresh `review` mode).
