import type { Grade } from '../srs/types';

// ── Product decisions, all in one place ──────────────────────────
// Answered within 7 seconds = recalled instantly (best grade).
const FAST_ANSWER_MS = 7_000;
// In a word of 3 letters or fewer, a "one-letter typo" is usually
// a different word (кот/кит), so typo tolerance only applies from 4 letters.
const MIN_LENGTH_FOR_TYPO_TOLERANCE = 4;
const ONE_TYPO = 1;

// What each outcome is worth for the SRS scheduler (0..5):
const GRADE_SKIPPED: Grade = 0; //      gave up
const GRADE_WRONG: Grade = 1; //        answered, but wrong
const GRADE_WITH_HELP: Grade = 3; //    correct, but used a hint — capped
const GRADE_ALMOST: Grade = 3; //       one typo away from correct
const GRADE_CORRECT_SLOW: Grade = 4; // correct, took a while
const GRADE_CORRECT_FAST: Grade = 5; // correct and instant

/**
 * Brings an answer to a comparable form, so that "  СтойКость " and
 * "стойкость" count as the same answer. Steps:
 */
export function normalizeAnswer(input: string): string {
  let text = input;
  // 1. Split accented Latin letters into "base letter + accent mark" (é → e + ´)
  text = text.normalize('NFD');
  // 2. Remove accent marks, but only after LATIN letters (résumé → resume).
  //    Cyrillic й is also "и + mark" after step 1, and must survive untouched.
  text = text.replace(/(?<=\p{Script=Latin})[\u0300-\u036f]/gu, '');
  // 3. Glue what's left back together (и + mark → й again)
  text = text.normalize('NFC');
  // 4. In Russian, the letters е and ё are treated as the same letter
  //    (\u0451 = ё, \u0435 = е; \u0401 = Ё, \u0415 = Е) — escaped to keep
  //    the built bundle pure ASCII, which some browsers require.
  text = text.replace(/\u0451/g, '\u0435').replace(/\u0401/g, '\u0415');
  // 5. Case doesn't matter
  text = text.toLowerCase();
  // 6. Drop punctuation — keep only letters, digits and spaces
  text = text.replace(/[^\p{L}\p{N}\s]/gu, '');
  // 7. Collapse repeated spaces and trim the ends
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Edit distance: the number of single-character changes
 * (insert / delete / replace) needed to turn `a` into `b`.
 * Example: kitten → sitting = 3.
 *
 * Classic dynamic programming, row by row. previousRow[j] holds the
 * distance between the already-processed part of `a` and the first
 * j characters of `b`.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Distances from the empty string: 0, 1, 2, ... (just insert every char)
  let previousRow: number[] = [];
  for (let j = 0; j <= b.length; j++) previousRow.push(j);

  for (let i = 1; i <= a.length; i++) {
    const currentRow: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const charsAreEqual = a[i - 1] === b[j - 1];
      const replaceCost = previousRow[j - 1]! + (charsAreEqual ? 0 : 1);
      const deleteCost = previousRow[j]! + 1;
      const insertCost = currentRow[j - 1]! + 1;
      currentRow.push(Math.min(replaceCost, deleteCost, insertCost));
    }
    previousRow = currentRow;
  }
  return previousRow[b.length]!;
}

export type Verdict = 'correct' | 'almost' | 'wrong';

export interface GradeContext {
  latencyMs?: number;
  usedHint?: boolean;
  skipped?: boolean;
}

export interface GradeResult {
  verdict: Verdict;
  grade: Grade;
  /** which of the accepted translations the answer matched, if any */
  matched?: string;
}

/**
 * Turns a typed answer into a verdict + grade for the SRS scheduler.
 * A word may have several accepted translations — matching any one counts.
 */
export function gradeAnswer(
  answer: string,
  acceptedTranslations: string[],
  context: GradeContext = {},
): GradeResult {
  if (context.skipped) {
    return { verdict: 'wrong', grade: GRADE_SKIPPED };
  }

  const userAnswer = normalizeAnswer(answer);
  const accepted = acceptedTranslations.map((raw) => ({
    raw,
    normalized: normalizeAnswer(raw),
  }));

  const exactMatch = accepted.find((t) => t.normalized === userAnswer);
  if (exactMatch) {
    if (context.usedHint) {
      return { verdict: 'correct', grade: GRADE_WITH_HELP, matched: exactMatch.raw };
    }
    const answeredFast = (context.latencyMs ?? 0) <= FAST_ANSWER_MS;
    return {
      verdict: 'correct',
      grade: answeredFast ? GRADE_CORRECT_FAST : GRADE_CORRECT_SLOW,
      matched: exactMatch.raw,
    };
  }

  const longEnoughForTypoTolerance = userAnswer.length >= MIN_LENGTH_FOR_TYPO_TOLERANCE;
  if (longEnoughForTypoTolerance) {
    const oneTypoAway = accepted.find(
      (t) =>
        t.normalized.length >= MIN_LENGTH_FOR_TYPO_TOLERANCE &&
        levenshtein(t.normalized, userAnswer) === ONE_TYPO,
    );
    if (oneTypoAway) {
      return { verdict: 'almost', grade: GRADE_ALMOST, matched: oneTypoAway.raw };
    }
  }

  return { verdict: 'wrong', grade: GRADE_WRONG };
}
