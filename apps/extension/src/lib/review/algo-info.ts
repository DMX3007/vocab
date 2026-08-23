import { DEFAULT_CONFIG, DEFAULT_LEITNER_CONFIG, type AlgoId } from '@vocably/core';

// Pulls the interval chain straight from the live scheduler config, so this
// never drifts out of sync with whatever the ladder actually does — the
// exact bug that prompted this file (the old description was a hand-typed
// paragraph that stayed put through several ladder redesigns).

export interface AlgoInfo {
  algo: AlgoId;
  /** the experienced wait, in seconds, after each successive pass — for
   *  sm2 this is learningStepsSec[1..] plus the graduating interval; for
   *  leitner it's just the box intervals converted to seconds */
  chainSeconds: number[];
  /** whether the chain keeps growing past its last entry (sm2, via ease) or
   *  is a hard ceiling that just repeats (leitner) */
  growsPastChain: boolean;
}

export function getAlgoInfo(algo: AlgoId): AlgoInfo {
  if (algo === 'leitner') {
    return {
      algo,
      chainSeconds: DEFAULT_LEITNER_CONFIG.boxIntervalDays.map((d) => d * 86_400),
      growsPastChain: false,
    };
  }
  const steps = DEFAULT_CONFIG.learningStepsSec;
  return {
    algo,
    // steps[0] is only ever used as the post-lapse retry delay (see
    // sm2.ts's scheduleLearning) — a pass at step i waits steps[i+1], so
    // the sequence actually experienced on a clean run is steps[1..].
    chainSeconds: [...steps.slice(1), DEFAULT_CONFIG.graduatingIntervalDays * 86_400],
    growsPastChain: true,
  };
}

export type DurationUnit = 'sec' | 'min' | 'hour' | 'day';

/** Picks the cleanest whole-number unit for a duration — every value in
 *  both configs above is a clean multiple of one unit, so this never has
 *  to deal with a remainder. */
export function toDurationUnit(totalSeconds: number): { value: number; unit: DurationUnit } {
  if (totalSeconds % 86_400 === 0) return { value: totalSeconds / 86_400, unit: 'day' };
  if (totalSeconds % 3_600 === 0) return { value: totalSeconds / 3_600, unit: 'hour' };
  if (totalSeconds % 60 === 0) return { value: totalSeconds / 60, unit: 'min' };
  return { value: totalSeconds, unit: 'sec' };
}

const UNIT_SUFFIX: Record<DurationUnit, string> = { sec: 's', min: 'm', hour: 'h', day: 'd' };

function formatDuration(totalSeconds: number): string {
  const { value, unit } = toDurationUnit(totalSeconds);
  return `${value}${UNIT_SUFFIX[unit]}`;
}

/** "25s x5 -> 15m -> 30m -> ... -> 7d" — collapses consecutive repeats
 *  (the seconds-burst) into a "xN" rather than listing them one by one. */
export function formatChain(chainSeconds: number[]): string {
  const collapsed: string[] = [];
  for (const seconds of chainSeconds) {
    const formatted = formatDuration(seconds);
    const last = collapsed[collapsed.length - 1];
    if (last && (last === formatted || last.startsWith(`${formatted} x`))) {
      const count = last.includes(' x') ? Number(last.split(' x')[1]) + 1 : 2;
      collapsed[collapsed.length - 1] = `${formatted} x${count}`;
    } else {
      collapsed.push(formatted);
    }
  }
  return collapsed.join(' → ');
}
