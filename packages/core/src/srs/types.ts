export type Grade = 0 | 1 | 2 | 3 | 4 | 5;
// ── What a grade means ───────────────────────────────────────────
// 0..2 — the user failed the card
// 3..4 — the user passed
// 5    — the user passed perfectly ("easy")
// The single source of truth for "did this count as a pass" — reused by
// sm2.ts's scheduling AND by the extension's per-direction stats (which
// direction the user actually struggles with, for pickDirection below).
export const MINIMUM_PASSING_GRADE: Grade = 3;
export const isFailedGrade = (grade: Grade): boolean => grade < MINIMUM_PASSING_GRADE;
export type Phase = 'learning' | 'review' | 'relearning';
export type AlgoId = 'sm2' | 'leitner'; // 'fsrs' reserved for a later loop
/** How hard a word gets drilled before the app trusts it with a long gap.
 *  Only meaningful for sm2 — leitner's whole pitch is a single fixed
 *  ladder, so it ignores this. */
export type Pace = 'gentle' | 'standard' | 'aggressive';

export interface SrsState {
  algo: AlgoId;
  /** locked in when the word was saved/moved (see WordRepository) so a
   *  later change to the default pace never reshuffles a word already
   *  partway through its ladder onto a differently-shaped one. Words
   *  saved before this field existed read as undefined at runtime
   *  despite the type — callers that care must default it (see
   *  word-repository.ts's schedulerFor). */
  pace: Pace;
  phase: Phase;
  /** index into learning/relearning steps; meaningless in review phase */
  stepIndex: number;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  /** every wrong answer, in any phase — including a miss during the
   *  learning ladder, which resets stepIndex back to 0 and would
   *  otherwise be indistinguishable from a word that's never been
   *  attempted at all. Only ever goes up. */
  lapses: number;
}

export interface SchedulerConfig {
  /** in-day repetition steps for new words, in SECONDS: a rapid-fire burst
   *  followed by escalating pauses, so a brand-new word gets drilled
   *  through every step before it's ever trusted with a multi-day gap.
   *  Every pass advances exactly one step regardless of how easy or fast
   *  it felt — see sm2.ts's scheduleLearning — so a word's actual schedule
   *  always matches this ladder, never a shortcut past it. */
  learningStepsSec: number[];
  /** steps after a lapse, minutes */
  relearningStepsMin: number[];
  /** First review interval after graduating learning (walking the whole
   *  ladder above), days. Kept at the "curve of remembering" convention
   *  every mainstream SRS uses: the first real spaced check is ~1 day out
   *  regardless of how much same-day drilling preceded it — ease-based
   *  multiplicative growth (scheduleReview) is what builds the actual
   *  long-interval curve from there, not a big manual first jump. */
  graduatingIntervalDays: number;
  /** floor for the ease factor */
  minEase: number;
  /** multiplier applied to the pre-lapse interval after relearning */
  lapseIntervalFactor: number;
}

const SEC = 1;
const MIN = 60;
const HOUR = 3_600;
const DAY = 86_400;

// Three hand-tuned ladders, all sharing the same shape (a same-sitting
// burst, then an escalating same-day-to-week ladder, then classic SM-2
// ease-based growth) but differing in how many touches a word gets and how
// long that ladder runs before graduating. Aggressive is the original
// ladder this app shipped with; Gentle and Standard trade drilling depth
// for speed. Every step is walked in order regardless of how easy or fast
// an answer felt — see sm2.ts's scheduleLearning — so this ladder IS the
// schedule, not just what a lucky run might land on.
//
// A note on indexing: learningStepsSec[0] is never experienced on a clean
// pass — a pass at stepIndex i waits learningStepsSec[i+1] (see sm2.ts's
// scheduleLearning), so index 0 only ever surfaces as the post-lapse retry
// delay. Every config below sets it to match the first real burst wait, so
// failing and retrying feels the same as the word's very first attempt.

export const GENTLE_CONFIG: SchedulerConfig = {
  // 25s x1 -> 10m -> 2h -> 1d, graduating at 1d.
  learningStepsSec: [
    25 * SEC, // 0: also the "just failed" retry delay
    25 * SEC, // 1: the one same-sitting burst rep
    10 * MIN, // 2
    2 * HOUR, // 3
    1 * DAY, // 4
  ],
  relearningStepsMin: [10],
  graduatingIntervalDays: 1,
  minEase: 1.3,
  lapseIntervalFactor: 0.5,
};

export const STANDARD_CONFIG: SchedulerConfig = {
  // 25s x2 -> 1m -> 5m -> 20m -> 1h -> 4h -> 1d -> 2d, graduating at 1d.
  learningStepsSec: [
    25 * SEC, // 0: also the "just failed" retry delay
    25 * SEC, // 1
    25 * SEC, // 2
    1 * MIN, // 3
    5 * MIN, // 4
    20 * MIN, // 5
    1 * HOUR, // 6
    4 * HOUR, // 7
    1 * DAY, // 8
    2 * DAY, // 9
  ],
  relearningStepsMin: [10],
  graduatingIntervalDays: 1,
  minEase: 1.3,
  lapseIntervalFactor: 0.5,
};

export const AGGRESSIVE_CONFIG: SchedulerConfig = {
  // 25s x5 -> 15m -> 30m -> 45m -> 2h -> 6h -> 1d -> 2d -> 3d, graduating
  // at 1d. The original ladder — deliberately thorough: the most touches
  // and the longest same-day-to-week escalation before the app trusts a
  // word with real spaced review at all. What comes AFTER graduating no
  // longer scales with pace — every pace hands off to the same
  // ease-multiplied "curve of remembering" growth (see scheduleReview),
  // so more drilling buys a more thoroughly-proven word, not a bigger
  // first jump away from daily rotation.
  learningStepsSec: [
    25 * SEC, // 0: also the "just failed" retry delay
    25 * SEC, // 1
    25 * SEC, // 2
    25 * SEC, // 3
    25 * SEC, // 4
    25 * SEC, // 5
    15 * MIN, // 6
    30 * MIN, // 7
    45 * MIN, // 8
    2 * HOUR, // 9
    6 * HOUR, // 10
    1 * DAY, // 11
    2 * DAY, // 12
    3 * DAY, // 13
  ],
  relearningStepsMin: [10],
  graduatingIntervalDays: 1,
  minEase: 1.3,
  lapseIntervalFactor: 0.5,
};

export const PACE_CONFIGS: Record<Pace, SchedulerConfig> = {
  gentle: GENTLE_CONFIG,
  standard: STANDARD_CONFIG,
  aggressive: AGGRESSIVE_CONFIG,
};

/** @deprecated use PACE_CONFIGS.aggressive — kept as an alias so existing
 *  imports (and anyone who wants "the original ladder" specifically)
 *  don't need to change. */
export const DEFAULT_CONFIG = AGGRESSIVE_CONFIG;

export interface SrsAlgorithm {
  readonly id: AlgoId;
  /** pure function: returns a NEW state, never mutates the input */
  schedule(state: SrsState, grade: Grade, now: Date): SrsState;
}

const MS_PER_SEC = 1_000;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * MS_PER_SEC);
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * MS_PER_MIN);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS_PER_DAY);

export function initialState(algo: AlgoId, now: Date, pace: Pace = 'aggressive'): SrsState {
  return {
    algo,
    pace,
    phase: 'learning',
    stepIndex: 0,
    dueAt: now,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
  };
}
