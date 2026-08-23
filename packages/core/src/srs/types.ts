export type Grade = 0 | 1 | 2 | 3 | 4 | 5;
export type Phase = 'learning' | 'review' | 'relearning';
export type AlgoId = 'sm2' | 'leitner'; // 'fsrs' reserved for a later loop

export interface SrsState {
  algo: AlgoId;
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

const MIN = 60;
const HOUR = 3_600;
const DAY = 86_400;

export const DEFAULT_CONFIG: SchedulerConfig = {
  // A 2-step mandatory burst (both at the 15-minute mark — see
  // learningBurstSteps below), then an escalating same-day-to-week ladder:
  // 15m -> 30m -> 45m -> 2h -> 6h -> 1d -> 2d -> 3d, graduating at 7d (from
  // which point classic SM-2 ease-based growth takes over). Deliberately
  // gentle: the old ladder graduated after 1 day and could reach 3 days
  // after a single post-graduation pass, which read as the app rushing a
  // freshly-learned word out of daily rotation.
  learningStepsSec: [
    15 * MIN, // 0: also the "just failed" retry delay
    15 * MIN, // 1
    30 * MIN, // 2
    45 * MIN, // 3
    2 * HOUR, // 4
    6 * HOUR, // 5
    1 * DAY, // 6
    2 * DAY, // 7
    3 * DAY, // 8
  ],
  learningBurstSteps: 2,
  relearningStepsMin: [10],
  graduatingIntervalDays: 7,
  easyIntervalDays: 10,
  minEase: 1.3,
  lapseIntervalFactor: 0.5,
};

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

export function initialState(algo: AlgoId, now: Date): SrsState {
  return {
    algo,
    phase: 'learning',
    stepIndex: 0,
    dueAt: now,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
  };
}
