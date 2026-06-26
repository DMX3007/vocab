import { describe, it, expect } from 'vitest';
import {
  createScheduler,
  initialState,
  DEFAULT_CONFIG,
  type SrsState,
} from '../src/index';

const NOW = new Date('2026-06-10T12:00:00Z');
const min = (n: number) => n * 60_000;
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

describe('learning phase (Anki-like steps: often at the beginning)', () => {
  it('correct answer advances to next step: 1min -> 10min', () => {
    const s0 = initialState('sm2', NOW);
    // default steps are [1, 10, 60] minutes
    const s1 = sm2.schedule(s0, 4, NOW);
    expect(s1.phase).toBe('learning');
    expect(s1.stepIndex).toBe(1);
    expect(s1.dueAt.getTime()).toBe(NOW.getTime() + min(10));
  });

  it('walks all steps then graduates to review with graduating interval (1 day)', () => {
    let s: SrsState = initialState('sm2', NOW);
    s = sm2.schedule(s, 4, NOW); // -> step 1 (10 min)
    s = sm2.schedule(s, 4, NOW); // -> step 2 (60 min)
    expect(s.stepIndex).toBe(2);
    expect(s.dueAt.getTime()).toBe(NOW.getTime() + min(60));

    s = sm2.schedule(s, 4, NOW); // graduates
    expect(s.phase).toBe('review');
    expect(s.intervalDays).toBe(DEFAULT_CONFIG.graduatingIntervalDays);
    expect(s.dueAt.getTime()).toBe(NOW.getTime() + days(1));
    expect(s.repetitions).toBe(1);
  });

  it('failed answer resets to step 0 (frequent repetition until learned)', () => {
    const s0 = initialState('sm2', NOW);
    const s1 = sm2.schedule(s0, 4, NOW); // step 1
    const s2 = sm2.schedule(s1, 1, NOW); // fail
    expect(s2.phase).toBe('learning');
    expect(s2.stepIndex).toBe(0);
    expect(s2.dueAt.getTime()).toBe(NOW.getTime() + min(1));
  });

  it('grade 5 (easy) graduates immediately with the easy interval', () => {
    const s0 = initialState('sm2', NOW);
    const s1 = sm2.schedule(s0, 5, NOW);
    expect(s1.phase).toBe('review');
    expect(s1.intervalDays).toBe(DEFAULT_CONFIG.easyIntervalDays);
  });
});

describe('review phase (SM-2, intervals grow when remembered)', () => {
  const graduated = (): SrsState => {
    let s: SrsState = initialState('sm2', NOW);
    s = sm2.schedule(s, 4, NOW);
    s = sm2.schedule(s, 4, NOW);
    s = sm2.schedule(s, 4, NOW); // review, interval = 1d, EF = 2.5
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
    s = sm2.schedule(s, 5, NOW); // graduate easy, interval 4d
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
    s = sm2.schedule(s, 5, NOW);
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
    s = sm2.schedule(s, 5, NOW); // straight to review phase, ease = 2.5
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
