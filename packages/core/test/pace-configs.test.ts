import { describe, it, expect } from 'vitest';
import {
  createScheduler,
  initialState,
  GENTLE_CONFIG,
  STANDARD_CONFIG,
  AGGRESSIVE_CONFIG,
  DEFAULT_CONFIG,
  PACE_CONFIGS,
  type SrsState,
} from '../src/index';

// scheduler.test.ts already exercises the generic SM-2 mechanics (ease
// formula, relearning, purity) thoroughly against one config — this file
// only checks the part that actually differs per pace: the ladder shape
// each config produces.

const NOW = new Date('2026-06-10T12:00:00Z');
const sec = (n: number) => n * 1_000;
const min = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

function walkLadder(config: typeof GENTLE_CONFIG): { offsets: number[]; final: SrsState } {
  const sm2 = createScheduler('sm2', config);
  let s: SrsState = initialState('sm2', NOW, 'aggressive'); // pace here only labels the word, not the config used
  const offsets: number[] = [];
  for (let i = 0; i < config.learningStepsSec.length; i++) {
    s = sm2.schedule(s, 4, NOW);
    offsets.push(s.dueAt.getTime() - NOW.getTime());
  }
  return { offsets, final: s };
}

describe('GENTLE_CONFIG', () => {
  it('runs 25s x1, then 10m -> 2h -> 1d, then graduates at 1d', () => {
    const { offsets, final } = walkLadder(GENTLE_CONFIG);
    expect(offsets).toEqual([sec(25), min(10), hours(2), days(1), days(1)]);
    expect(final.phase).toBe('review');
    expect(final.intervalDays).toBe(1);
  });

  it("grade 5 (\"easy\") can skip ahead right after the single mandatory rep", () => {
    const sm2 = createScheduler('sm2', GENTLE_CONFIG);
    let s = initialState('sm2', NOW, 'aggressive');
    s = sm2.schedule(s, 4, NOW); // clear the one-step burst
    expect(s.stepIndex).toBe(GENTLE_CONFIG.learningBurstSteps);
    s = sm2.schedule(s, 5, NOW);
    expect(s.phase).toBe('review');
    expect(s.intervalDays).toBe(GENTLE_CONFIG.graduatingIntervalDays);
  });
});

describe('STANDARD_CONFIG', () => {
  it('runs 25s x2, then 1m -> 5m -> 20m -> 1h -> 4h -> 1d -> 2d, then graduates at 1d', () => {
    const { offsets, final } = walkLadder(STANDARD_CONFIG);
    expect(offsets).toEqual([
      sec(25), sec(25), min(1), min(5), min(20), hours(1), hours(4), days(1), days(2), days(1),
    ]);
    expect(final.phase).toBe('review');
    expect(final.intervalDays).toBe(1);
  });
});

describe('AGGRESSIVE_CONFIG', () => {
  it('is unchanged from before pace existed (same values as the old DEFAULT_CONFIG)', () => {
    expect(AGGRESSIVE_CONFIG).toEqual(DEFAULT_CONFIG);
    const { offsets, final } = walkLadder(AGGRESSIVE_CONFIG);
    expect(offsets).toEqual([
      sec(25), sec(25), sec(25), sec(25), sec(25),
      min(15), min(30), min(45), hours(2), hours(6), days(1), days(2), days(3), days(1),
    ]);
    expect(final.intervalDays).toBe(1);
  });
});

describe('PACE_CONFIGS', () => {
  it('maps every pace to its matching config', () => {
    expect(PACE_CONFIGS.gentle).toBe(GENTLE_CONFIG);
    expect(PACE_CONFIGS.standard).toBe(STANDARD_CONFIG);
    expect(PACE_CONFIGS.aggressive).toBe(AGGRESSIVE_CONFIG);
  });

  it('escalates in strictly increasing thoroughness: gentle has the fewest steps, aggressive the most', () => {
    expect(GENTLE_CONFIG.learningStepsSec.length).toBeLessThan(STANDARD_CONFIG.learningStepsSec.length);
    expect(STANDARD_CONFIG.learningStepsSec.length).toBeLessThan(AGGRESSIVE_CONFIG.learningStepsSec.length);
  });

  it('graduates every pace at the same "curve of remembering" starting point (1 day)', () => {
    // Paces differ in how much same-day drilling a word gets before the
    // app trusts it with real spaced review — not in the size of that
    // first spaced gap. Every mainstream SRS starts real review ~1 day
    // out regardless of how thorough the learning phase was; multiplicative
    // ease growth (scheduleReview) is what builds the curve from there.
    for (const config of [GENTLE_CONFIG, STANDARD_CONFIG, AGGRESSIVE_CONFIG]) {
      expect(config.graduatingIntervalDays).toBe(1);
    }
  });
});
