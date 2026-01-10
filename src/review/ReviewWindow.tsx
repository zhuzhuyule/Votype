// ReviewWindow - Independent window for reviewing low-confidence transcriptions
// This provides a floating window UI for editing and inserting transcribed text

import { Box, Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import {
  IconCheck,
  IconClipboard,
  IconCopy,
  IconMessageCircle,
  IconTextPlus,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { Mark } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CancelIcon } from "../components/icons";
import "./ReviewWindow.css";

interface ReviewData {
  source_text: string;
  final_text: string;
  change_percent: number;
  history_id: number | null;
  reason?: string | null;
  output_mode?: "polish" | "chat";
}

interface ReviewWindowProps {
  initialData: ReviewData;
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const escapeHtmlWithBreaks = (value: string): string =>
  escapeHtml(value).replace(/\n/g, "<br />");

type Token = {
  value: string;
  start: number;
  end: number;
};

const isHanChar = (value: string) => /[\u4e00-\u9fff]/.test(value);
const isAsciiWordChar = (value: string) => /[A-Za-z0-9]/.test(value);

const tokenizeWithIndices = (text: string): Token[] => {
  const tokens: Token[] = [];
  let current = "";
  let currentStart = 0;

  const flushCurrent = (endIndex: number) => {
    if (!current) return;
    tokens.push({ value: current, start: currentStart, end: endIndex });
    current = "";
  };

  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const size = char.length;

    if (/\s/.test(char)) {
      flushCurrent(i);
      i += size;
      continue;
    }

    if (isHanChar(char)) {
      flushCurrent(i);
      tokens.push({ value: char, start: i, end: i + size });
      i += size;
      continue;
    }

    if (isAsciiWordChar(char)) {
      if (!current) {
        currentStart = i;
      }
      current += char;
      i += size;
      continue;
    }

    flushCurrent(i);
    tokens.push({ value: char, start: i, end: i + size });
    i += size;
  }

  flushCurrent(text.length);
  return tokens;
};

const editDistance = (a: string, b: string): number => {
  const aChars = Array.from(a);
  const bChars = Array.from(b);
  const aLen = aChars.length;
  const bLen = bChars.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  const prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  const curr = new Array<number>(bLen + 1).fill(0);
  for (let i = 0; i < aLen; i += 1) {
    curr[0] = i + 1;
    for (let j = 0; j < bLen; j += 1) {
      const cost = aChars[i] === bChars[j] ? 0 : 1;
      curr[j + 1] = Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + cost);
    }
    for (let j = 0; j <= bLen; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[bLen];
};

type ScriptType = "latin" | "han" | "other";

const normalizeToken = (value: string) => value.toLowerCase();

const getScriptType = (value: string): ScriptType => {
  if (/[\u4e00-\u9fff]/.test(value)) return "han";
  if (/[A-Za-z]/.test(value)) return "latin";
  return "other";
};

const classifyChangeLevel = (current: string, previous: string | null) => {
  if (!previous) return "major";
  const normalizedCurrent = normalizeToken(current);
  const normalizedPrevious = normalizeToken(previous);
  if (normalizedCurrent === normalizedPrevious) return null;
  const currentScript = getScriptType(current);
  const previousScript = getScriptType(previous);
  if (
    currentScript !== "other" &&
    previousScript !== "other" &&
    currentScript !== previousScript
  ) {
    return "major";
  }
  const distance = editDistance(normalizedCurrent, normalizedPrevious);
  return distance <= 2 ? "minor" : "major";
};

type DiffAnnotations = {
  sourceStatuses: Array<"equal" | "delete">;
  targetLevels: Array<"minor" | "major" | null>;
};

const computeDiffAnnotations = (
  source: string,
  target: string,
): DiffAnnotations => {
  const sourceTokens = tokenizeWithIndices(source).map((token) => ({
    value: token.value,
    normalized: normalizeToken(token.value),
  }));
  const targetTokens = tokenizeWithIndices(target).map((token) => ({
    value: token.value,
    normalized: normalizeToken(token.value),
  }));
  const sourceLen = sourceTokens.length;
  const targetLen = targetTokens.length;
  const dp = Array.from({ length: sourceLen + 1 }, () =>
    new Array<number>(targetLen + 1).fill(0),
  );

  for (let i = 1; i <= sourceLen; i += 1) {
    for (let j = 1; j <= targetLen; j += 1) {
      if (sourceTokens[i - 1].normalized === targetTokens[j - 1].normalized) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  type Op =
    | { type: "equal"; sourceIndex: number; targetIndex: number }
    | { type: "insert"; targetIndex: number }
    | { type: "delete"; sourceIndex: number; sourceToken: string };

  const ops: Op[] = [];
  let i = sourceLen;
  let j = targetLen;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      sourceTokens[i - 1].normalized === targetTokens[j - 1].normalized
    ) {
      ops.push({ type: "equal", sourceIndex: i - 1, targetIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "insert", targetIndex: j - 1 });
      j -= 1;
    } else if (i > 0) {
      ops.push({
        type: "delete",
        sourceIndex: i - 1,
        sourceToken: sourceTokens[i - 1].value,
      });
      i -= 1;
    }
  }

  ops.reverse();
  const sourceStatuses: Array<"equal" | "delete"> = new Array(sourceLen).fill(
    "equal",
  );
  const targetLevels: Array<"minor" | "major" | null> = new Array(
    targetLen,
  ).fill(null);
  const pendingDeletes: Array<{ index: number; token: string }> = [];
  for (const op of ops) {
    if (op.type === "delete") {
      pendingDeletes.push({ index: op.sourceIndex, token: op.sourceToken });
    } else if (op.type === "insert") {
      const pending = pendingDeletes.pop();
      targetLevels[op.targetIndex] = classifyChangeLevel(
        targetTokens[op.targetIndex].value,
        pending?.token ?? null,
      );
    } else {
      for (const pending of pendingDeletes) {
        sourceStatuses[pending.index] = "delete";
      }
      pendingDeletes.length = 0;
    }
  }

  for (const pending of pendingDeletes) {
    sourceStatuses[pending.index] = "delete";
  }

  return { sourceStatuses, targetLevels };
};

const buildSourceHtml = (
  source: string,
  statuses: Array<"equal" | "delete">,
) => {
  const tokens = tokenizeWithIndices(source);
  let html = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    html += escapeHtmlWithBreaks(source.slice(cursor, token.start));
    const tokenText = escapeHtmlWithBreaks(token.value);
    if (statuses[index] === "delete") {
      html += `<span class="diff-delete">${tokenText}</span>`;
    } else {
      html += tokenText;
    }
    cursor = token.end;
  });
  html += escapeHtmlWithBreaks(source.slice(cursor));
  return html;
};

const buildTargetHtml = (
  target: string,
  levels: Array<"minor" | "major" | null>,
) => {
  const tokens = tokenizeWithIndices(target);
  let html = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    html += escapeHtmlWithBreaks(target.slice(cursor, token.start));
    const level = levels[index];
    const tokenText = escapeHtmlWithBreaks(token.value);
    if (level) {
      html += `<span data-diff-level="${level}">${tokenText}</span>`;
    } else {
      html += tokenText;
    }
    cursor = token.end;
  });
  html += escapeHtmlWithBreaks(target.slice(cursor));
  return html;
};

const buildDiffViews = (source: string, target: string) => {
  const { sourceStatuses, targetLevels } = computeDiffAnnotations(
    source,
    target,
  );
  return {
    sourceHtml: buildSourceHtml(source, sourceStatuses),
    targetHtml: buildTargetHtml(target, targetLevels),
  };
};

const simpleMarkdownToHtml = (text: string): string => {
  // Use unique placeholders that won't conflict with markdown syntax
  const PLACEHOLDER_PREFIX = "\x00CB"; // Code Block
  const PLACEHOLDER_SUFFIX = "\x00";
  const INLINE_PREFIX = "\x00IC"; // Inline Code

  // Protect code blocks first
  const codeBlocks: string[] = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(
      `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`,
    );
    return `${PLACEHOLDER_PREFIX}${codeBlocks.length - 1}${PLACEHOLDER_SUFFIX}`;
  });

  // Protect inline code
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${INLINE_PREFIX}${inlineCodes.length - 1}${PLACEHOLDER_SUFFIX}`;
  });

  // Split into lines for processing
  const lines = html.split("\n");
  const processedLines: string[] = [];
  let inList = false;
  let listType = "";
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip placeholder lines (code blocks) - pass them through unchanged
    if (line.includes(PLACEHOLDER_PREFIX) || line.includes(INLINE_PREFIX)) {
      if (inList) {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (inBlockquote) {
        processedLines.push("</blockquote>");
        inBlockquote = false;
      }
      processedLines.push(line);
      continue;
    }

    // Check for headings (# ## ### etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (inBlockquote) {
        processedLines.push("</blockquote>");
        inBlockquote = false;
      }
      const level = headingMatch[1].length;
      const content = processInlineMarkdown(headingMatch[2]);
      processedLines.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    // Check for blockquote
    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      if (inList) {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (!inBlockquote) {
        processedLines.push("<blockquote>");
        inBlockquote = true;
      }
      const content = processInlineMarkdown(blockquoteMatch[1]);
      processedLines.push(`<p>${content}</p>`);
      continue;
    } else if (inBlockquote) {
      processedLines.push("</blockquote>");
      inBlockquote = false;
    }

    // Check for unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inList && listType !== "ul") {
        processedLines.push("</ol>");
        inList = false;
      }
      if (!inList) {
        processedLines.push("<ul>");
        inList = true;
        listType = "ul";
      }
      const content = processInlineMarkdown(ulMatch[1]);
      processedLines.push(`<li>${content}</li>`);
      continue;
    }

    // Check for ordered list
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inList && listType !== "ol") {
        processedLines.push("</ul>");
        inList = false;
      }
      if (!inList) {
        processedLines.push("<ol>");
        inList = true;
        listType = "ol";
      }
      const content = processInlineMarkdown(olMatch[1]);
      processedLines.push(`<li>${content}</li>`);
      continue;
    }

    // Close list if we're no longer in one
    if (inList && line.trim() !== "") {
      processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }

    // Check for horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      processedLines.push("<hr>");
      continue;
    }

    // Regular paragraph
    if (line.trim() === "") {
      processedLines.push("");
    } else {
      const content = processInlineMarkdown(line);
      processedLines.push(`<p>${content}</p>`);
    }
  }

  // Close any open lists or blockquotes
  if (inList) {
    processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
  }
  if (inBlockquote) {
    processedLines.push("</blockquote>");
  }

  html = processedLines.join("\n");

  // Restore inline code
  const inlineCodeRegex = new RegExp(
    `${INLINE_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`,
    "g",
  );
  html = html.replace(inlineCodeRegex, (_, index) => {
    return inlineCodes[parseInt(index)];
  });

  // Restore code blocks
  const codeBlockRegex = new RegExp(
    `${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`,
    "g",
  );
  html = html.replace(codeBlockRegex, (_, index) => {
    return codeBlocks[parseInt(index)];
  });

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");

  return html;
};

// Helper function to process inline markdown elements
const processInlineMarkdown = (text: string): string => {
  let result = escapeHtml(text);

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  return result;
};

const CodeBlockComponent = ({
  node: { textContent },
}: {
  node: { textContent: string };
  extension: any;
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

  return (
    <NodeViewWrapper className="code-block-wrapper relative group my-2">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-1">
        <Tooltip content={t("common.copy", "Copy")}>
          <Button
            size="1"
            variant="soft"
            color={copyState === "success" ? "green" : "gray"}
            onClick={handleCopy}
            className="cursor-pointer shadow-sm backdrop-blur-sm !px-1.5"
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
            className="cursor-pointer shadow-sm backdrop-blur-sm !px-1.5"
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
        <NodeViewContent as={"code" as any} />
      </pre>
    </NodeViewWrapper>
  );
};

const ReviewWindow: React.FC<ReviewWindowProps> = ({
  initialData,
  onClose,
}) => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceHtml, setSourceHtml] = useState(() => {
    if (initialData.output_mode === "chat") return "";
    return buildDiffViews(initialData.source_text, initialData.final_text)
      .sourceHtml;
  });
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");
  const insertShortcut = isMac ? "⌘⏎" : "Ctrl⏎";

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
    if (!editor) return;

    let content = "";
    let nextSourceHtml = "";

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

    editor.commands.setContent(content, { emitUpdate: false });
    setSourceHtml(nextSourceHtml);
  }, [
    editor,
    initialData.source_text,
    initialData.final_text,
    initialData.output_mode,
  ]);

  useEffect(() => {
    if (!editor) return;
    setTimeout(() => {
      editor.commands.focus("end");
    }, 50);

    // Notify Rust that content is rendered and window can be shown
    // This ensures no flicker - window only becomes visible after content is ready
    invoke("review_window_content_ready").catch((e) => {
      console.error("Failed to notify content ready:", e);
    });
  }, [editor]);

  const getEditorText = useCallback(() => {
    if (!editor) return "";
    return editor.getText({ blockSeparator: "\n" });
  }, [editor]);

  const handleInsert = useCallback(async () => {
    const currentText = getEditorText();
    if (isSubmitting || !currentText.trim()) return;

    setIsSubmitting(true);
    try {
      await invoke("confirm_reviewed_transcription", {
        text: currentText.trim(),
        history_id: initialData.history_id,
      });
      onClose();
    } catch (e) {
      console.error("Failed to insert reviewed text:", e);
    } finally {
      setIsSubmitting(false);
    }
  }, [getEditorText, initialData.history_id, onClose, isSubmitting]);

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

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Tab or Cmd/Ctrl+Enter to insert
      if (e.key === "Tab" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
        e.preventDefault();
        handleInsert();
      }
      // Escape to cancel
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleInsert, handleCancel],
  );

  const getChangeColor = (changePercent: number): string => {
    if (changePercent >= 85) return "var(--ruby-9)";
    if (changePercent >= 50) return "var(--amber-9)";
    return "var(--grass-9)";
  };

  const handleDrag = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    } catch (e) {
      console.error("Failed to start dragging:", e);
    }
  }, []);

  return (
    <div className="w-screen h-screen flex items-center justify-center p-0 box-border overflow-hidden bg-transparent">
      <div
        className="w-full h-full flex flex-col bg-[var(--color-panel-solid)] relative border border-[var(--gray-5)] rounded-[12px] shadow-[var(--shadow-5)] overflow-hidden"
        style={{ animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
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
          {initialData.output_mode !== "chat" && (
            <Flex
              justify="between"
              align="center"
              className="px-3.5 py-3 border-b border-[var(--gray-4)] bg-[var(--gray-2)] select-none cursor-grab"
            >
              <Flex align="center" gap="2">
                <Box
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: getChangeColor(initialData.change_percent),
                  }}
                />
                <Text
                  size="1"
                  weight="bold"
                  style={{ color: "var(--gray-11)" }}
                >
                  {t("transcription.review.change", "Change")}:{" "}
                  {initialData.change_percent}%
                </Text>
                <span
                  className="review-tooltip review-tooltip-bottom review-change-tip"
                  data-tooltip={t(
                    "transcription.review.highlightHint",
                    "Highlighted words indicate LLM edits.",
                  )}
                >
                  ?
                </span>
              </Flex>
              <div
                className="review-tooltip review-tooltip-bottom"
                data-tooltip="按 ESC 也可关闭"
              >
                <div
                  className="review-close-button w-6 h-6 flex items-center justify-center rounded-[6px] cursor-pointer text-[var(--gray-10)] transition-all duration-200 hover:bg-[var(--gray-4)] hover:text-[var(--gray-12)]"
                  onClick={handleCancel}
                >
                  <CancelIcon />
                </div>
              </div>
            </Flex>
          )}

          {initialData.output_mode === "chat" && (
            <Flex
              justify="between"
              align="center"
              className="px-3.5 py-3 border-b border-[var(--gray-4)] bg-[var(--gray-2)] select-none cursor-grab"
            >
              <Flex align="center" gap="2">
                <Text
                  size="1"
                  weight="bold"
                  style={{ color: "var(--gray-11)" }}
                >
                  {t(
                    "transcription.review.generationTitle",
                    "AI Assistant Response",
                  )}
                </Text>
                {initialData.source_text && (
                  <span
                    className="review-tooltip review-tooltip-bottom review-tooltip-wide review-change-tip"
                    data-tooltip={initialData.source_text}
                  >
                    <IconMessageCircle size={14} />
                  </span>
                )}
              </Flex>
              <div
                className="review-tooltip review-tooltip-bottom"
                data-tooltip="Close (ESC)"
              >
                <div
                  className="review-close-button w-6 h-6 flex items-center justify-center rounded-[6px] cursor-pointer text-[var(--gray-10)] transition-all duration-200 hover:bg-[var(--gray-4)] hover:text-[var(--gray-12)]"
                  onClick={handleCancel}
                >
                  <CancelIcon />
                </div>
              </div>
            </Flex>
          )}
        </div>

        {/* Editable textarea */}
        <div className="flex-1 p-3 flex flex-col min-h-0 gap-2">
          {/* Source section - only show for polish mode */}
          {initialData.output_mode !== "chat" && (
            <div className="review-section">
              <Text size="1" className="review-section-title">
                {t("transcription.review.source", "Live transcript")}
              </Text>
              <div
                className="review-source-content"
                dangerouslySetInnerHTML={{
                  __html: sourceHtml || "—",
                }}
              />
            </div>
          )}
          {/* Final output / AI response section */}
          <div
            className={`review-section review-section-final ${initialData.output_mode === "chat" ? "review-section-no-title" : ""}`}
          >
            {initialData.output_mode !== "chat" && (
              <Text size="1" className="review-section-title">
                {t("transcription.review.final", "Final output")}
              </Text>
            )}
            <EditorContent
              editor={editor}
              onKeyDown={handleKeyDown}
              className="flex-1 min-h-0"
            />
          </div>
        </div>

        {/* Footer with hint and insert button */}
        <Flex
          justify="between"
          align="center"
          className="px-3.5 py-2.5 border-t border-[var(--gray-4)] bg-[var(--gray-1)]"
        >
          <div className="review-footer-left">
            {initialData.reason?.trim() ? (
              <Text size="1" className="text-[var(--gray-10)] text-[11px]">
                {initialData.reason}
              </Text>
            ) : null}
          </div>
          <Flex align="center" gap="2" className="review-footer-actions">
            {initialData.output_mode === "chat" && (
              <Button
                variant="soft"
                size="1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getEditorText());
                    // Optional: Show toast or feedback
                  } catch (err) {
                    console.error("Failed to copy text: ", err);
                  }
                }}
                disabled={isSubmitting || !getEditorText().trim()}
                className="review-copy-button"
              >
                <IconCopy size={12} />
                {t("common.copy", "Copy")}
              </Button>
            )}
            <div
              className="review-tooltip review-tooltip-top"
              data-tooltip={t(
                "transcription.review.insertStabilityHint",
                `快捷键：${insertShortcut}\n如果插入不稳定，可暂时关闭该功能。`,
              )}
            >
              <Button
                variant="classic"
                size="1"
                onClick={handleInsert}
                disabled={isSubmitting || !getEditorText().trim()}
                data-tauri-drag-region="false"
                className="review-insert-button"
              >
                <Flex align="center" gap="1">
                  {t("transcription.review.insert", "Insert")}
                  <IconTextPlus size={14} />
                </Flex>
              </Button>
            </div>
          </Flex>
        </Flex>
      </div>
    </div>
  );
};

export default ReviewWindow;
