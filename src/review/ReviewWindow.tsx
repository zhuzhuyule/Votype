// ReviewWindow - Independent window for reviewing low-confidence transcriptions
// This provides a floating window UI for editing and inserting transcribed text

import { Box, Button, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import {
  IconCheck,
  IconClipboard,
  IconCopy,
  IconTextPlus,
} from "@tabler/icons-react";
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
import { CancelIcon } from "../components/icons";
import { log } from "../lib/utils/logging";
import "./ReviewWindow.css";

interface ReviewData {
  source_text: string;
  final_text: string;
  change_percent: number;
  history_id: number | null;
  reason?: string | null;
  output_mode?: "polish" | "chat";
  skill_name?: string | null;
}

interface MultiModelCandidate {
  id: string;
  label: string;
  text: string;
  confidence?: number;
  processing_time_ms: number;
  error?: string;
  ready?: boolean;
}

interface PromptInfo {
  id: string;
  name: string;
}

function formatProcessingTime(ms: number): string {
  if (ms <= 0) return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
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
  const start = performance.now();
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

  const durationMs = Math.round(performance.now() - start);
  void log("[ReviewWindow] computeDiffAnnotations", {
    sourceChars: source.length,
    targetChars: target.length,
    sourceTokens: sourceLen,
    targetTokens: targetLen,
    dpCells: (sourceLen + 1) * (targetLen + 1),
    durationMs,
  });

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
  const start = performance.now();
  const { sourceStatuses, targetLevels } = computeDiffAnnotations(
    source,
    target,
  );
  const result = {
    sourceHtml: buildSourceHtml(source, sourceStatuses),
    targetHtml: buildTargetHtml(target, targetLevels),
  };
  const durationMs = Math.round(performance.now() - start);
  void log("[ReviewWindow] buildDiffViews", {
    sourceChars: source.length,
    targetChars: target.length,
    sourceHtmlChars: result.sourceHtml.length,
    targetHtmlChars: result.targetHtml.length,
    durationMs,
  });
  return result;
};

const simpleMarkdownToHtml = (text: string): string => {
  const start = performance.now();
  // Use unique placeholders that won't conflict with markdown syntax
  const PLACEHOLDER_PREFIX = "\x00CB"; // Code Block
  const PLACEHOLDER_SUFFIX = "\x00";
  const INLINE_PREFIX = "\x00IC"; // Inline Code

  // Protect code blocks first
  const codeBlocks: string[] = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmedCode = code.trim();
    let highlightedCode = "";
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlightedCode = hljs.highlight(trimmedCode, { language: lang }).value;
      } else {
        highlightedCode = hljs.highlightAuto(trimmedCode).value;
      }
    } catch {
      highlightedCode = escapeHtml(trimmedCode);
    }
    codeBlocks.push(
      `<pre><code class="hljs language-${lang}">${highlightedCode}</code></pre>`,
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
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (!inList) {
        processedLines.push('<ul class="contains-task-list">');
        inList = true;
        listType = "ul";
      }
      const content = processInlineMarkdown(ulMatch[1]);
      processedLines.push(`<li>${content}</li>`);
      continue;
    }

    // Check for task list item
    const taskMatch = line.match(/^[\s]*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      if (inList && listType !== "ul") {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (!inList) {
        processedLines.push('<ul class="contains-task-list">');
        inList = true;
        listType = "ul";
      }
      const isChecked = taskMatch[1].toLowerCase() === "x";
      const taskContent = processInlineMarkdown(taskMatch[2]);
      processedLines.push(
        `<li><input type="checkbox" disabled${isChecked ? " checked" : ""} /><span>${taskContent}</span></li>`,
      );
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

    // Check for table
    const tableMatch = line.match(/^\|[\s\S]+\|$/);
    if (tableMatch) {
      if (inBlockquote) {
        processedLines.push("</blockquote>");
        inBlockquote = false;
      }

      // Check if this is a header separator row
      const isHeaderSeparator = /^[\s\|:\-]+$/.test(line);
      if (isHeaderSeparator) {
        continue;
      }

      // Parse table cells
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const isFirstRow =
        processedLines.length === 0 ||
        !processedLines[processedLines.length - 1].startsWith("<table");

      if (isFirstRow) {
        processedLines.push("<table><thead><tr>");
        cells.forEach((cell) => {
          processedLines.push(`<th>${processInlineMarkdown(cell)}</th>`);
        });
        processedLines.push("</tr></thead><tbody>");
      } else {
        processedLines.push("<tr>");
        cells.forEach((cell) => {
          processedLines.push(`<td>${processInlineMarkdown(cell)}</td>`);
        });
        processedLines.push("</tr>");
      }
      continue;
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

  // Close any open lists, blockquotes, or tables
  if (inList) {
    processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
  }
  if (inBlockquote) {
    processedLines.push("</blockquote>");
  }

  // Close table if open
  if (processedLines.length > 0) {
    const lastLine = processedLines[processedLines.length - 1];
    if (
      lastLine &&
      (lastLine.startsWith("<tr>") || lastLine.startsWith("<thead>"))
    ) {
      processedLines.push("</tbody></table>");
    }
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

  const durationMs = Math.round(performance.now() - start);
  void log("[ReviewWindow] simpleMarkdownToHtml", {
    textChars: text.length,
    codeBlocks: codeBlocks.length,
    inlineCodes: inlineCodes.length,
    htmlChars: html.length,
    durationMs,
  });

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

  // Images: ![alt](url)
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" loading="lazy" />',
  );

  return result;
};

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    multiCandidates && multiCandidates.length > 0
      ? multiCandidates[0].id
      : null,
  );

  // Prompt selector state for multi-candidate mode
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [localCandidates, setLocalCandidates] = useState<
    MultiModelCandidate[] | undefined
  >(multiCandidates);
  const [isRerunning, setIsRerunning] = useState(false);

  // Fetch prompts on mount when in multi-candidate mode
  useEffect(() => {
    if (!multiCandidates) return;
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
  }, [!!multiCandidates]);

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

    // Notify Rust that content is rendered and window can be shown
    // This ensures no flicker - window only becomes visible after content is ready
    const readyTimer = window.setTimeout(() => {
      if (disposed) return;
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
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(focusTimer);
      window.clearTimeout(readyTimer);
    };
  }, [editor]);

  const getEditorText = useCallback(() => {
    // In multi-candidate mode, return selected candidate's text
    if (displayCandidates && selectedCandidateId) {
      const candidate = displayCandidates.find(
        (c) => c.id === selectedCandidateId,
      );
      return candidate?.text || "";
    }
    if (!editor) return "";
    return editor.getText({ blockSeparator: "\n" });
  }, [editor, displayCandidates, selectedCandidateId]);

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

  // Direct insert for a specific candidate text (one-click from hover button)
  const handleDirectInsert = useCallback(
    async (text: string) => {
      if (isSubmitting || !text.trim()) return;
      setIsSubmitting(true);
      try {
        await invoke("confirm_reviewed_transcription", {
          text: text.trim(),
          history_id: initialData.history_id,
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
      <div className="review-window-container">
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
          {multiCandidates && multiCandidates.length > 0 ? (
            <div className="review-header">
              <div className="review-header-left">
                {prompts.length > 1 ? (
                  <select
                    className="prompt-select"
                    value={selectedPromptId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setSelectedPromptId(newId);
                      // Immediately clear old results to loading state
                      setLocalCandidates((prev) =>
                        prev?.map((c) => ({
                          ...c,
                          text: "",
                          confidence: undefined,
                          processing_time_ms: 0,
                          error: undefined,
                          ready: false,
                        })),
                      );
                      setSelectedCandidateId(null);
                      setIsRerunning(true);
                      invoke("rerun_multi_model_with_prompt", {
                        promptId: newId,
                        sourceText: initialData.source_text,
                        historyId: initialData.history_id,
                      }).catch((err) => console.error("Failed to rerun:", err));
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {prompts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="review-skill-name">
                    {prompts[0]?.name ||
                      t("transcription.review.multiModel", "多模型结果")}
                  </div>
                )}
              </div>
              <div
                className="review-close-button review-close-btn"
                onClick={handleCancel}
              >
                <CancelIcon />
              </div>
            </div>
          ) : (
            <>
              {initialData.output_mode !== "chat" && (
                <div className="review-header">
                  <div className="review-change-badge">
                    <Box
                      className="review-status-dot"
                      style={{
                        backgroundColor: getChangeColor(
                          initialData.change_percent,
                        ),
                        color: getChangeColor(initialData.change_percent),
                      }}
                    />
                    <span className="change-label">
                      {t("transcription.review.change", "Change")}
                    </span>
                    <span
                      className={`change-value ${
                        initialData.change_percent < 50
                          ? "change-low"
                          : initialData.change_percent < 85
                            ? "change-medium"
                            : "change-high"
                      }`}
                    >
                      {initialData.change_percent}%
                    </span>
                  </div>
                  <div
                    className="review-close-button review-close-btn"
                    onClick={handleCancel}
                  >
                    <CancelIcon />
                  </div>
                </div>
              )}

              {initialData.output_mode === "chat" && (
                <div className="review-header">
                  <div className="review-skill-name">
                    {initialData.skill_name ||
                      t("transcription.review.generationTitle", "AI Assistant")}
                  </div>
                  <div
                    className="review-close-button review-close-btn"
                    onClick={handleCancel}
                  >
                    <CancelIcon />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {displayCandidates && displayCandidates.length > 0 ? (
          <div className="review-multi-content">
            {/* All panels including source */}
            <ScrollArea
              scrollbars="vertical"
              className="multi-candidates-panels"
            >
              {/* Source transcription as a reference panel */}
              <div className="candidate-panel candidate-tint-source">
                <div className="candidate-panel-header">
                  <span className="candidate-label">
                    {t("transcription.review.source", "Live transcript")}
                  </span>
                </div>
                <div className="candidate-panel-content">
                  {initialData.source_text || "—"}
                </div>
              </div>

              {(() => {
                const maxTime = Math.max(
                  ...displayCandidates.map((c) => c.processing_time_ms),
                  1,
                );
                // Compute time ranking: fastest = 1
                const readyWithTime = displayCandidates
                  .filter(
                    (c) => c.ready && !c.error && c.processing_time_ms > 0,
                  )
                  .sort((a, b) => a.processing_time_ms - b.processing_time_ms);
                const timeRankMap = new Map<string, number>();
                readyWithTime.forEach((c, i) => timeRankMap.set(c.id, i + 1));

                return displayCandidates.map((candidate, index) => (
                  <div
                    key={candidate.id}
                    className={`candidate-panel candidate-tint-${index % 4} ${
                      selectedCandidateId === candidate.id ? "selected" : ""
                    } ${candidate.error ? "error" : ""} ${!candidate.ready ? "loading" : ""}`}
                    onClick={() => {
                      if (candidate.ready && !candidate.error) {
                        setSelectedCandidateId(candidate.id);
                      }
                    }}
                  >
                    <div className="candidate-panel-header">
                      {/* Time fill inside header as progress indicator */}
                      <div
                        className={`candidate-header-fill${!candidate.ready ? " loading" : ""}`}
                        style={
                          candidate.ready && candidate.processing_time_ms > 0
                            ? {
                                width: `${(candidate.processing_time_ms / maxTime) * 100}%`,
                              }
                            : undefined
                        }
                      />
                      <span className="candidate-label">{candidate.label}</span>
                      <div className="candidate-meta">
                        {candidate.ready ? (
                          <>
                            {candidate.error ? (
                              <span className="error-badge">
                                {t("common.error", "Error")}
                              </span>
                            ) : (
                              <span className="candidate-header-stats">
                                {timeRankMap.has(candidate.id) && (
                                  <span
                                    className={`candidate-rank rank-${timeRankMap.get(candidate.id)}`}
                                  >
                                    {timeRankMap.get(candidate.id)}
                                  </span>
                                )}
                                {candidate.processing_time_ms > 0 && (
                                  <span>
                                    {formatProcessingTime(
                                      candidate.processing_time_ms,
                                    )}
                                  </span>
                                )}
                                {candidate.confidence != null &&
                                  candidate.processing_time_ms > 0 && (
                                    <span className="stat-separator">|</span>
                                  )}
                                {candidate.confidence != null && (
                                  <span>{candidate.confidence}%</span>
                                )}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="candidate-loading-badge">
                            {t(
                              "transcription.review.processing",
                              "Processing...",
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="candidate-panel-content">
                      {candidate.ready ? (
                        candidate.error ? (
                          <span className="candidate-error-text">
                            {candidate.error}
                          </span>
                        ) : (
                          <>
                            <span>{candidate.text}</span>
                            <Tooltip
                              content={t(
                                "transcription.review.insert",
                                "Insert",
                              )}
                            >
                              <button
                                type="button"
                                className="candidate-insert-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDirectInsert(candidate.text);
                                }}
                              >
                                <IconTextPlus size={16} />
                              </button>
                            </Tooltip>
                          </>
                        )
                      ) : (
                        <div className="candidate-loading-shimmer" />
                      )}
                    </div>
                  </div>
                ));
              })()}
            </ScrollArea>
          </div>
        ) : (
          <div className="review-content-area">
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
              <EditorContent editor={editor} className="flex-1 min-h-0" />
            </div>
          </div>
        )}

        {/* Footer with hint and insert button */}
        <div className="review-footer">
          <div className="review-footer-left">
            {initialData.reason?.trim() ? (
              <span className="reason-text">{initialData.reason}</span>
            ) : null}
          </div>
          <div className="review-footer-actions">
            {initialData.output_mode === "chat" && (
              <button
                className="review-btn-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getEditorText());
                  } catch (err) {
                    console.error("Failed to copy text: ", err);
                  }
                }}
                disabled={isSubmitting || !getEditorText().trim()}
              >
                <IconCopy size={14} />
                {t("common.copy", "Copy")}
              </button>
            )}
            <button
              className="review-btn-primary"
              onClick={handleInsert}
              disabled={isSubmitting || !getEditorText().trim()}
              data-tauri-drag-region="false"
            >
              {t("transcription.review.insert", "Insert")}{" "}
              <span className="opacity-60 ml-1 font-normal">
                {insertShortcut}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewWindow;
