import { describe, it, expect } from 'vitest';
import { getAlgoInfo, formatChain, toDurationUnit } from '../src/lib/review/algo-info';

describe('toDurationUnit', () => {
  it('picks the cleanest whole unit', () => {
    expect(toDurationUnit(25)).toEqual({ value: 25, unit: 'sec' });
    expect(toDurationUnit(900)).toEqual({ value: 15, unit: 'min' });
    expect(toDurationUnit(7_200)).toEqual({ value: 2, unit: 'hour' });
    expect(toDurationUnit(86_400)).toEqual({ value: 1, unit: 'day' });
  });
});

describe('getAlgoInfo', () => {
  it('sm2: the experienced chain (post-burst indexing) grows past its last entry', () => {
    const info = getAlgoInfo('sm2');
    expect(info.growsPastChain).toBe(true);
    expect(formatChain(info.chainSeconds)).toBe(
      '25s x5 → 15m → 30m → 45m → 2h → 6h → 1d → 2d → 3d → 7d',
    );
  });

  it('leitner: a fixed box ladder with no growth past the last box', () => {
    const info = getAlgoInfo('leitner');
    expect(info.growsPastChain).toBe(false);
    expect(formatChain(info.chainSeconds)).toBe('1d → 2d → 4d → 8d → 16d');
  });
});

describe('formatChain', () => {
  it('collapses consecutive identical durations into "xN"', () => {
    expect(formatChain([25, 25, 25])).toBe('25s x3');
  });

  it('leaves distinct durations un-collapsed', () => {
    expect(formatChain([60, 120, 180])).toBe('1m → 2m → 3m');
  });
});
