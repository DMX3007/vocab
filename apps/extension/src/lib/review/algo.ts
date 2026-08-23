import type { AlgoId, Pace } from '@vocably/core';
import type { TranslationKey } from '../i18n';

// Shared display names for the two algorithms, so the tray selector, the
// Library badges/filter, and the Plan tab all say the same thing.
export const ALGO_LABELS: Record<AlgoId, string> = {
  sm2: 'SM-2',
  leitner: 'Leitner',
};

export const ALGO_OPTIONS: ReadonlyArray<{ value: AlgoId; label: string }> = [
  { value: 'sm2', label: 'SM-2 (SuperMemo)' },
  { value: 'leitner', label: 'Leitner (6 boxes)' },
];

export const PACE_KEY: Record<Pace, TranslationKey> = {
  gentle: 'pace.gentle',
  standard: 'pace.standard',
  aggressive: 'pace.aggressive',
};

/** A single combined choice for the "new words use" / "move to" pickers.
 *  Leitner has no pace of its own (a single fixed ladder is the whole
 *  point — see algo-info.ts), so it's one option, not three. */
export type AlgoChoice = 'sm2-gentle' | 'sm2-standard' | 'sm2-aggressive' | 'leitner';

export function algoChoiceOf(algo: AlgoId, pace: Pace): AlgoChoice {
  return algo === 'leitner' ? 'leitner' : (`sm2-${pace}` as AlgoChoice);
}

export function parseAlgoChoice(choice: AlgoChoice): { algo: AlgoId; pace: Pace } {
  if (choice === 'leitner') return { algo: 'leitner', pace: 'aggressive' };
  return { algo: 'sm2', pace: choice.slice(4) as Pace }; // 'sm2-gentle' -> 'gentle'
}

/** Builds the option list for the combined algo+pace `<select>`s (the
 *  Review tab's "new words use" tray and Library's "move to" bar). Takes
 *  `t` so pace names are localized while the algorithm names (proper/
 *  technical terms, not really translatable) stay as-is. */
export function algoChoiceOptions(
  t: (key: TranslationKey) => string,
): ReadonlyArray<{ value: AlgoChoice; label: string }> {
  return [
    { value: 'sm2-gentle', label: `SM-2 · ${t(PACE_KEY.gentle)}` },
    { value: 'sm2-standard', label: `SM-2 · ${t(PACE_KEY.standard)}` },
    { value: 'sm2-aggressive', label: `SM-2 · ${t(PACE_KEY.aggressive)}` },
    { value: 'leitner', label: 'Leitner (6 boxes)' },
  ];
}

/** The per-word badge (Library cards, Review tab rows): "SM-2 · Gentle" or
 *  just "Leitner" — pace is meaningless for Leitner so it's left off. */
export function algoBadgeLabel(algo: AlgoId, pace: Pace, t: (key: TranslationKey) => string): string {
  return algo === 'leitner' ? ALGO_LABELS.leitner : `${ALGO_LABELS.sm2} · ${t(PACE_KEY[pace])}`;
}
