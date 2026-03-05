// ReviewWindow - Independent window for reviewing low-confidence transcriptions
// This provides a floating window UI for editing and inserting transcribed text

import { Button, Tooltip } from "@radix-ui/themes";
import { IconCheck, IconClipboard, IconTextPlus } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Extension, Mark } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import hljs from "highlight.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { escapeHtml } from "../lib/utils/html";
import { log } from "../lib/utils/logging";
import { MultiModelCandidate } from "./CandidatePanel";
import { DiffViewPanel } from "./DiffViewPanel";
import { MultiCandidateView } from "./MultiCandidateView";
import { ReviewFooter } from "./ReviewFooter";
import { PromptInfo, ReviewHeader, ReviewModelOption } from "./ReviewHeader";
import "./ReviewWindow.css";
import { buildDiffViews } from "./diff-utils";
import { simpleMarkdownToHtml } from "./markdown-utils";

interface ReviewData {
  source_text: string;
  final_text: string;
  change_percent: number;
  history_id: number | null;
  reason?: string | null;
  output_mode?: "polish" | "chat";
  skill_name?: string | null;
}

interface ReviewWindowProps {
  initialData: ReviewData;
  multiCandidates?: MultiModelCandidate[];
  onClose: () => void;
}

const DiffMark = Mark.create({
  name: "diffMark",
  addAttributes() {
    return {
      level: {
        default: "minor",
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-diff-level]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return { level: element.getAttribute("data-diff-level") };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const level = HTMLAttributes.level ?? "minor";
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-diff-level": level,
        class: `diff-mark diff-${level}`,
      },
      0,
    ];
  },
});

const CodeBlockComponent = ({
  node: { textContent },
  extension,
}: {
  node: { textContent: string };
  extension: { options: { HTMLAttributes?: Record<string, string> } };
}) => {
  const { t } = useTranslation();
  const [insertState, setInsertState] = useState<"idle" | "success">("idle");
  const [copyState, setCopyState] = useState<"idle" | "success">("idle");

  const handleInsert = useCallback(async () => {
    try {
      await invoke("paste_to_previous_window", { text: textContent });
      setInsertState("success");
      setTimeout(() => setInsertState("idle"), 2000);
    } catch (e) {
      console.error("Failed to insert code:", e);
    }
  }, [textContent]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopyState("success");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (e) {
      console.error("Failed to copy code:", e);
    }
  }, [textContent]);

  const language =
    extension.options?.HTMLAttributes?.class?.match(/language-(\w+)/)?.[1] ||
    "";

  const highlightedCode = useCallback(() => {
    if (!textContent) return "";
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(textContent.trim(), { language }).value;
      }
      return hljs.highlightAuto(textContent.trim()).value;
    } catch {
      return escapeHtml(textContent.trim());
    }
  }, [textContent, language]);

  return (
    <NodeViewWrapper className="code-block-wrapper relative group my-2">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-1">
        <Tooltip content={t("common.copy", "Copy")}>
          <Button
            size="1"
            variant="soft"
            color={copyState === "success" ? "green" : "gray"}
            onClick={handleCopy}
            className="cursor-pointer shadow-sm backdrop-blur-sm px-1.5!"
          >
            {copyState === "success" ? (
              <IconCheck size={14} />
            ) : (
              <IconClipboard size={14} />
            )}
          </Button>
        </Tooltip>
        <Tooltip content={t("transcription.review.insertCode", "Insert")}>
          <Button
            size="1"
            variant="soft"
            color={insertState === "success" ? "green" : "gray"}
            onClick={handleInsert}
            className="cursor-pointer shadow-sm backdrop-blur-sm px-1.5!"
          >
            {insertState === "success" ? (
              <IconCheck size={14} />
            ) : (
              <IconTextPlus size={14} />
            )}
          </Button>
        </Tooltip>
      </div>
      <pre className="bg-(--gray-3) p-3 rounded-md overflow-x-auto text-sm font-mono border border-(--gray-4)">
        <code
          className={`hljs ${language ? `language-${language}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode() }}
        />
      </pre>
    </NodeViewWrapper>
  );
};

const ReviewWindow: React.FC<ReviewWindowProps> = ({
  initialData,
  multiCandidates,
  onClose,
}) => {
  const { t } = useTranslation();
  const renderStartRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    multiCandidates && multiCandidates.length > 0
      ? multiCandidates[0].id
      : null,
  );
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(
    null,
  );

  // Prompt selector state for multi-candidate mode
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [localCandidates, setLocalCandidates] = useState<
    MultiModelCandidate[] | undefined
  >(multiCandidates);
  const [isRerunning, setIsRerunning] = useState(false);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});

  // Model selector state (single-model polish mode only)
  const [modelOptions, setModelOptions] = useState<ReviewModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [defaultModelLabel, setDefaultModelLabel] = useState<string>("");
  const [currentModelName, setCurrentModelName] = useState<string>("");

  // Fetch prompts and model options on mount
  useEffect(() => {
    invoke<{ prompts: PromptInfo[]; selected_id: string | null }>(
      "get_post_process_prompts",
    ).then((resp) => {
      setPrompts(resp.prompts);
      if (resp.selected_id) {
        setSelectedPromptId(resp.selected_id);
      } else if (resp.prompts.length > 0) {
        setSelectedPromptId(resp.prompts[0].id);
      }
    });
    // Fetch text-type models for single-model mode selector
    if (!multiCandidates || multiCandidates.length === 0) {
      invoke<{
        models: ReviewModelOption[];
        default_model_id: string | null;
      }>("get_review_model_options").then((resp) => {
        setModelOptions(resp.models);
        if (resp.default_model_id) {
          const dm = resp.models.find((m) => m.id === resp.default_model_id);
          if (dm) setDefaultModelLabel(dm.label);
        }
      });
    }
  }, []);

  // Sync external multiCandidates prop into local state
  // Skip during rerun — ReviewWindow owns local state while rerunning
  useEffect(() => {
    if (multiCandidates && !isRerunning) {
      setLocalCandidates(multiCandidates);
    }
  }, [multiCandidates]);

  // Listen for rerun reset and progress events
  useEffect(() => {
    if (!multiCandidates) return;
    let unlistenReset: (() => void) | null = null;
    let unlistenProgress: (() => void) | null = null;

    listen<{ candidates: MultiModelCandidate[] }>(
      "multi-model-rerun-reset",
      (event) => {
        setLocalCandidates(event.payload.candidates);
        setSelectedCandidateId(null);
        setEditingCandidateId(null);
        setEditedTexts({});
        setIsRerunning(true);
      },
    ).then((fn) => {
      unlistenReset = fn;
    });

    // Listen for progress events to update local candidates during rerun
    listen<{
      results: MultiModelCandidate[];
    }>("multi-post-process-progress", (event) => {
      const progress = event.payload;
      setLocalCandidates((prev) => {
        if (!prev) return prev;
        return prev.map((candidate) => {
          const completed = progress.results.find((r) => r.id === candidate.id);
          if (completed) {
            return {
              ...candidate,
              text: completed.text,
              confidence: completed.confidence,
              processing_time_ms: completed.processing_time_ms,
              error: completed.error,
              ready: completed.ready ?? true,
            };
          }
          return candidate;
        });
      });
    }).then((fn) => {
      unlistenProgress = fn;
    });

    return () => {
      unlistenReset?.();
      unlistenProgress?.();
    };
  }, [!!multiCandidates]);

  // Mark rerun done when all local candidates are ready
  useEffect(() => {
    if (
      isRerunning &&
      localCandidates &&
      localCandidates.length > 0 &&
      localCandidates.every((c) => c.ready)
    ) {
      setIsRerunning(false);
      // Auto-select first successful candidate
      const first = localCandidates.find((c) => !c.error);
      if (first) setSelectedCandidateId(first.id);
    }
  }, [isRerunning, localCandidates]);

  // The candidates to render (local state, updated by progress events)
  const displayCandidates = localCandidates || multiCandidates;

  // Use selected candidate text if in multi-candidate mode
  const currentText =
    selectedCandidateId && displayCandidates
      ? displayCandidates.find((c) => c.id === selectedCandidateId)?.text ||
        initialData.final_text
      : initialData.final_text;

  const [sourceHtml, setSourceHtml] = useState(() => {
    if (initialData.output_mode === "chat") return "";
    return buildDiffViews(initialData.source_text, currentText).sourceHtml;
  });
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");
  const insertShortcut = isMac ? "⌘⏎" : "Ctrl⏎";

  // Use refs to access latest callbacks inside Tiptap extension
  const insertRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});

  const measureAndResize = useCallback(async (reposition: boolean) => {
    const container = containerRef.current;
    if (!container) return;

    const header = container.querySelector(".review-header");
    const footer = container.querySelector(".review-footer");
    const headerH = header?.getBoundingClientRect().height ?? 44;
    const footerH = footer?.getBoundingClientRect().height ?? 52;

    const sourcePanel = container.querySelector(".review-panel-source");
    const outputPanel = container.querySelector(".review-panel-output");
    const chatSection = container.querySelector(".review-section-no-title");

    let contentH: number;
    if (sourcePanel && outputPanel) {
      // Panel mode: padding(24) + source + gap(10) + output
      const sourceH = sourcePanel.scrollHeight;
      const outputH = outputPanel.scrollHeight;
      contentH = 24 + sourceH + 10 + outputH;
    } else if (chatSection) {
      contentH = chatSection.scrollHeight + 24;
    } else {
      contentH = 200;
    }

    const totalH = headerH + contentH + footerH;
    const currentW = window.innerWidth;

    try {
      await invoke("resize_review_window", {
        width: currentW,
        height: totalH,
        reposition,
      });
    } catch (e) {
      console.error("[ReviewWindow] resize_review_window failed:", e);
    }
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          codeBlock: false,
        }),
        CodeBlock.extend({
          addNodeView() {
            return ReactNodeViewRenderer(CodeBlockComponent);
          },
        }),
        DiffMark,
        Placeholder.configure({
          placeholder: t(
            "transcription.review.placeholder",
            "Edit transcription...",
          ),
        }),
        Extension.create({
          name: "shortcuts",
          addKeyboardShortcuts() {
            return {
              "Mod-Enter": () => {
                insertRef.current();
                return true;
              },
              Tab: () => {
                insertRef.current();
                return true;
              },
              Escape: () => {
                cancelRef.current();
                return true;
              },
            };
          },
        }),
      ],
      content:
        initialData.output_mode === "chat"
          ? simpleMarkdownToHtml(initialData.final_text)
          : buildDiffViews(initialData.source_text, initialData.final_text)
              .targetHtml,
      editorProps: {
        attributes: {
          class: "review-editor",
        },
      },
    },
    [t],
  );

  useEffect(() => {
    renderStartRef.current = performance.now();
    void log("[ReviewWindow] render_start", {
      sourceChars: initialData.source_text.length,
      targetChars: initialData.final_text.length,
      outputMode: initialData.output_mode ?? "polish",
      changePercent: initialData.change_percent,
      historyId: initialData.history_id,
    });
  }, [
    initialData.source_text,
    initialData.final_text,
    initialData.output_mode,
    initialData.change_percent,
    initialData.history_id,
  ]);

  useEffect(() => {
    if (!editor) return;

    let content = "";
    let nextSourceHtml = "";
    const buildStart = performance.now();

    if (initialData.output_mode === "chat") {
      content = simpleMarkdownToHtml(initialData.final_text.trim());
    } else {
      const views = buildDiffViews(
        initialData.source_text,
        initialData.final_text,
      );
      content = views.targetHtml;
      nextSourceHtml = views.sourceHtml;
    }

    const buildDurationMs = Math.round(performance.now() - buildStart);
    void log("[ReviewWindow] content_build_done", {
      outputMode: initialData.output_mode ?? "polish",
      buildDurationMs,
      targetHtmlChars: content.length,
      sourceHtmlChars: nextSourceHtml.length,
    });

    const setStart = performance.now();
    editor.commands.setContent(content, { emitUpdate: false });
    const setDurationMs = Math.round(performance.now() - setStart);
    void log("[ReviewWindow] editor_set_content_done", {
      setDurationMs,
      targetHtmlChars: content.length,
    });
    setSourceHtml(nextSourceHtml);
  }, [
    editor,
    initialData.source_text,
    initialData.final_text,
    initialData.output_mode,
  ]);

  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    const focusTimer = window.setTimeout(() => {
      if (disposed || editor.isDestroyed) return;
      editor.commands.focus("end");
    }, 50);

    // Multi-model mode: backend already sized and showed the window directly,
    // skip frontend measure/resize to avoid overriding the correct size.
    // Single-model/chat mode: measure DOM, resize, then notify backend to show.
    const isMultiModel = multiCandidates && multiCandidates.length > 0;
    const readyTimer = window.setTimeout(async () => {
      if (disposed) return;
      if (!isMultiModel) {
        try {
          await measureAndResize(true);
        } catch (e) {
          console.error("Failed to measure/resize:", e);
        }
        const renderStart = renderStartRef.current;
        const renderDurationMs = renderStart
          ? Math.round(performance.now() - renderStart)
          : null;
        void log("[ReviewWindow] content_ready", {
          renderDurationMs,
          outputMode: initialData.output_mode ?? "polish",
        });
        invoke("review_window_content_ready").catch((e) => {
          console.error("Failed to notify content ready:", e);
        });
      }
    }, 16);

    return () => {
      disposed = true;
      window.clearTimeout(focusTimer);
      window.clearTimeout(readyTimer);
    };
  }, [editor]);

  const getEditorText = useCallback(() => {
    // In multi-candidate mode, return edited or original candidate text
    if (displayCandidates && selectedCandidateId) {
      const edited = editedTexts[selectedCandidateId];
      if (edited !== undefined) return edited;
      const candidate = displayCandidates.find(
        (c) => c.id === selectedCandidateId,
      );
      return candidate?.text || "";
    }
    if (!editor) return "";
    return editor.getText({ blockSeparator: "\n" });
  }, [editor, displayCandidates, selectedCandidateId, editedTexts]);

  const handleInsert = useCallback(async () => {
    const currentText = getEditorText();
    if (isSubmitting || !currentText.trim()) return;

    setIsSubmitting(true);

    try {
      await invoke("confirm_reviewed_transcription", {
        text: currentText.trim(),
        history_id: initialData.history_id,
        cached_model_id: selectedCandidateId || undefined,
      });
      onClose();
    } catch (e) {
      console.error("Failed to insert reviewed text:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    getEditorText,
    initialData.history_id,
    onClose,
    isSubmitting,
    selectedCandidateId,
  ]);

  // Direct insert for a specific candidate text (one-click from hover button)
  const handleDirectInsert = useCallback(
    async (text: string, candidateId?: string) => {
      if (isSubmitting || !text.trim()) return;
      setIsSubmitting(true);
      try {
        await invoke("confirm_reviewed_transcription", {
          text: text.trim(),
          history_id: initialData.history_id,
          cached_model_id: candidateId || undefined,
        });
        onClose();
      } catch (e) {
        console.error("Failed to insert text:", e);
      } finally {
        setIsSubmitting(false);
      }
    },
    [initialData.history_id, onClose, isSubmitting],
  );

  // Keep refs updated
  useEffect(() => {
    insertRef.current = handleInsert;
  }, [handleInsert]);

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;

    const trimmed = getEditorText().trim();
    const historyId = initialData.history_id;
    onClose();

    void (async () => {
      try {
        await invoke("cancel_transcription_review", {
          text: trimmed.length > 0 ? trimmed : null,
          history_id: historyId,
        });
      } catch (e) {
        console.error("Failed to cancel review:", e);
      }
    })();
  }, [onClose, isSubmitting, initialData.history_id, getEditorText]);

  // Keep refs updated
  useEffect(() => {
    cancelRef.current = handleCancel;
  }, [handleCancel]);

  // Navigate between ready candidates in multi-model mode
  const getNextReadyCandidate = useCallback(
    (direction: 1 | -1): string | null => {
      if (!displayCandidates) return null;
      const ready = displayCandidates.filter((c) => c.ready && !c.error);
      if (ready.length === 0) return null;
      const currentIdx = ready.findIndex((c) => c.id === selectedCandidateId);
      const nextIdx = (currentIdx + direction + ready.length) % ready.length;
      return ready[nextIdx].id;
    },
    [displayCandidates, selectedCandidateId],
  );

  // In multi-model mode, Tiptap editor is not rendered so its keyboard
  // shortcuts don't fire. Register a global keydown listener with
  // two-level focus model (List Mode / Edit Mode).
  useEffect(() => {
    if (!displayCandidates || displayCandidates.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Enter: insert in both modes
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        insertRef.current();
        return;
      }

      if (editingCandidateId === null) {
        // === List Mode ===
        if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          const next = getNextReadyCandidate(1);
          if (next) setSelectedCandidateId(next);
        } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
          e.preventDefault();
          const prev = getNextReadyCandidate(-1);
          if (prev) setSelectedCandidateId(prev);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (selectedCandidateId) {
            setEditingCandidateId(selectedCandidateId);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelRef.current();
        }
      } else {
        // === Edit Mode ===
        if (e.key === "Escape") {
          e.preventDefault();
          setEditingCandidateId(null);
        } else if (e.key === "Tab") {
          e.preventDefault();
          setEditingCandidateId(null);
        }
        // All other keys pass through to the focused textarea
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    displayCandidates,
    editingCandidateId,
    selectedCandidateId,
    getNextReadyCandidate,
  ]);

  const handleDrag = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    } catch (e) {
      console.error("Failed to start dragging:", e);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getEditorText());
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  }, [getEditorText]);

  const handlePromptRerunReset = useCallback(
    (promptId: string, candidates: MultiModelCandidate[]) => {
      setSelectedPromptId(promptId);
      setLocalCandidates(candidates);
      setSelectedCandidateId(null);
      setEditingCandidateId(null);
      setEditedTexts({});
      setIsRerunning(true);
    },
    [],
  );

  const getHeaderMode = (): "multi" | "polish" | "chat" => {
    if (multiCandidates && multiCandidates.length > 0) return "multi";
    if (initialData.output_mode === "chat") return "chat";
    return "polish";
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center p-0 box-border overflow-hidden bg-transparent">
      <div className="review-window-container" ref={containerRef}>
        <div
          className="cursor-grab select-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            // Only trigger dragging if the target (or its parent) isn't the close button
            if (!(e.target as HTMLElement).closest(".review-close-button")) {
              e.preventDefault();
              handleDrag();
            }
          }}
        >
          <ReviewHeader
            mode={getHeaderMode()}
            skillName={initialData.skill_name}
            prompts={prompts}
            selectedPromptId={selectedPromptId}
            modelOptions={modelOptions}
            selectedModelId={selectedModelId}
            defaultModelLabel={defaultModelLabel}
            sourceText={initialData.source_text}
            historyId={initialData.history_id}
            editor={editor}
            onPromptChange={(promptId) => {
              if (multiCandidates && multiCandidates.length > 0) {
                // Multi mode: clear old results immediately
                handlePromptRerunReset(
                  promptId,
                  multiCandidates.map((c) => ({
                    ...c,
                    text: "",
                    confidence: undefined,
                    processing_time_ms: 0,
                    error: undefined,
                    ready: false,
                  })),
                );
              }
            }}
            onModelChange={setSelectedModelId}
            onCancel={handleCancel}
            onSourceHtmlChange={setSourceHtml}
            onModelNameChange={setCurrentModelName}
            onRerunStart={() => setIsRerunning(true)}
            onRerunEnd={() => setIsRerunning(false)}
            onMeasureAndResize={measureAndResize}
          />
        </div>

        {displayCandidates && displayCandidates.length > 0 ? (
          <MultiCandidateView
            sourceText={initialData.source_text}
            candidates={displayCandidates}
            selectedCandidateId={selectedCandidateId}
            editingCandidateId={editingCandidateId}
            editedTexts={editedTexts}
            onCandidateSelect={setSelectedCandidateId}
            onEditEnd={() => setEditingCandidateId(null)}
            onTextChange={(candidateId, text) => {
              setEditedTexts((prev) => ({ ...prev, [candidateId]: text }));
            }}
            onInsert={handleDirectInsert}
          />
        ) : initialData.output_mode !== "chat" ? (
          <DiffViewPanel
            sourceHtml={sourceHtml}
            editor={editor}
            isRerunning={isRerunning}
            currentModelName={currentModelName}
          />
        ) : (
          <div className="review-content-area">
            <div className="review-section review-section-final review-section-no-title">
              <EditorContent editor={editor} className="flex-1 min-h-0" />
            </div>
          </div>
        )}

        <ReviewFooter
          reason={initialData.reason}
          outputMode={initialData.output_mode}
          isSubmitting={isSubmitting}
          hasText={!!getEditorText().trim()}
          insertShortcut={insertShortcut}
          isMultiModel={!!displayCandidates && displayCandidates.length > 0}
          onCopy={handleCopy}
          onInsert={handleInsert}
        />
      </div>
    </div>
  );
};

export default ReviewWindow;
