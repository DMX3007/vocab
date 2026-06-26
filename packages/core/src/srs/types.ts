export type Grade = 0 | 1 | 2 | 3 | 4 | 5;
export type Phase = 'learning' | 'review' | 'relearning';
export type AlgoId = 'sm2'; // 'fsrs' | 'leitner' reserved for next loops

export interface SrsState {
  algo: AlgoId;
  phase: Phase;
  /** index into learning/relearning steps; meaningless in review phase */
  stepIndex: number;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
}

export interface SchedulerConfig {
  /** in-day repetition steps for new words, minutes (Anki-like) */
  learningStepsMin: number[];
  /** steps after a lapse, minutes */
  relearningStepsMin: number[];
  /** first review interval after graduating learning, days */
  graduatingIntervalDays: number;
  /** interval when graduating with grade 5 ("easy"), days */
  easyIntervalDays: number;
  /** floor for the ease factor */
  minEase: number;
  /** multiplier applied to the pre-lapse interval after relearning */
  lapseIntervalFactor: number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  learningStepsMin: [1, 10, 60],
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

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

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
