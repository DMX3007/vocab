import { describe, it, expect } from 'vitest';
import {
  createScheduler,
  initialState,
  DEFAULT_CONFIG,
  type SrsState,
} from '../src/index';

const NOW = new Date('2026-06-10T12:00:00Z');
const min = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

const sm2 = createScheduler('sm2', DEFAULT_CONFIG);

describe('initial state', () => {
  it('starts in learning phase, step 0, due immediately', () => {
    const s = initialState('sm2', NOW);
    expect(s.phase).toBe('learning');
    expect(s.stepIndex).toBe(0);
    expect(s.dueAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(s.repetitions).toBe(0);
    expect(s.lapses).toBe(0);
  });
});

describe('learning phase (mandatory burst, then escalating pauses)', () => {
  it('correct answer advances one step; the first wait is 15 minutes', () => {
    const s0 = initialState('sm2', NOW);
    // default ladder: 2-step mandatory burst (both 15m), then 30m/45m/2h/6h/1d/2d/3d
    const s1 = sm2.schedule(s0, 4, NOW);
    expect(s1.phase).toBe('learning');
    expect(s1.stepIndex).toBe(1);
    expect(s1.dueAt.getTime()).toBe(NOW.getTime() + min(15));
  });

  it('grade 5 ("easy") during the mandatory burst does NOT skip ahead', () => {
    const s0 = initialState('sm2', NOW);
    const s1 = sm2.schedule(s0, 5, NOW); // still inside the burst (step 0 < burstSteps)
    expect(s1.phase).toBe('learning'); // no early graduation
    expect(s1.stepIndex).toBe(1);
    expect(s1.dueAt.getTime()).toBe(NOW.getTime() + min(15));
  });

  it('grade 5 ("easy") past the mandatory burst graduates immediately with the easy interval', () => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningBurstSteps; i++) s = sm2.schedule(s, 4, NOW); // clear the burst
    expect(s.stepIndex).toBe(DEFAULT_CONFIG.learningBurstSteps);

    s = sm2.schedule(s, 5, NOW); // now past the burst -> easy can skip
    expect(s.phase).toBe('review');
    expect(s.intervalDays).toBe(DEFAULT_CONFIG.easyIntervalDays);
  });

  it('the ladder escalates 15m -> 30m -> 45m -> 2h -> 6h -> 1d -> 2d -> 3d, then graduates at 7d', () => {
    let s: SrsState = initialState('sm2', NOW);

    const offsets: number[] = [];
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
      s = sm2.schedule(s, 4, NOW);
      offsets.push(s.dueAt.getTime() - NOW.getTime());
    }
    expect(offsets).toEqual([
      min(15), min(30), min(45), hours(2), hours(6), days(1), days(2), days(3), days(7),
    ]); // the last (9th) pass graduates
    expect(s.phase).toBe('review');
    expect(s.intervalDays).toBe(DEFAULT_CONFIG.graduatingIntervalDays);
    expect(s.repetitions).toBe(1);
  });

  it('walking the whole ladder (burst + escalation) with steady passes graduates with the graduating interval', () => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
      s = sm2.schedule(s, 4, NOW);
    }
    expect(s.phase).toBe('review');
    expect(s.intervalDays).toBe(DEFAULT_CONFIG.graduatingIntervalDays);
    expect(s.dueAt.getTime()).toBe(NOW.getTime() + days(7));
  });

  it('failed answer resets to the start of the burst, no matter how far along it was', () => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < 7; i++) s = sm2.schedule(s, 4, NOW); // deep into the escalation phase
    expect(s.stepIndex).toBeGreaterThan(DEFAULT_CONFIG.learningBurstSteps);

    s = sm2.schedule(s, 1, NOW); // fail
    expect(s.phase).toBe('learning');
    expect(s.stepIndex).toBe(0);
    expect(s.dueAt.getTime()).toBe(NOW.getTime() + min(15));
  });

  it('a miss during learning counts as a lapse, even on the very first attempt', () => {
    // stepIndex resets to 0 on any miss, which alone would make "just
    // failed" indistinguishable from "never attempted" — lapses is what
    // tells them apart (used by the fast burst-reappear trigger).
    const s0 = initialState('sm2', NOW);
    const s1 = sm2.schedule(s0, 1, NOW); // fail on the first-ever attempt
    expect(s1.stepIndex).toBe(0);
    expect(s1.lapses).toBe(1);
  });

  it('a miss during relearning also counts as a lapse', () => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) s = sm2.schedule(s, 4, NOW); // graduate
    s = sm2.schedule(s, 0, new Date(s.dueAt)); // lapse -> relearning (1st lapse)
    expect(s.lapses).toBe(1);
    s = sm2.schedule(s, 1, new Date(s.dueAt)); // fail again, still in relearning
    expect(s.phase).toBe('relearning');
    expect(s.lapses).toBe(2);
  });
});

describe('review phase (SM-2, intervals grow when remembered)', () => {
  const graduated = (): SrsState => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
      s = sm2.schedule(s, 4, NOW); // walk the full ladder, interval = 1d, EF = 2.5
    }
    return s;
  };

  it('intervals grow monotonically on repeated success', () => {
    let s = graduated();
    const i1 = s.intervalDays;
    s = sm2.schedule(s, 4, new Date(s.dueAt));
    const i2 = s.intervalDays;
    s = sm2.schedule(s, 4, new Date(s.dueAt));
    const i3 = s.intervalDays;
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it('ease factor never drops below 1.3', () => {
    let s = graduated();
    for (let i = 0; i < 20; i++) {
      s = sm2.schedule(s, 3, new Date(s.dueAt)); // hard-ish passes lower EF
    }
    expect(s.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('failure sends the card to relearning, counts a lapse, reduces ease', () => {
    const before = graduated();
    const after = sm2.schedule(before, 1, new Date(before.dueAt));
    expect(after.phase).toBe('relearning');
    expect(after.lapses).toBe(1);
    expect(after.easeFactor).toBeLessThan(before.easeFactor);
    // due on the first relearning step (10 min), not in days
    expect(after.dueAt.getTime() - before.dueAt.getTime()).toBe(min(10));
  });
});

describe('relearning phase', () => {
  it('passing relearning returns to review with a reduced interval (min 1 day)', () => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) s = sm2.schedule(s, 4, NOW); // graduate, interval 1d
    for (let i = 0; i < 3; i++) s = sm2.schedule(s, 4, new Date(s.dueAt));
    const bigInterval = s.intervalDays;
    s = sm2.schedule(s, 0, new Date(s.dueAt)); // lapse -> relearning
    s = sm2.schedule(s, 4, new Date(s.dueAt)); // pass relearning
    expect(s.phase).toBe('review');
    expect(s.intervalDays).toBeLessThan(bigInterval);
    expect(s.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('failing relearning keeps it on step 0', () => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) s = sm2.schedule(s, 4, NOW); // graduate
    s = sm2.schedule(s, 0, new Date(s.dueAt)); // -> relearning
    const again = sm2.schedule(s, 1, new Date(s.dueAt));
    expect(again.phase).toBe('relearning');
    expect(again.stepIndex).toBe(0);
  });
});

describe('ease table matches the published SM-2 formula', () => {
  // EF' = EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02)), floored at minEase.
  // The implementation uses a pre-computed table; this test pins the table
  // to the original formula so a typo in the table cannot pass unnoticed.
  const formula = (ease: number, q: number) =>
    Math.max(DEFAULT_CONFIG.minEase, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  const graduated = (): SrsState => {
    let s: SrsState = initialState('sm2', NOW);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
      s = sm2.schedule(s, 4, NOW); // review phase, ease = 2.5 (learning-phase passes don't touch ease)
    }
    return s;
  };

  it.each([0, 1, 2, 3, 4, 5] as const)(
    'grade %i updates ease exactly as the formula does',
    (grade) => {
      const before = graduated();
      const after = sm2.schedule(before, grade, new Date(before.dueAt));
      // grades 0-2 go through the lapse path, 3-5 through the pass path —
      // the ease update must follow the same formula on both
      expect(after.easeFactor).toBeCloseTo(formula(before.easeFactor, grade), 10);
    },
  );
});

describe('scheduler purity', () => {
  it('schedule() does not mutate the input state', () => {
    const s0 = initialState('sm2', NOW);
    const frozen = JSON.stringify(s0);
    sm2.schedule(s0, 4, NOW);
    expect(JSON.stringify(s0)).toBe(frozen);
  });
});
