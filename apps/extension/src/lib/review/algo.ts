import type { AlgoId } from '@vocably/core';

// Shared display names for the two algorithms, so the tray selector, the
// Library badges/filter, and the Plan tab all say the same thing.
export const ALGO_LABELS: Record<AlgoId, string> = {
  sm2: 'SM-2',
  leitner: 'Leitner',
};

export const ALGO_OPTIONS: ReadonlyArray<{ value: AlgoId; label: string }> = [
  { value: 'sm2', label: 'SM-2 (SuperMemo)' },
  { value: 'leitner', label: 'Leitner (5 boxes)' },
];
