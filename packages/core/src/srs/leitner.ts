import { addDays, type Grade, type SrsAlgorithm, type SrsState } from './types';

// ── Leitner box system ────────────────────────────────────────────
// A simpler alternative to SM-2: a fixed ladder of boxes, each with its
// own review interval. A correct answer promotes the card one box (a
// longer interval); a wrong answer drops it straight back to box 1.
// No ease factor, no per-word tuning — the whole point is that it's
// easy to reason about.
//
// The card's box is stored in `stepIndex` (0-based: box 1 = index 0) and
// its interval mirrored into `intervalDays` so the rest of the app (which
// reads intervalDays to decide "mastered", sort order, etc.) doesn't need
// to know which algorithm produced it.

const MINIMUM_PASSING_GRADE: Grade = 3;
const isFailed = (grade: Grade): boolean => grade < MINIMUM_PASSING_GRADE;

export interface LeitnerConfig {
  /** interval, in days, for each box — index 0 is box 1 */
  boxIntervalDays: number[];
}

export const DEFAULT_LEITNER_CONFIG: LeitnerConfig = {
  // Index 0 is never experienced on a clean pass — see enterBox/schedule
  // below, a correct answer always promotes at least one box past the
  // current one, so a brand-new word's first success lands on index 1,
  // not index 0. The leading 1 here exists so that first success is still
  // "1 day," not the "2 days" it would be if index 0 were skipped straight
  // over (as it was before this field had a duplicate leading value) —
  // a brand-new word deserves an actual same-day-ish check-in, not an
  // immediate 2-day gap of trust it hasn't earned yet.
  boxIntervalDays: [1, 1, 2, 4, 8, 16],
};

export function createLeitner(config: LeitnerConfig): SrsAlgorithm {
  const boxes = config.boxIntervalDays;
  if (boxes.length === 0) throw new Error('boxIntervalDays must not be empty');

  const enterBox = (state: SrsState, box: number, now: Date): SrsState => ({
    ...state,
    phase: 'review',
    stepIndex: box,
    intervalDays: boxes[box]!,
    dueAt: addDays(now, boxes[box]!),
  });

  const schedule = (state: SrsState, grade: Grade, now: Date): SrsState => {
    if (isFailed(grade)) {
      // Back to box 1, regardless of how far it had climbed.
      return { ...enterBox(state, 0, now), lapses: state.lapses + 1 };
    }
    const nextBox = Math.min(state.stepIndex + 1, boxes.length - 1);
    return { ...enterBox(state, nextBox, now), repetitions: state.repetitions + 1 };
  };

  return { id: 'leitner', schedule };
}
