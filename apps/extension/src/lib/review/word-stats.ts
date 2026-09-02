import { PACE_CONFIGS, DEFAULT_LEITNER_CONFIG, type SchedulerConfig } from '@vocably/core';
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

/** Where a word sits on its algorithm's ladder right now — kept as plain
 *  data (not a formatted string) so it doesn't need to know about
 *  translation; ReviewPane turns this into a label via the i18n dict. */
export type LadderProgress =
  | { kind: 'box'; step: number; total: number }
  | { kind: 'learning'; step: number; total: number }
  | { kind: 'relearning'; step: number; total: number }
  | { kind: 'review'; ease: number };

/** Words saved before `pace` existed have no such field at runtime despite
 *  the type — same defaulting as word-repository.ts's schedulerFor. */
function configFor(word: Word): SchedulerConfig {
  return PACE_CONFIGS[word.srsState.pace ?? 'aggressive'];
}

export function algoProgress(word: Word): LadderProgress {
  const { algo, phase, stepIndex, easeFactor } = word.srsState;
  if (algo === 'leitner') {
    return { kind: 'box', step: stepIndex + 1, total: DEFAULT_LEITNER_CONFIG.boxIntervalDays.length };
  }
  const config = configFor(word);
  if (phase === 'learning') {
    return { kind: 'learning', step: stepIndex + 1, total: config.learningStepsSec.length };
  }
  if (phase === 'relearning') {
    return { kind: 'relearning', step: stepIndex + 1, total: config.relearningStepsMin.length };
  }
  return { kind: 'review', ease: Number(easeFactor.toFixed(1)) };
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

  const config = configFor(word);
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
    ? config.learningStepsSec.length - stepIndex
    : config.relearningStepsMin.length - stepIndex;
  return stepsRemaining + reviewRepsFrom(config.graduatingIntervalDays, easeFactor);
}

/** How far along the road to "mastered" a word is, 0..1 — what the progress
 *  bar in the Review and Library tabs fills to.
 *
 *  Measured in REVIEWS, not days: (journey - remaining) / journey, where both
 *  halves come from estimateReviewsToMastery so the bar and the "n reviews to
 *  go" text beside it can never disagree. Days would be the wrong unit — the
 *  learning ladder is 14 of the 18 reviews on the default pace but only ~7 of
 *  the ~88 days, so a day-based bar would sit near zero through all the work
 *  the user actually does.
 *
 *  The baseline is the SAME word rewound to the start of its ladder, keeping
 *  its current ease. So a word that has become hard (low ease) honestly shows
 *  less progress than an easy one at the same step — there genuinely is more
 *  work left — instead of being measured against a stranger's easier journey.
 *
 *  Can go DOWN: a lapse halves the interval and re-lengthens the road, which
 *  is the same reversibility isMastered has (see progress.ts). */
export function masteryProgress(word: Word): number {
  if (isMastered(word)) return 1;
  const remaining = estimateReviewsToMastery(word);
  const wholeJourney = estimateReviewsToMastery({
    ...word,
    srsState: {
      ...word.srsState,
      phase: 'learning',
      stepIndex: 0,
      intervalDays: 0,
      repetitions: 0,
    },
  });
  if (wholeJourney <= 0) return 0;
  return clamp01(1 - remaining / wholeJourney);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export { NO_HISTORY as EMPTY_WORD_STATS };
