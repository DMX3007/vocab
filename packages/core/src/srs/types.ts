export type Grade = 0 | 1 | 2 | 3 | 4 | 5;
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
  /** in-day repetition steps for new words, in SECONDS: a mandatory
   *  rapid-fire burst (see learningBurstSteps) followed by escalating
   *  pauses, so a brand-new word gets drilled hard before it's ever
   *  trusted with a multi-day gap. */
  learningStepsSec: number[];
  /** how many of the LEADING learningStepsSec are mandatory — even a
   *  perfect/instant answer can't skip past these. Only once a word is
   *  past this many steps can grade 5 ("easy") jump straight to
   *  graduation; answering fast on a word's very first rep doesn't prove
   *  it's actually memorized long-term, it's just fresh in memory. */
  learningBurstSteps: number;
  /** steps after a lapse, minutes */
  relearningStepsMin: number[];
  /** first review interval after graduating learning, days */
  graduatingIntervalDays: number;
  /** interval when graduating with grade 5 ("easy") past the mandatory burst, days */
  easyIntervalDays: number;
  /** floor for the ease factor */
  minEase: number;
  /** multiplier applied to the pre-lapse interval after relearning */
  lapseIntervalFactor: number;
}

const SEC = 1;
const MIN = 60;
const HOUR = 3_600;
const DAY = 86_400;

// Three hand-tuned ladders, all sharing the same shape (a mandatory
// same-sitting burst, then an escalating same-day-to-week ladder, then
// classic SM-2 ease-based growth) but differing in how many touches a word
// gets and how fast it graduates. Aggressive is the original ladder this
// app shipped with; Gentle and Standard trade drilling depth for speed.
//
// A note on indexing: learningStepsSec[0] is never experienced on a clean
// pass — a pass at stepIndex i waits learningStepsSec[i+1] (see sm2.ts's
// scheduleLearning), so index 0 only ever surfaces as the post-lapse retry
// delay. Every config below sets it to match the first real burst wait, so
// failing and retrying feels the same as the word's very first attempt.

export const GENTLE_CONFIG: SchedulerConfig = {
  // 25s x1 -> 10m -> 2h -> 1d, graduating at 2d.
  learningStepsSec: [
    25 * SEC, // 0: also the "just failed" retry delay
    25 * SEC, // 1: the one mandatory burst rep
    10 * MIN, // 2
    2 * HOUR, // 3
    1 * DAY, // 4
  ],
  learningBurstSteps: 1,
  relearningStepsMin: [10],
  graduatingIntervalDays: 2,
  easyIntervalDays: 3,
  minEase: 1.3,
  lapseIntervalFactor: 0.5,
};

export const STANDARD_CONFIG: SchedulerConfig = {
  // 25s x2 -> 1m -> 5m -> 20m -> 1h -> 4h -> 1d -> 2d, graduating at 4d.
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
  learningBurstSteps: 2,
  relearningStepsMin: [10],
  graduatingIntervalDays: 4,
  easyIntervalDays: 6,
  minEase: 1.3,
  lapseIntervalFactor: 0.5,
};

export const AGGRESSIVE_CONFIG: SchedulerConfig = {
  // 25s x5 -> 15m -> 30m -> 45m -> 2h -> 6h -> 1d -> 2d -> 3d, graduating
  // at 7d. The original ladder — deliberately thorough: the very first
  // config this app shipped with graduated after 1 day and could reach 3
  // days after a single post-graduation pass, which read as the app
  // rushing a freshly-learned word out of daily rotation.
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
  learningBurstSteps: 5,
  relearningStepsMin: [10],
  graduatingIntervalDays: 7,
  easyIntervalDays: 10,
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
