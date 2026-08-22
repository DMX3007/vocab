// Character-level diff for the "which letters were wrong" highlight on a
// missed/almost-right review answer. Purely presentational — grading
// itself (packages/core's levenshtein/gradeAnswer) doesn't use this at
// all. A naive same-index compare would cascade into "everything after
// the typo is wrong" the moment one character is inserted or deleted, so
// this walks a real edit-distance backtrace instead, same DP shape as
// core's levenshtein() but keeping the alignment instead of just the count.

export interface DiffChar {
  char: string;
  correct: boolean;
}

/** Returns one entry per character actually TYPED (not per character of
 *  `expected`) — a character the user typed that doesn't belong (extra, or
 *  standing in for a different letter) is marked incorrect; a letter
 *  missing from what they typed has nothing to color, so it's simply not
 *  represented here. */
export function diffChars(typed: string, expected: string): DiffChar[] {
  const a = [...typed];
  const b = [...expected];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j - 1]!, dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  const result: DiffChar[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ char: a[i - 1]!, correct: true });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + 1) {
      result.push({ char: a[i - 1]!, correct: false }); // substitution
      i--; j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      result.push({ char: a[i - 1]!, correct: false }); // extra typed character
      i--;
    } else {
      j--; // a letter missing from `typed` — nothing typed to color
    }
  }
  return result.reverse();
}
