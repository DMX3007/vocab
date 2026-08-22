import { DEFAULT_CONFIG, DEFAULT_LEITNER_CONFIG } from '@vocabflow/core';
import type { ReviewLog, Word } from '../storage/types';
import { isMastered, MASTERED_INTERVAL_DAYS } from './progress';

// Turns a word's SRS state + its review history into the "what will happen
// with this word" numbers the Review tab shows: which algorithm is driving
// it, where it sits on that algorithm's ladder, its track record, and a
// ballpark of how many more reviews stand between it and "mastered".

/** Grades below this are a miss; matches the core scheduler's pass/fail split. */
const PASS_GRADE = 3;

export interface WordReviewStats {
  total: number;
  passed: number;
  failed: number;
  /** 0-100, rounded; null when the word has no review history yet */
  successRate: number | null;
  errorRate: number | null;
}

const NO_HISTORY: WordReviewStats = { total: 0, passed: 0, failed: 0, successRate: null, errorRate: null };

/** Groups every log by wordId in one pass — call this once for a whole list
 *  rather than filtering the full log array per word. */
export function computeWordStatsById(logs: ReviewLog[]): Map<string, WordReviewStats> {
  const counts = new Map<string, { total: number; passed: number }>();
  for (const log of logs) {
    const entry = counts.get(log.wordId) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (log.grade >= PASS_GRADE) entry.passed += 1;
    counts.set(log.wordId, entry);
  }
  const result = new Map<string, WordReviewStats>();
  for (const [wordId, { total, passed }] of counts) {
    const successRate = Math.round((passed / total) * 100);
    result.set(wordId, { total, passed, failed: total - passed, successRate, errorRate: 100 - successRate });
  }
  return result;
}

/** A short label for where a word sits on its algorithm's ladder right now. */
export function algoProgressLabel(word: Word): string {
  const { algo, phase, stepIndex, easeFactor } = word.srsState;
  if (algo === 'leitner') {
    return `Box ${stepIndex + 1}/${DEFAULT_LEITNER_CONFIG.boxIntervalDays.length}`;
  }
  if (phase === 'learning') return `Learning · step ${stepIndex + 1}/${DEFAULT_CONFIG.learningStepsSec.length}`;
  if (phase === 'relearning') return `Relearning · step ${stepIndex + 1}/${DEFAULT_CONFIG.relearningStepsMin.length}`;
  return `Review · ease ${easeFactor.toFixed(1)}`;
}

/** How many more successful reviews, roughly, from here to isMastered(word).
 *  Not a promise — a ballpark assuming future answers keep going the way
 *  today's ease/box position suggests. Leitner is exact (boxes remaining);
 *  SM-2 projects the ease-driven interval growth out to MASTERED_INTERVAL_DAYS. */
export function estimateReviewsToMastery(word: Word): number {
  if (isMastered(word)) return 0;
  const { algo, phase, stepIndex, intervalDays, easeFactor } = word.srsState;

  if (algo === 'leitner') {
    return DEFAULT_LEITNER_CONFIG.boxIntervalDays.length - 1 - stepIndex;
  }

  const reviewRepsFrom = (startIntervalDays: number, ease: number): number => {
    const safeEase = Math.max(ease, 1.01);
    const start = Math.max(startIntervalDays, 1);
    if (start >= MASTERED_INTERVAL_DAYS) return 0;
    return Math.max(1, Math.ceil(Math.log(MASTERED_INTERVAL_DAYS / start) / Math.log(safeEase)));
  };

  if (phase === 'review') return reviewRepsFrom(intervalDays, easeFactor);

  // Still learning/relearning: the remaining drill steps, then the review
  // reps it'd take from the graduating interval onward.
  const stepsRemaining = phase === 'learning'
    ? DEFAULT_CONFIG.learningStepsSec.length - stepIndex
    : DEFAULT_CONFIG.relearningStepsMin.length - stepIndex;
  return stepsRemaining + reviewRepsFrom(DEFAULT_CONFIG.graduatingIntervalDays, easeFactor);
}

export { NO_HISTORY as EMPTY_WORD_STATS };
