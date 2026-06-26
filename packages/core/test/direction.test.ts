import { describe, it, expect } from 'vitest';
import { pickDirection, type DirectionStats } from '../src/index';

// deterministic rng for tests
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

describe('pickDirection', () => {
  it('with no history, splits ~50/50 by rng threshold', () => {
    const stats: DirectionStats = {
      forward: { shown: 0, failed: 0 },
      reverse: { shown: 0, failed: 0 },
    };
    expect(pickDirection(stats, seq(0.2))).toBe('forward');
    expect(pickDirection(stats, seq(0.8))).toBe('reverse');
  });

  it('weights toward the direction the user fails more', () => {
    const stats: DirectionStats = {
      forward: { shown: 10, failed: 1 }, // 10% fail
      reverse: { shown: 10, failed: 6 }, // 60% fail -> should appear more often
    };
    let reverseCount = 0;
    const n = 10_000;
    let x = 0.123;
    const rng = () => {
      // simple deterministic LCG-ish for the test
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
    for (let i = 0; i < n; i++) {
      if (pickDirection(stats, rng) === 'reverse') reverseCount++;
    }
    expect(reverseCount / n).toBeGreaterThan(0.55);
    expect(reverseCount / n).toBeLessThan(0.85); // but never deterministic
  });

  it('never starves a direction completely (both stay reachable)', () => {
    const stats: DirectionStats = {
      forward: { shown: 50, failed: 0 },
      reverse: { shown: 50, failed: 50 },
    };
    // even in the extreme case, low rng values still yield forward
    expect(pickDirection(stats, seq(0.01))).toBe('forward');
    expect(pickDirection(stats, seq(0.99))).toBe('reverse');
  });
});
