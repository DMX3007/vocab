import { describe, it, expect } from 'vitest';
import { createScheduler, initialState, type SrsState } from '../src/index';

const NOW = new Date('2026-06-10T12:00:00Z');
const days = (n: number) => n * 86_400_000;

const leitner = createScheduler('leitner');

describe('initial state', () => {
  it('starts in box 1 (stepIndex 0), due immediately', () => {
    const s = initialState('leitner', NOW);
    expect(s.stepIndex).toBe(0);
    expect(s.dueAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});

describe('promotion on a correct answer', () => {
  it('moves up one box and grows the interval each time: 1d -> 2d -> 4d -> 8d -> 16d', () => {
    // A brand-new word starts already "in" box 1 (see initial state above),
    // so its first correct answer is what promotes it to box 2 — a
    // same-day-ish 1-day check-in, not an immediate 2-day gap of trust it
    // hasn't earned yet (see DEFAULT_LEITNER_CONFIG's leading duplicate).
    let s: SrsState = initialState('leitner', NOW);
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = leitner.schedule(s, 4, new Date(s.dueAt));
      intervals.push(s.intervalDays);
    }
    expect(intervals).toEqual([1, 2, 4, 8, 16]);
  });

  it('stays in the last box once it is fully promoted (no box 7)', () => {
    let s: SrsState = initialState('leitner', NOW);
    for (let i = 0; i < 10; i++) s = leitner.schedule(s, 4, new Date(s.dueAt));
    expect(s.intervalDays).toBe(16);
    const again = leitner.schedule(s, 4, new Date(s.dueAt));
    expect(again.intervalDays).toBe(16);
  });

  it('counts repetitions on every promotion', () => {
    let s: SrsState = initialState('leitner', NOW);
    s = leitner.schedule(s, 5, NOW);
    s = leitner.schedule(s, 5, new Date(s.dueAt));
    expect(s.repetitions).toBe(2);
  });

  it('sets dueAt to now + the new box interval', () => {
    const s0 = initialState('leitner', NOW);
    const s1 = leitner.schedule(s0, 4, NOW); // -> box 2, 1 day
    expect(s1.dueAt.getTime()).toBe(NOW.getTime() + days(1));
  });
});

describe('demotion on a wrong answer', () => {
  it('drops straight back to box 1 no matter how far it had climbed', () => {
    let s: SrsState = initialState('leitner', NOW);
    for (let i = 0; i < 4; i++) s = leitner.schedule(s, 4, new Date(s.dueAt)); // box 5, 8d
    expect(s.stepIndex).toBe(4);
    const failed = leitner.schedule(s, 1, new Date(s.dueAt));
    expect(failed.stepIndex).toBe(0);
    expect(failed.intervalDays).toBe(1);
  });

  it('counts a lapse', () => {
    const s0 = initialState('leitner', NOW);
    const failed = leitner.schedule(s0, 0, NOW);
    expect(failed.lapses).toBe(1);
  });
});

describe('purity', () => {
  it('schedule() does not mutate the input state', () => {
    const s0 = initialState('leitner', NOW);
    const frozen = JSON.stringify(s0);
    leitner.schedule(s0, 4, NOW);
    expect(JSON.stringify(s0)).toBe(frozen);
  });
});

describe('createScheduler("leitner") ignores the sm2 config param', () => {
  it('works with no config argument at all', () => {
    expect(() => createScheduler('leitner')).not.toThrow();
  });
});
