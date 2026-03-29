// ReviewWindow - Independent window for reviewing low-confidence transcriptions
// This provides a floating window UI for editing and inserting transcribed text

import { Button, Tooltip } from "@radix-ui/themes";
import { IconCheck, IconClipboard, IconTextPlus } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Extension, Mark } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { escapeHtml } from "../lib/utils/html";
import { MultiModelCandidate } from "./CandidatePanel";
import { DiffViewPanel } from "./DiffViewPanel";
import { MultiCandidateView } from "./MultiCandidateView";
import { ReviewFooter } from "./ReviewFooter";
import { PromptInfo, ReviewHeader, ReviewModelOption } from "./ReviewHeader";
import "./ReviewWindow.css";
import {
  REVIEW_WINDOW_INLINE_APPLY,
  REVIEW_WINDOW_REWRITE_APPLY,
  VOTYPE_REFOCUS_ACTIVE_INPUT,
} from "../lib/events";
import {
  buildDiffViews,
  buildPlainViews,
  computeChangePercent,
} from "./diff-utils";
import { hljs } from "./highlight";
import { simpleMarkdownToHtml } from "./markdown-utils";

const DIFF_THRESHOLD = 50;
const SPEED_RANK_STATS_STORAGE_KEY = "votype.multiModelSpeedRankStats";
const MULTI_SORT_MODE_STORAGE_KEY = "votype.multiModelSortMode";

type RankPosition = 1 | 2 | 3;
type SpeedRankStats = Record<string, Partial<Record<RankPosition, number>>>;
type MultiSortMode = "default" | "speed" | "change";

function readSpeedRankStats(): SpeedRankStats {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SPEED_RANK_STATS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SpeedRankStats;
  } catch {
    return {};
  }
}

function writeSpeedRankStats(stats: SpeedRankStats) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SPEED_RANK_STATS_STORAGE_KEY,
    JSON.stringify(stats),
  );
}

function readMultiSortMode(): MultiSortMode {
  if (typeof window === "undefined") return "default";
  const raw = window.localStorage.getItem(MULTI_SORT_MODE_STORAGE_KEY);
  if (raw === "speed" || raw === "change") return raw;
  return "default";
}

function writeMultiSortMode(mode: MultiSortMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MULTI_SORT_MODE_STORAGE_KEY, mode);
}

interface ReviewData {
  source_text: string;
  final_text: string;
  change_percent: number;
  history_id: number | null;
  reason?: string | null;
  output_mode?: "polish" | "chat";
  skill_name?: string | null;
  prompt_id?: string | null;
  model_id?: string | null;
}

interface ReviewWindowProps {
  initialData: ReviewData;
  multiCandidates?: MultiModelCandidate[];
  onClose: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;

  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (!element) return false;

  return Boolean(
    element.closest(
      'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], .ProseMirror',
    ),
  );
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
  const [showCandidateShortcutHints, setShowCandidateShortcutHints] =
    useState(false);
  const [multiSortMode, setMultiSortMode] = useState<MultiSortMode>(() =>
    readMultiSortMode(),
  );
  const [speedRankStats, setSpeedRankStats] = useState<SpeedRankStats>(() =>
    readSpeedRankStats(),
  );
  const lastRecordedRaceKeyRef = useRef<string | null>(null);
  const pendingInlineRangeRef = useRef<{ from: number; to: number } | null>(
    null,
  );

  useEffect(() => {
    writeMultiSortMode(multiSortMode);
  }, [multiSortMode]);

  // Model selector state (single-model polish mode only)
  const [modelOptions, setModelOptions] = useState<ReviewModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [defaultModelLabel, setDefaultModelLabel] = useState<string>("");
  const [currentModelName, setCurrentModelName] = useState<string>("");

  // Translation state
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslationHovered, setIsTranslationHovered] = useState(false);
  const [revisionHistory, setRevisionHistory] = useState<string[]>([
    initialData.final_text,
  ]);
  const [revisionIndex, setRevisionIndex] = useState(0);
  const revisionIndexRef = useRef(0);

  // Fetch prompts and model options on mount
  // NOTE: dependency is [] because ReviewWindow is re-mounted via key when new data arrives.
  // Using [initialData] would cause re-runs on every progress event (object reference changes).
  useEffect(() => {
    invoke<{ prompts: PromptInfo[]; selected_id: string | null }>(
      "get_post_process_prompts",
    ).then((resp) => {
      setPrompts(resp.prompts);
      // Prioritize the prompt_id from initialData (may be overridden by app rules)
      if (initialData.prompt_id) {
        setSelectedPromptId(initialData.prompt_id);
      } else if (resp.selected_id) {
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
        // Prioritize the model_id from initialData
        // Backend may pass a CachedModel UUID or a model_id string (e.g. "gpt-4o")
        if (initialData.model_id) {
          const selectedModel =
            resp.models.find((m) => m.id === initialData.model_id) ||
            resp.models.find((m) => m.model_id === initialData.model_id);
          if (selectedModel) {
            setSelectedModelId(selectedModel.id);
            setCurrentModelName(selectedModel.label);
          } else {
            // No matching cached model — use the raw value as display name
            setCurrentModelName(initialData.model_id);
          }
        } else if (resp.default_model_id) {
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

  // Derive the label of the currently selected candidate for the header
  const selectedCandidateLabel = useMemo(() => {
    if (!selectedCandidateId) return null;
    const all = localCandidates || multiCandidates;
    const found = all?.find((c) => c.id === selectedCandidateId);
    return found?.label ?? null;
  }, [selectedCandidateId, localCandidates, multiCandidates]);

  // The candidates to render (local state, updated by progress events)
  const displayCandidates = localCandidates || multiCandidates;
  const sortedCandidates = useMemo(() => {
    if (!displayCandidates || multiSortMode === "default") {
      return displayCandidates;
    }

    const originalOrder = new Map(
      displayCandidates.map((candidate, index) => [candidate.id, index]),
    );

    return [...displayCandidates].sort((a, b) => {
      const aReady = a.ready && !a.error;
      const bReady = b.ready && !b.error;

      if (aReady && bReady) {
        if (multiSortMode === "speed") {
          const aHasTime = a.processing_time_ms > 0;
          const bHasTime = b.processing_time_ms > 0;
          if (
            aHasTime &&
            bHasTime &&
            a.processing_time_ms !== b.processing_time_ms
          ) {
            return a.processing_time_ms - b.processing_time_ms;
          }
        } else if (multiSortMode === "change") {
          const aChange = computeChangePercent(initialData.source_text, a.text);
          const bChange = computeChangePercent(initialData.source_text, b.text);
          if (aChange !== bChange) return aChange - bChange;
        }
      }

      if (aReady !== bReady) return aReady ? -1 : 1;

      const aError = Boolean(a.error);
      const bError = Boolean(b.error);
      if (aError !== bError) return aError ? 1 : -1;

      return (
        (originalOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (originalOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    });
  }, [displayCandidates, multiSortMode, initialData.source_text]);

  useEffect(() => {
    if (!displayCandidates || multiSortMode !== "speed") return;
    if (
      displayCandidates.length === 0 ||
      !displayCandidates.every((c) => c.ready)
    ) {
      return;
    }

    const podium = [...displayCandidates]
      .filter((c) => !c.error && c.processing_time_ms > 0)
      .sort((a, b) => a.processing_time_ms - b.processing_time_ms)
      .slice(0, 3);

    if (podium.length === 0) return;

    const raceKey = JSON.stringify(
      podium.map((candidate, index) => ({
        id: candidate.id,
        rank: index + 1,
        processing_time_ms: candidate.processing_time_ms,
      })),
    );
    if (lastRecordedRaceKeyRef.current === raceKey) {
      return;
    }
    lastRecordedRaceKeyRef.current = raceKey;

    setSpeedRankStats((prev) => {
      const next: SpeedRankStats = { ...prev };
      podium.forEach((candidate, index) => {
        const rank = (index + 1) as RankPosition;
        next[candidate.id] = {
          ...next[candidate.id],
          [rank]: (next[candidate.id]?.[rank] ?? 0) + 1,
        };
      });
      writeSpeedRankStats(next);
      return next;
    });
  }, [displayCandidates, multiSortMode]);

  // Use selected candidate text if in multi-candidate mode
  const currentText =
    selectedCandidateId && sortedCandidates
      ? sortedCandidates.find((c) => c.id === selectedCandidateId)?.text ||
        initialData.final_text
      : initialData.final_text;

  // Diff toggle: auto-off when change_percent >= threshold
  const [showDiff, setShowDiff] = useState(() => {
    if (initialData.output_mode === "chat") return false;
    return (initialData.change_percent ?? 0) < DIFF_THRESHOLD;
  });

  // Track current final text (updated by rerun results)
  const [currentFinalText, setCurrentFinalText] = useState(
    initialData.final_text,
  );

  const [sourceHtml, setSourceHtml] = useState(() => {
    if (initialData.output_mode === "chat") return "";
    const build = showDiff ? buildDiffViews : buildPlainViews;
    return build(initialData.source_text, currentText).sourceHtml;
  });
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");
  const insertShortcut = isMac ? "⌘⏎" : "Ctrl⏎";

  // Use refs to access latest callbacks inside Tiptap extension
  const insertRef = useRef<() => void>(() => {});
  const insertOriginalRef = useRef<() => void>(() => {});
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
                insertOriginalRef.current();
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
          : (showDiff ? buildDiffViews : buildPlainViews)(
              initialData.source_text,
              initialData.final_text,
            ).targetHtml,
      editorProps: {
        attributes: {
          class: "review-editor",
        },
      },
    },
    [t],
  );

  // Track whether this instance was mounted in multi-candidate mode.
  // Stable across re-renders so it doesn't trigger effects on progress events.
  const isMultiCandidateMode = useRef(
    !!(multiCandidates && multiCandidates.length > 0),
  );

  useEffect(() => {
    if (!editor) return;
    // In multi-candidate mode the Tiptap editor is hidden behind
    // MultiCandidateView. Skip content rebuilds to avoid wasted work
    // on every progress event.
    if (isMultiCandidateMode.current) return;

    let content = "";
    let nextSourceHtml = "";

    if (initialData.output_mode === "chat") {
      content = simpleMarkdownToHtml(currentFinalText.trim());
    } else {
      const build = showDiff ? buildDiffViews : buildPlainViews;
      const views = build(initialData.source_text, currentFinalText);
      content = views.targetHtml;
      nextSourceHtml = views.sourceHtml;
    }

    editor.commands.setContent(content, { emitUpdate: false });
    void invoke("set_review_editor_content_state", {
      text: editor.getText({ blockSeparator: "\n" }),
    }).catch((e) => {
      console.error("Failed to sync review editor content state:", e);
    });
    setSourceHtml(nextSourceHtml);
    setTimeout(() => measureAndResize(false), 16);
  }, [
    editor,
    initialData.source_text,
    currentFinalText,
    initialData.output_mode,
    showDiff,
  ]);

  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    // In multi-candidate mode the Tiptap editor is hidden; skip focus
    const focusTimer = isMultiCandidateMode.current
      ? undefined
      : window.setTimeout(() => {
          if (disposed || editor.isDestroyed) return;
          editor.commands.focus("end");
        }, 50);

    // Multi-model mode: backend already sized and showed the window directly,
    // skip frontend measure/resize to avoid overriding the correct size.
    // Single-model/chat mode: measure DOM, resize, then notify backend to show.
    const isMultiModel = isMultiCandidateMode.current;
    const readyTimer = window.setTimeout(async () => {
      if (disposed) return;
      if (!isMultiModel) {
        try {
          await measureAndResize(true);
        } catch (e) {
          console.error("Failed to measure/resize:", e);
        }
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
    if (sortedCandidates && selectedCandidateId) {
      const edited = editedTexts[selectedCandidateId];
      if (edited !== undefined) return edited;
      const candidate = sortedCandidates.find(
        (c) => c.id === selectedCandidateId,
      );
      return candidate?.text || "";
    }
    if (!editor) return "";
    return editor.getText({ blockSeparator: "\n" });
  }, [editor, sortedCandidates, selectedCandidateId, editedTexts]);

  const applyInlineTextToEditor = useCallback(
    (text: string) => {
      if (!editor || isMultiCandidateMode.current) return;

      const currentSelection = editor.state.selection;
      const pendingRange = pendingInlineRangeRef.current ?? {
        from: currentSelection.from,
        to: currentSelection.to,
      };

      editor
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          tr.insertText(text, pendingRange.from, pendingRange.to);
          const cursor = pendingRange.from + text.length;
          tr.setSelection(TextSelection.create(tr.doc, cursor));
          dispatch?.(tr);
          return true;
        })
        .run();

      pendingInlineRangeRef.current = null;
      window.setTimeout(() => measureAndResize(false), 16);
    },
    [editor, measureAndResize],
  );

  const replaceEditorDocument = useCallback(
    (text: string) => {
      if (isMultiCandidateMode.current) return;
      setCurrentFinalText(text);
      setRevisionHistory((prev) => {
        const base = prev.slice(0, revisionIndexRef.current + 1);
        if (base[base.length - 1] === text) {
          return base;
        }
        const next = [...base, text];
        setRevisionIndex(next.length - 1);
        return next;
      });
      pendingInlineRangeRef.current = null;
      window.setTimeout(() => measureAndResize(false), 16);
    },
    [measureAndResize],
  );

  useEffect(() => {
    revisionIndexRef.current = revisionIndex;
  }, [revisionIndex]);

  useEffect(() => {
    if (isMultiCandidateMode.current) return;
    const nextText = revisionHistory[revisionIndex];
    if (typeof nextText === "string" && nextText !== currentFinalText) {
      setCurrentFinalText(nextText);
    }
  }, [currentFinalText, revisionHistory, revisionIndex]);

  const handleUndoRevision = useCallback(() => {
    setRevisionIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleRedoRevision = useCallback(() => {
    setRevisionIndex((prev) => Math.min(revisionHistory.length - 1, prev + 1));
  }, [revisionHistory.length]);

  const getOriginalReviewText = useCallback(() => {
    if (sortedCandidates && selectedCandidateId) {
      return (
        sortedCandidates
          .find((c) => c.id === selectedCandidateId)
          ?.text.trim() || ""
      );
    }
    return currentFinalText.trim();
  }, [currentFinalText, selectedCandidateId, sortedCandidates]);

  const didUserEditReviewedText = useCallback(() => {
    const currentText = getEditorText().trim();
    const originalReviewText = getOriginalReviewText();

    if (sortedCandidates && selectedCandidateId) {
      return (
        editedTexts[selectedCandidateId] !== undefined &&
        currentText.length > 0 &&
        currentText !== originalReviewText
      );
    }

    return currentText.length > 0 && currentText !== originalReviewText;
  }, [
    editedTexts,
    getEditorText,
    getOriginalReviewText,
    selectedCandidateId,
    sortedCandidates,
  ]);

  const handleInsert = useCallback(async () => {
    const currentText = getEditorText();
    if (isSubmitting || !currentText.trim()) return;

    setIsSubmitting(true);

    try {
      await invoke("confirm_reviewed_transcription", {
        text: currentText.trim(),
        historyId: initialData.history_id,
        cachedModelId: selectedCandidateId || undefined,
        learnFromEdit: didUserEditReviewedText(),
        originalTextForLearning: didUserEditReviewedText()
          ? getOriginalReviewText()
          : undefined,
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
    didUserEditReviewedText,
    getOriginalReviewText,
  ]);

  // Insert original ASR text directly
  const handleInsertOriginal = useCallback(async () => {
    if (isSubmitting || !initialData.source_text.trim()) return;

    setIsSubmitting(true);

    try {
      await invoke("confirm_reviewed_transcription", {
        text: initialData.source_text.trim(),
        historyId: initialData.history_id,
        cachedModelId: undefined,
        learnFromEdit: false,
      });
      onClose();
    } catch (e) {
      console.error("Failed to insert original text:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [initialData.source_text, initialData.history_id, onClose, isSubmitting]);

  // Direct insert for a specific candidate text (one-click from hover button)
  const handleDirectInsert = useCallback(
    async (text: string, candidateId?: string) => {
      if (isSubmitting || !text.trim()) return;
      setIsSubmitting(true);
      try {
        await invoke("confirm_reviewed_transcription", {
          text: text.trim(),
          historyId: initialData.history_id,
          cachedModelId: candidateId || undefined,
          learnFromEdit: false,
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

  const handleInsertCandidateByIndex = useCallback(
    (shortcutIndex: number) => {
      if (!sortedCandidates || shortcutIndex < 1 || shortcutIndex > 5) return;
      const candidate = sortedCandidates[shortcutIndex - 1];
      if (!candidate || !candidate.ready || candidate.error) return;
      const text = (editedTexts[candidate.id] ?? candidate.text).trim();
      if (!text) return;
      void handleDirectInsert(text, candidate.id);
    },
    [editedTexts, handleDirectInsert, sortedCandidates],
  );

  // Translate current text with auto language detection and analysis
  const handleTranslate = useCallback(async () => {
    const currentText = getEditorText();
    if (isTranslating || !currentText.trim()) return;

    setIsTranslating(true);

    try {
      const result = await invoke<{
        translated_text: string;
      }>("translate_review_text", {
        text: currentText.trim(),
        originalText: initialData.source_text,
        userLocale: t("common.locale", "zh"), // Get user's locale from i18n
      });
      setTranslatedText(result.translated_text);
    } catch (e) {
      console.error("Failed to translate text:", e);
      setTranslatedText(null);
    } finally {
      setIsTranslating(false);
    }
  }, [getEditorText, isTranslating, initialData.source_text, t]);

  // Keep refs updated
  useEffect(() => {
    insertRef.current = handleInsert;
    insertOriginalRef.current = handleInsertOriginal;
  }, [handleInsert, handleInsertOriginal]);

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;

    const trimmed = getEditorText().trim();
    const historyId = initialData.history_id;
    onClose();

    void (async () => {
      try {
        await invoke("cancel_transcription_review", {
          text: trimmed.length > 0 ? trimmed : null,
          historyId,
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
      if (!sortedCandidates) return null;
      const ready = sortedCandidates.filter((c) => c.ready && !c.error);
      if (ready.length === 0) return null;
      const currentIdx = ready.findIndex((c) => c.id === selectedCandidateId);
      const nextIdx = (currentIdx + direction + ready.length) % ready.length;
      return ready[nextIdx].id;
    },
    [sortedCandidates, selectedCandidateId],
  );

  // In multi-model mode, Tiptap editor is not rendered so its keyboard
  // shortcuts don't fire. Register a global keydown listener with
  // two-level focus model (List Mode / Edit Mode).
  useEffect(() => {
    if (!sortedCandidates || sortedCandidates.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey) {
        setShowCandidateShortcutHints(true);
      }

      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const digit = Number.parseInt(e.key, 10);
        if (Number.isInteger(digit) && digit >= 1 && digit <= 5) {
          e.preventDefault();
          handleInsertCandidateByIndex(digit);
          return;
        }
      }

      // Tab: insert original text
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        insertOriginalRef.current();
        return;
      }

      // Cmd/Ctrl+Enter: insert edited/polished text
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        insertRef.current();
        return;
      }

      if (editingCandidateId === null) {
        // === List Mode ===
        if (e.key === "ArrowDown") {
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
        }
        // All other keys pass through to the focused textarea
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        setShowCandidateShortcutHints(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    handleInsertCandidateByIndex,
    sortedCandidates,
    editingCandidateId,
    selectedCandidateId,
    getNextReadyCandidate,
  ]);

  useEffect(() => {
    const handleWindowBlur = () => setShowCandidateShortcutHints(false);
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupListener = async () => {
      const detach = await listen<string>(
        REVIEW_WINDOW_INLINE_APPLY,
        (event) => {
          applyInlineTextToEditor(event.payload);
        },
      );

      if (disposed) {
        detach();
        return;
      }

      unlisten = detach;
    };

    void setupListener();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyInlineTextToEditor]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupListener = async () => {
      const detach = await listen<string>(
        REVIEW_WINDOW_REWRITE_APPLY,
        (event) => {
          setShowDiff(true);
          replaceEditorDocument(event.payload);
        },
      );

      if (disposed) {
        detach();
        return;
      }

      unlisten = detach;
    };

    void setupListener();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [replaceEditorDocument]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupListener = async () => {
      const detach = await listen(VOTYPE_REFOCUS_ACTIVE_INPUT, () => {
        if (!editor || isMultiCandidateMode.current) return;
        editor.commands.focus();
      });

      if (disposed) {
        detach();
        return;
      }

      unlisten = detach;
    };

    void setupListener();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [editor]);

  useEffect(() => {
    const syncEditorActive = (active: boolean) => {
      void invoke("set_review_editor_active_state", { active }).catch((e) => {
        console.error("Failed to sync review editor active state:", e);
      });
    };

    const syncEditorContent = () => {
      if (!editor || isMultiCandidateMode.current) return;
      void invoke("set_review_editor_content_state", {
        text: editor.getText({ blockSeparator: "\n" }),
      }).catch((e) => {
        console.error("Failed to sync review editor content state:", e);
      });
    };

    const updateEditorStateFromTarget = (target: EventTarget | null) => {
      const editorActive = isEditableTarget(target);

      if (editorActive && editor) {
        pendingInlineRangeRef.current = {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        };
      }

      syncEditorActive(editorActive);
    };

    const handleFocusIn = (event: FocusEvent) => {
      updateEditorStateFromTarget(event.target);
    };

    const handleSelectionChange = () => {
      updateEditorStateFromTarget(document.activeElement);
    };

    const handleWindowBlur = () => {
      syncEditorActive(false);
    };

    updateEditorStateFromTarget(document.activeElement);
    syncEditorContent();

    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("blur", handleWindowBlur);

    let offUpdate: (() => void) | undefined;
    if (editor) {
      const handler = () => {
        syncEditorContent();
      };
      editor.on("update", handler);
      offUpdate = () => editor.off("update", handler);
    }

    return () => {
      syncEditorActive(false);
      offUpdate?.();
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [editor]);

  const handleDrag = useCallback(async () => {
    try {
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
            showDiff={showDiff}
            onShowDiffChange={setShowDiff}
            onPromptChange={(promptId) => {
              // Update local state to sync dropdown display
              setSelectedPromptId(promptId);

              // Clear translation panel when changing prompt
              setTranslatedText(null);

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
            onInsertOriginal={handleInsertOriginal}
            onTranslate={handleTranslate}
            isTranslating={isTranslating}
            onSourceHtmlChange={setSourceHtml}
            onModelNameChange={setCurrentModelName}
            onRerunStart={() => {
              setIsRerunning(true);
              // Clear translation panel when rerunning
              setTranslatedText(null);
            }}
            onRerunEnd={() => setIsRerunning(false)}
            onMeasureAndResize={measureAndResize}
            onRerunResult={(text: string) => {
              const cp = computeChangePercent(initialData.source_text, text);
              setShowDiff(cp < DIFF_THRESHOLD);
              replaceEditorDocument(text);
            }}
            multiSortMode={multiSortMode}
            onMultiSortModeChange={setMultiSortMode}
            selectedCandidateLabel={selectedCandidateLabel}
          />
        </div>

        {sortedCandidates && sortedCandidates.length > 0 ? (
          <MultiCandidateView
            sourceText={initialData.source_text}
            showDiff={showDiff}
            candidates={sortedCandidates}
            showShortcutHints={showCandidateShortcutHints}
            rankStats={speedRankStats}
            selectedCandidateId={selectedCandidateId}
            selectedCandidateText={
              selectedCandidateId
                ? (editedTexts[selectedCandidateId] ??
                  sortedCandidates.find((c) => c.id === selectedCandidateId)
                    ?.text ??
                  null)
                : null
            }
            editingCandidateId={editingCandidateId}
            editedTexts={editedTexts}
            onCandidateSelect={setSelectedCandidateId}
            onEditEnd={() => setEditingCandidateId(null)}
            onTextChange={(candidateId, text) => {
              setEditedTexts((prev) => ({ ...prev, [candidateId]: text }));
            }}
            onInsert={handleDirectInsert}
            onInsertOriginal={handleInsertOriginal}
          />
        ) : initialData.output_mode !== "chat" ? (
          <DiffViewPanel
            sourceHtml={sourceHtml}
            editor={editor}
            isRerunning={isRerunning}
            currentModelName={currentModelName}
            onInsertOriginal={handleInsertOriginal}
          />
        ) : (
          <div className="review-content-area">
            <div
              className="review-section review-section-final review-section-no-title"
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLElement)) {
                  return;
                }

                if (event.target.closest("button")) {
                  return;
                }

                if (event.target.closest(".ProseMirror")) {
                  return;
                }
                event.preventDefault();
                editor?.commands.focus();
              }}
            >
              <EditorContent editor={editor} className="flex-1 min-h-0" />
            </div>
          </div>
        )}

        {translatedText && (
          <div className="review-translation-panel">
            <div className="review-translation-header">
              <span className="review-translation-title">
                {t("transcription.review.translationResult", "翻译结果")}
              </span>
              <button
                className="review-translation-close"
                onClick={() => {
                  setTranslatedText(null);
                }}
              >
                ×
              </button>
            </div>
            <div
              className="review-translation-content"
              onMouseEnter={() => setIsTranslationHovered(true)}
              onMouseLeave={() => setIsTranslationHovered(false)}
            >
              {translatedText}
              {isTranslationHovered && !isSubmitting && (
                <button
                  className="review-translation-insert-btn"
                  onClick={() => handleDirectInsert(translatedText)}
                  title={t(
                    "transcription.review.insertTranslation",
                    "插入翻译结果",
                  )}
                >
                  <IconTextPlus size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <ReviewFooter
          reason={initialData.reason}
          outputMode={initialData.output_mode}
          isSubmitting={isSubmitting}
          hasText={!!getEditorText().trim()}
          canUndo={revisionIndex > 0}
          canRedo={revisionIndex < revisionHistory.length - 1}
          insertShortcut={insertShortcut}
          isMultiModel={!!sortedCandidates && sortedCandidates.length > 0}
          onCopy={handleCopy}
          onInsert={handleInsert}
          onUndo={handleUndoRevision}
          onRedo={handleRedoRevision}
        />
      </div>
    </div>
  );
};

export default ReviewWindow;
