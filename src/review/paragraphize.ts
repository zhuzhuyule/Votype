// Paragraphize long ASR / polished text.
//
// Splits into sentences on CJK + ASCII terminators, then greedily merges
// short sentences so every paragraph lands in a comfortable length band.
// Emits character offsets that renderers (plain + diff) can use to insert
// </p><p> boundaries without touching token-level markup.

const TERMINATORS = /[。！？!?…]/;
const TRAILING_CLOSERS = /["'""」』)）\]】]/;

type Thresholds = {
  min: number;
  softMax: number;
  sweetSpot: number;
  minTotalForSplit: number;
};

const CJK_THRESHOLDS: Thresholds = {
  min: 40,
  softMax: 180,
  sweetSpot: 60,
  minTotalForSplit: 120,
};

const LATIN_THRESHOLDS: Thresholds = {
  min: 80,
  softMax: 300,
  sweetSpot: 120,
  minTotalForSplit: 240,
};

const SWEET_SENTENCE_COUNT = 3;

type Sentence = {
  start: number;
  end: number; // exclusive
  // True when the sentence ends with a real terminator token. Tail runs
  // or \n\n-forced boundaries without punctuation are marked false — we
  // forbid closing a paragraph on them.
  endsWithTerminator: boolean;
};

type ParagraphSpan = {
  start: number;
  end: number; // exclusive
  sentenceCount: number;
};

export type ParagraphPlan = {
  // Sorted char offsets marking where a NEW paragraph begins.
  // paragraphs[i] = text.slice(breaks[i-1] ?? 0, breaks[i] ?? text.length)
  // Empty when the text should stay as a single paragraph.
  breaks: number[];
  paragraphs: ParagraphSpan[];
};

const pickThresholds = (text: string): Thresholds => {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a))
      latin++;
  }
  return cjk >= latin ? CJK_THRESHOLDS : LATIN_THRESHOLDS;
};

const isDigit = (ch: string | undefined) =>
  ch !== undefined && ch >= "0" && ch <= "9";

const splitSentences = (text: string): Sentence[] => {
  const sentences: Sentence[] = [];
  const len = text.length;
  let start = 0;
  let i = 0;

  const flush = (end: number, endsWithTerminator: boolean) => {
    // Trim trailing whitespace off the recorded sentence (keeps punctuation).
    let e = end;
    while (e > start && /\s/.test(text[e - 1])) e--;
    // Skip leading whitespace from the start marker.
    let s = start;
    while (s < e && /\s/.test(text[s])) s++;
    if (s < e) sentences.push({ start: s, end: e, endsWithTerminator });
  };

  while (i < len) {
    const ch = text[i];

    // Hard break on blank line (\n\n or more). Treated as a sentence
    // boundary only when the preceding non-space char is a terminator —
    // otherwise the break is a mid-phrase ASR artefact and must not seed
    // a paragraph split.
    if (ch === "\n" && text[i + 1] === "\n") {
      let p = i - 1;
      while (p >= start && /[ \t]/.test(text[p])) p--;
      const precededByTerminator = p >= start && TERMINATORS.test(text[p]);
      if (precededByTerminator) {
        flush(i, true);
        i += 2;
        while (i < len && text[i] === "\n") i++;
        start = i;
        continue;
      }
      // Fall through: treat \n as whitespace inside the current sentence.
    }

    const isDot = ch === ".";
    if (isDot && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
      i++;
      continue;
    }

    if (TERMINATORS.test(ch)) {
      // Consume consecutive terminators (e.g. "!!!", "……", "?!").
      let j = i + 1;
      while (j < len && TERMINATORS.test(text[j])) j++;
      // Consume trailing closing quotes/brackets.
      while (j < len && TRAILING_CLOSERS.test(text[j])) j++;
      flush(j, true);
      // Skip whitespace/newlines before the next sentence starts.
      while (j < len && /\s/.test(text[j])) j++;
      start = j;
      i = j;
      continue;
    }

    i++;
  }

  // Tail without terminator.
  if (start < len) flush(len, false);
  return sentences;
};

const mergeSentences = (
  sentences: Sentence[],
  thresholds: Thresholds,
): ParagraphSpan[] => {
  const out: ParagraphSpan[] = [];
  let cur: ParagraphSpan | null = null;

  const curLen = () => (cur ? cur.end - cur.start : 0);

  for (let idx = 0; idx < sentences.length; idx++) {
    const s = sentences[idx];
    const sLen = s.end - s.start;

    if (!cur) {
      cur = { start: s.start, end: s.end, sentenceCount: 1 };
      continue;
    }

    // We can only close the current paragraph at a boundary where the
    // LAST committed sentence ended with a terminator. Otherwise breaking
    // here would mid-phrase and violate the "换行只在标点后" rule.
    const prevSentence = sentences[idx - 1];
    const breakableHere = prevSentence?.endsWithTerminator === true;
    const projected = curLen() + sLen;
    const shouldClose =
      breakableHere &&
      curLen() >= thresholds.min &&
      ((cur.sentenceCount >= SWEET_SENTENCE_COUNT &&
        curLen() >= thresholds.sweetSpot) ||
        projected > thresholds.softMax);

    if (shouldClose) {
      out.push(cur);
      cur = { start: s.start, end: s.end, sentenceCount: 1 };
    } else {
      cur.end = s.end;
      cur.sentenceCount++;
    }
  }
  if (cur) out.push(cur);

  // Orphan-tail merge: short trailing paragraph folds into its predecessor.
  if (out.length >= 2) {
    const last = out[out.length - 1];
    if (last.end - last.start < thresholds.min) {
      const prev = out[out.length - 2];
      prev.end = last.end;
      prev.sentenceCount += last.sentenceCount;
      out.pop();
    }
  }

  return out;
};

// Collapse mid-phrase newlines. A run of \n is preserved only when the
// preceding non-space character is a sentence terminator; otherwise it is
// replaced with a single ASCII space (which escapeHtmlWithBreaks will not
// turn into a <br />). This guards against ASR output that dumps raw
// segment newlines between repeated tokens like "你\n你".
export const normalizeLineBreaks = (text: string): string => {
  if (!text.includes("\n")) return text;
  return text.replace(/\n+/g, (match, offset: number) => {
    let p = offset - 1;
    while (p >= 0 && (text[p] === " " || text[p] === "\t")) p--;
    const prev = p >= 0 ? text[p] : "";
    if (prev && TERMINATORS.test(prev)) return match;
    return " ";
  });
};

export const paragraphize = (text: string): ParagraphPlan => {
  const single: ParagraphPlan = {
    breaks: [],
    paragraphs: [{ start: 0, end: text.length, sentenceCount: 1 }],
  };

  if (!text) return single;

  const thresholds = pickThresholds(text);
  if (text.length < thresholds.minTotalForSplit) return single;

  const sentences = splitSentences(text);
  if (sentences.length < 2) return single;

  const paragraphs = mergeSentences(sentences, thresholds);
  if (paragraphs.length < 2) return single;

  const breaks = paragraphs.slice(1).map((p) => p.start);
  return { breaks, paragraphs };
};
