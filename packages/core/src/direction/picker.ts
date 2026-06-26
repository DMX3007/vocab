export type Direction = 'forward' | 'reverse'; // forward: show the term, ask for the translation

export interface DirectionCounters {
  shown: number;
  failed: number;
}

export interface DirectionStats {
  forward: DirectionCounters;
  reverse: DirectionCounters;
}

// ── Product decisions ────────────────────────────────────────────
// Neither direction may ever fall below a 15% chance. Otherwise the
// direction the user is good at would stop appearing at all — and an
// unpracticed skill decays.
const MINIMUM_CHANCE = 0.15;
const MAXIMUM_CHANCE = 1 - MINIMUM_CHANCE;

// "Imaginary" reviews added to the counters (Laplace smoothing):
// we pretend every direction has already been shown twice — failed once,
// passed once. This way a single unlucky answer on a fresh word cannot
// swing the probability to an extreme.
const IMAGINARY_FAILS = 1;
const IMAGINARY_SHOWN = 2;

/** How often the user fails this direction, softened for small samples. */
function smoothedFailRate(counters: DirectionCounters): number {
  return (counters.failed + IMAGINARY_FAILS) / (counters.shown + IMAGINARY_SHOWN);
}

/** Squeezes a value into the [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Picks the direction for the next review of a word.
 *
 * The idea: the direction the user fails MORE should appear MORE often,
 * because that is the one that needs practice. With no history the split
 * is 50/50.
 *
 * rng is a parameter (instead of calling Math.random inside) so that
 * tests can pass a predictable sequence and assert exact outcomes.
 */
export function pickDirection(
  stats: DirectionStats,
  rng: () => number = Math.random,
): Direction {
  const forwardFailRate = smoothedFailRate(stats.forward);
  const reverseFailRate = smoothedFailRate(stats.reverse);

  // Reverse gets a share of attention equal to its share of the failures.
  // Example: forward fails 10% of the time, reverse 60% →
  // reverse gets 0.6 / (0.1 + 0.6) ≈ 86%, clamped down to 85%.
  const reverseShareOfFailures = reverseFailRate / (forwardFailRate + reverseFailRate);
  const chanceOfReverse = clamp(reverseShareOfFailures, MINIMUM_CHANCE, MAXIMUM_CHANCE);
  const chanceOfForward = 1 - chanceOfReverse;

  // rng() returns a number in [0, 1). Low values land in the forward
  // bucket, high values in the reverse bucket.
  return rng() < chanceOfForward ? 'forward' : 'reverse';
}
