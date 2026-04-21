// Pure utility functions for diff computation and HTML generation
// No React dependencies

import { escapeHtml } from "../lib/utils/html";
import { paragraphize, type ParagraphPlan } from "./paragraphize";

type Token = {
  value: string;
  start: number;
  end: number;
};

type DiffAnnotations = {
  sourceStatuses: Array<"equal" | "delete">;
  targetLevels: Array<"minor" | "major" | null>;
};

type ScriptType = "latin" | "han" | "other";

const escapeHtmlWithBreaks = (value: string): string =>
  escapeHtml(value).replace(/\n/g, "<br />");

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

export const computeDiffAnnotations = (
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
  // Removed log to avoid import dependency
  console.debug("[diff-utils] computeDiffAnnotations", {
    sourceChars: source.length,
    targetChars: target.length,
    sourceTokens: sourceLen,
    targetTokens: targetLen,
    dpCells: (sourceLen + 1) * (targetLen + 1),
    durationMs,
  });

  return { sourceStatuses, targetLevels };
};

// Emits escaped HTML for [from, to), inserting </p><p> whenever a paragraph
// boundary is crossed. Leading/trailing whitespace inside each paragraph slice
// is trimmed so inter-paragraph newlines don't turn into stray <br /> rows.
const renderSegmented = (
  text: string,
  plan: ParagraphPlan,
  emitToken: (index: number, escaped: string) => string,
  tokens: Token[],
) => {
  const wrap = plan.paragraphs.length > 1;
  const paragraphs = plan.paragraphs;

  let html = wrap ? "<p>" : "";
  let pIdx = 0;
  let cursor = wrap ? paragraphs[0].start : 0;

  const emitPlain = (from: number, to: number) => {
    if (from >= to) return;
    const slice = text.slice(from, to);
    // Trim just the whitespace that sits at a paragraph edge.
    html += escapeHtmlWithBreaks(slice);
  };

  const advancePast = (upto: number) => {
    if (!wrap) return;
    while (pIdx < paragraphs.length - 1 && upto > paragraphs[pIdx].end) {
      emitPlain(cursor, paragraphs[pIdx].end);
      html += "</p><p>";
      pIdx += 1;
      cursor = paragraphs[pIdx].start;
    }
  };

  tokens.forEach((token, index) => {
    advancePast(token.start);
    const gapEnd = Math.min(
      token.start,
      wrap ? paragraphs[pIdx].end : token.start,
    );
    emitPlain(cursor, gapEnd);
    cursor = gapEnd;
    // Tokens are never split across paragraphs (paragraphize breaks on
    // sentence terminators which are always their own token).
    html += emitToken(index, escapeHtmlWithBreaks(token.value));
    cursor = token.end;
  });

  if (wrap) {
    advancePast(text.length);
    emitPlain(cursor, paragraphs[paragraphs.length - 1].end);
    html += "</p>";
  } else {
    emitPlain(cursor, text.length);
  }

  return html;
};

const buildSourceHtml = (
  source: string,
  statuses: Array<"equal" | "delete">,
  plan: ParagraphPlan,
) => {
  const tokens = tokenizeWithIndices(source);
  return renderSegmented(
    source,
    plan,
    (index, escaped) =>
      statuses[index] === "delete"
        ? `<span class="diff-delete">${escaped}</span>`
        : escaped,
    tokens,
  );
};

const buildTargetHtml = (
  target: string,
  levels: Array<"minor" | "major" | null>,
  plan: ParagraphPlan,
) => {
  const tokens = tokenizeWithIndices(target);
  return renderSegmented(
    target,
    plan,
    (index, escaped) => {
      const level = levels[index];
      return level
        ? `<span data-diff-level="${level}">${escaped}</span>`
        : escaped;
    },
    tokens,
  );
};

const buildPlainHtml = (text: string, plan: ParagraphPlan) => {
  if (plan.paragraphs.length <= 1) return escapeHtmlWithBreaks(text);
  return plan.paragraphs
    .map((p) => `<p>${escapeHtmlWithBreaks(text.slice(p.start, p.end))}</p>`)
    .join("");
};

export interface ChangeStats {
  addedChars: number;
  removedChars: number;
  changePercent: number;
}

export const computeChangeStats = (
  source: string,
  target: string,
): ChangeStats => {
  const { sourceStatuses, targetLevels } = computeDiffAnnotations(
    source,
    target,
  );
  const sourceTokens = tokenizeWithIndices(source);
  const targetTokens = tokenizeWithIndices(target);
  const totalTokens = Math.max(sourceStatuses.length, targetLevels.length);

  let removedChars = 0;
  sourceTokens.forEach((t, i) => {
    if (sourceStatuses[i] === "delete") removedChars += t.value.length;
  });
  let addedChars = 0;
  targetTokens.forEach((t, i) => {
    if (targetLevels[i] !== null) addedChars += t.value.length;
  });

  if (totalTokens === 0)
    return { addedChars: 0, removedChars: 0, changePercent: 0 };
  const deletedCount = sourceStatuses.filter((s) => s === "delete").length;
  const changedCount = targetLevels.filter((l) => l !== null).length;
  const magnitude = Math.round(
    ((deletedCount + changedCount) / totalTokens) * 100,
  );
  const changePercent = target.length < source.length ? -magnitude : magnitude;

  return { addedChars, removedChars, changePercent };
};

export const computeChangePercent = (
  source: string,
  target: string,
): number => {
  return computeChangeStats(source, target).changePercent;
};

export const buildPlainViews = (source: string, target: string) => ({
  sourceHtml: buildPlainHtml(source, paragraphize(source)),
  targetHtml: buildPlainHtml(target, paragraphize(target)),
});

export const buildDiffViews = (source: string, target: string) => {
  const start = performance.now();
  const { sourceStatuses, targetLevels } = computeDiffAnnotations(
    source,
    target,
  );
  const sourcePlan = paragraphize(source);
  const targetPlan = paragraphize(target);
  const result = {
    sourceHtml: buildSourceHtml(source, sourceStatuses, sourcePlan),
    targetHtml: buildTargetHtml(target, targetLevels, targetPlan),
  };
  const durationMs = Math.round(performance.now() - start);
  console.debug("[diff-utils] buildDiffViews", {
    sourceChars: source.length,
    targetChars: target.length,
    sourceHtmlChars: result.sourceHtml.length,
    targetHtmlChars: result.targetHtml.length,
    durationMs,
  });
  return result;
};
