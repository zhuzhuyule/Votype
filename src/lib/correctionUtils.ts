/**
 * Simple word diff algorithm to find corrections
 * Used to auto-learn vocabulary corrections when user edits transcription
 */
export const extractCorrections = (
  original: string,
  edited: string,
): { original: string; corrected: string }[] => {
  const originalWords = original.trim().split(/\s+/);
  const editedWords = edited.trim().split(/\s+/);

  const corrections: { original: string; corrected: string }[] = [];

  // Use a simple LCS-based diff or just a linear scan if lengths are close
  // For simplicity and effectiveness in this correction context, we'll try a basic alignment strategy:
  // We look for 1-to-1 replacements surrounded by matching contexts.

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

  // Backtrack to find aligned pairs and identifying changes
  let i = n;
  let j = m;

  // Track alignment indices (match pairs)
  const matches: { i: number; j: number }[] = [];

  // Re-run LCS backtracking strictly to find MATCH indices
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
  matches.reverse(); // Now sorted by index

  // Scan gaps between matches
  let prevI = -1;
  let prevJ = -1;

  // Add a sentry match at the end to handle trailing gaps
  matches.push({ i: n, j: m });

  for (let k = 0; k < matches.length; k++) {
    const match = matches[k];

    // 1. Check strict equality of the matched words themselves (excluding sentry)
    if (k < matches.length - 1) {
      // Not the sentry
      const origW = originalWords[match.i];
      const editW = editedWords[match.j];
      if (origW !== editW) {
        // Case-insensitive match but exact mismatch -> Case correction
        corrections.push({ original: origW, corrected: editW });
      }
    }

    // 2. Check gaps preceding this match
    const gapOriginal = originalWords.slice(prevI + 1, match.i);
    const gapEdited = editedWords.slice(prevJ + 1, match.j);

    // If gaps are both length 1, treat as substitution correction
    if (gapOriginal.length === 1 && gapEdited.length === 1) {
      const originalWord = gapOriginal[0];
      const correctedWord = gapEdited[0];

      // Double check they aren't identical (case-sensitive)
      if (originalWord !== correctedWord) {
        corrections.push({ original: originalWord, corrected: correctedWord });
      }
    }

    prevI = match.i;
    prevJ = match.j;
  }

  return corrections;
};
