/**
 * Simple word diff algorithm to find corrections
 * Used to auto-learn vocabulary corrections when user edits transcription
 */
export const extractCorrections = (
  original: string,
  edited: string,
): { original: string; corrected: string }[] => {
  // Enhanced Tokenizer:
  // 1. Separate CJK characters with spaces to treat them as individual tokens
  // 2. Keep English words intact by just splitting on whitespace
  const tokenize = (text: string): string[] => {
    // Replace every CJK character with " char "
    // Range includes:
    // \u4e00-\u9fa5 (Common CJK)
    // \u3000-\u303f (CJK punctuation)
    // \uff00-\uffef (Full-width ASCII)
    const spaced = text.replace(
      /([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g,
      " $1 ",
    );
    return spaced
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
  };

  const originalWords = tokenize(original);
  const editedWords = tokenize(edited);

  const corrections: { original: string; corrected: string }[] = [];

  const n = originalWords.length;
  const m = editedWords.length;
  const dp: number[][] = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (
        originalWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()
      ) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find aligned pairs
  let i = n;
  let j = m;

  const matches: { i: number; j: number }[] = [];

  while (i > 0 && j > 0) {
    if (
      originalWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()
    ) {
      matches.push({ i: i - 1, j: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  matches.reverse();

  let prevI = -1;
  let prevJ = -1;

  matches.push({ i: n, j: m });

  for (let k = 0; k < matches.length; k++) {
    const match = matches[k];

    // 1. Check strict equality of matched words (Case correction)
    if (k < matches.length - 1) {
      const origW = originalWords[match.i];
      const editW = editedWords[match.j];
      if (origW !== editW) {
        corrections.push({ original: origW, corrected: editW });
      }
    }

    // 2. Check gaps preceding this match (Substitution/Insertion/Deletion)
    const gapOriginal = originalWords.slice(prevI + 1, match.i);
    const gapEdited = editedWords.slice(prevJ + 1, match.j);

    // Filter out purely empty gaps (triggered by sentry if partial match at end)
    if (gapOriginal.length > 0 || gapEdited.length > 0) {
      // N-to-M replacement heuristic
      // We allow multi-token replacements if they are "local" enough.
      // e.g. "Testing" -> "Test ing" (1 -> 2)
      // e.g. "测 试" -> "修 改" (2 -> 2)
      // Limit gap size to avoid large hallucinations being treated as "vocabulary"
      const MAX_GAP_SIZE = 4;

      if (
        gapOriginal.length <= MAX_GAP_SIZE &&
        gapEdited.length <= MAX_GAP_SIZE
      ) {
        // Join back tokens to form the phrase
        // Note: For CJK, we might want to join without spaces?
        // But our tokenize added spaces.
        // Let's reconstruct strings.
        // Simple strategy: Join with empty string if CJK, space if English?
        // Actually, `record_vocabulary_correction` expects the raw string.
        // Reconstructing from tokens is lossy (we lost original whitespace).

        // Better strategy:
        // Using the indices (prevI/prevJ and match.i/match.j),
        // we map back to the *concept* of the change.
        // But we tokenized destructively.

        // For now, let's just join tokens.
        // If a token is CJK, we probably don't want spaces around it in the final output?
        // But standard joining with space is safer for verify.
        // Wait, if I learn "测 试" -> "修 改", the vocab manager receives:
        // original: "测 试", corrected: "修 改".
        // During transcription apply, if the input is "测试" (no spaces), it won't match "测 试".

        // CRITICAL: Vocabulary Manager generally applies corrections on the *raw string* or *token stream*?
        // `VocabularyManager::apply_corrections` usually does string replacement.
        // If I record "测 试" (with space), it won't match "测试" (no space).

        // FIX: We need to reconstruct the string *without* extra spaces for CJK.
        // Or simply join with empty string if the tokens are CJK?

        const joinTokens = (tokens: string[]) => {
          // Primitive heuristic: join with space, then remove space between CJK chars
          let joined = tokens.join(" ");
          // Remove space between CJK and CJK
          return joined.replace(
            /([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g,
            "$1$2",
          );
        };

        const originalPhrase = joinTokens(gapOriginal);
        const correctedPhrase = joinTokens(gapEdited);

        if (
          originalPhrase !== correctedPhrase &&
          originalPhrase.trim() &&
          correctedPhrase.trim()
        ) {
          corrections.push({
            original: originalPhrase,
            corrected: correctedPhrase,
          });
        }
      }
    }

    prevI = match.i;
    prevJ = match.j;
  }

  return corrections;
};
