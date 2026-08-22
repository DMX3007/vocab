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

export const DEFAULT_CONFIG: SchedulerConfig = {
  // 5 quick reps ~25s apart (mandatory), then escalating pauses:
  // 1m -> 2m -> 5m -> 10m, then graduate to day/month-scale review.
  learningStepsSec: [25, 25, 25, 25, 25, 60, 120, 300, 600],
  learningBurstSteps: 5,
  relearningStepsMin: [10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
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
