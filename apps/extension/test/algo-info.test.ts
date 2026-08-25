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
  it('sm2: defaults to the aggressive pace when none is given', () => {
    const info = getAlgoInfo('sm2');
    expect(info.growsPastChain).toBe(true);
    expect(formatChain(info.chainSeconds)).toBe(
      '25s x5 → 15m → 30m → 45m → 2h → 6h → 1d → 2d → 3d → 1d',
    );
  });

  it('sm2: describes whichever pace is passed, not a fixed config', () => {
    // gentle's last learning step (1d) and its graduating interval (also
    // 1d, same "curve of remembering" starting point every pace shares)
    // collapse into "1d x2".
    expect(formatChain(getAlgoInfo('sm2', 'gentle').chainSeconds)).toBe('25s → 10m → 2h → 1d x2');
    expect(formatChain(getAlgoInfo('sm2', 'standard').chainSeconds)).toBe(
      '25s x2 → 1m → 5m → 20m → 1h → 4h → 1d → 2d → 1d',
    );
    expect(formatChain(getAlgoInfo('sm2', 'aggressive').chainSeconds)).toBe(
      '25s x5 → 15m → 30m → 45m → 2h → 6h → 1d → 2d → 3d → 1d',
    );
  });

  it('leitner: a fixed box ladder with no growth past the last box', () => {
    const info = getAlgoInfo('leitner');
    expect(info.growsPastChain).toBe(false);
    // the leading "1d x2" is the same-day-ish first box (see
    // DEFAULT_LEITNER_CONFIG) plus its duplicate fail-retry value
    expect(formatChain(info.chainSeconds)).toBe('1d x2 → 2d → 4d → 8d → 16d');
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
