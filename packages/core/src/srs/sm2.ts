import {
  addDays,
  addMinutes,
  addSeconds,
  isFailedGrade,
  type Grade,
  type SchedulerConfig,
  type SrsAlgorithm,
  type SrsState,
} from './types.js';

const isFailed = isFailedGrade;

// A review interval can never be shorter than one day.
const MINIMUM_REVIEW_INTERVAL_DAYS = 1;

// ── Ease factor ──────────────────────────────────────────────────
// "Ease" is the multiplier for the next interval: after a successful
// review, newInterval ≈ oldInterval × ease. Higher ease = the word is
// easy for the user = intervals grow faster.
//
// This table is the classic SM-2 formula
//   EF' = EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02))
// pre-computed for every possible grade, because a table is easier
// to read than the formula:
const EASE_CHANGE_BY_GRADE: Record<Grade, number> = {
  0: -0.8, // total blackout — ease drops a lot
  1: -0.54,
  2: -0.32,
  3: -0.14, // passed, but it was hard — ease drops a little
  4: 0.0, //  normal pass — ease unchanged
  5: +0.1, // perfect — ease grows
};

function updateEase(currentEase: number, grade: Grade, minimumEase: number): number {
  const newEase = currentEase + EASE_CHANGE_BY_GRADE[grade];
  return Math.max(minimumEase, newEase); // never below the floor (1.3)
}

// ── The algorithm ────────────────────────────────────────────────
export function createSm2(config: SchedulerConfig): SrsAlgorithm {
  const learningSteps = config.learningStepsSec; // e.g. [25,25,25,25,25,60,120,300,600] seconds
  const relearningSteps = config.relearningStepsMin; // e.g. [10] minutes

  // A broken config must fail loudly at startup,
  // not silently mis-schedule reviews later.
  if (learningSteps.length === 0) throw new Error('learningStepsSec must not be empty');
  if (relearningSteps.length === 0) throw new Error('relearningStepsMin must not be empty');

  const secondsAtStep = (steps: number[], index: number): number => {
    const seconds = steps[index];
    if (seconds === undefined) throw new Error(`No step at index ${index}`);
    return seconds;
  };

  const minutesAtStep = (steps: number[], index: number): number => {
    const minutes = steps[index];
    if (minutes === undefined) throw new Error(`No step at index ${index}`);
    return minutes;
  };

  /** The card leaves the "minutes" world and gets its next review in N days. */
  const enterReviewPhase = (state: SrsState, intervalDays: number, now: Date): SrsState => ({
    ...state,
    phase: 'review',
    stepIndex: 0,
    intervalDays,
    dueAt: addDays(now, intervalDays),
    repetitions: state.repetitions + 1,
  });

  /** New word: a mandatory rapid-fire burst, then escalating pauses, then
   *  graduate. Every pass — however confident or fast — advances exactly
   *  one step; there's no shortcut past the ladder for an easy/instant
   *  answer, so the interval a word ends up on always matches the ladder
   *  shown in the Plan tab, not how easy answering felt. Failing at any
   *  point resets all the way back to the start of the burst: the word
   *  gets drilled as many times as it takes. */
  const scheduleLearning = (state: SrsState, grade: Grade, now: Date): SrsState => {
    if (isFailed(grade)) {
      return {
        ...state,
        stepIndex: 0,
        lapses: state.lapses + 1,
        dueAt: addSeconds(now, secondsAtStep(learningSteps, 0)),
      };
    }

    const nextStepIndex = state.stepIndex + 1;
    const finishedAllSteps = nextStepIndex >= learningSteps.length;
    if (finishedAllSteps) {
      return enterReviewPhase(state, config.graduatingIntervalDays, now);
    }

    return {
      ...state,
      stepIndex: nextStepIndex,
      dueAt: addSeconds(now, secondsAtStep(learningSteps, nextStepIndex)),
    };
  };

  /** Forgotten word: short re-learning steps, then back to review. */
  const scheduleRelearning = (state: SrsState, grade: Grade, now: Date): SrsState => {
    if (isFailed(grade)) {
      return {
        ...state,
        stepIndex: 0,
        lapses: state.lapses + 1,
        dueAt: addMinutes(now, minutesAtStep(relearningSteps, 0)),
      };
    }

    const nextStepIndex = state.stepIndex + 1;
    const finishedAllSteps = nextStepIndex >= relearningSteps.length;
    if (finishedAllSteps) {
      // intervalDays was already shortened when the lapse happened (see startRelearning)
      const intervalDays = Math.max(MINIMUM_REVIEW_INTERVAL_DAYS, state.intervalDays);
      return enterReviewPhase(state, intervalDays, now);
    }

    return {
      ...state,
      stepIndex: nextStepIndex,
      dueAt: addMinutes(now, minutesAtStep(relearningSteps, nextStepIndex)),
    };
  };

  /** The user forgot a word they knew: count a lapse, shorten the interval, drill again. */
  const startRelearning = (state: SrsState, grade: Grade, now: Date): SrsState => {
    const shortenedInterval = Math.max(
      MINIMUM_REVIEW_INTERVAL_DAYS,
      Math.round(state.intervalDays * config.lapseIntervalFactor), // e.g. half of what it was
    );
    return {
      ...state,
      phase: 'relearning',
      stepIndex: 0,
      lapses: state.lapses + 1,
      easeFactor: updateEase(state.easeFactor, grade, config.minEase),
      intervalDays: shortenedInterval,
      dueAt: addMinutes(now, minutesAtStep(relearningSteps, 0)),
    };
  };

  /** Graduated word: classic SM-2 — every success makes the interval longer. */
  const scheduleReview = (state: SrsState, grade: Grade, now: Date): SrsState => {
    if (isFailed(grade)) {
      return startRelearning(state, grade, now);
    }

    const easeFactor = updateEase(state.easeFactor, grade, config.minEase);
    const grownInterval = Math.round(state.intervalDays * easeFactor);
    // Guarantee growth even when ease is at its floor: at least +1 day.
    const intervalDays = Math.max(state.intervalDays + 1, grownInterval);

    return {
      ...state,
      easeFactor,
      intervalDays,
      dueAt: addDays(now, intervalDays),
      repetitions: state.repetitions + 1,
    };
  };

  const schedule = (state: SrsState, grade: Grade, now: Date): SrsState => {
    switch (state.phase) {
      case 'learning':
        return scheduleLearning(state, grade, now);
      case 'relearning':
        return scheduleRelearning(state, grade, now);
      case 'review':
        return scheduleReview(state, grade, now);
    }
  };

  return { id: 'sm2', schedule };
}
