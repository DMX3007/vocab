import type { AlgoId } from '@vocabflow/core';

export type PlanId = 'free' | 'premium';

export interface PlanLimits {
  /** null = unlimited */
  maxWords: number | null;
  autoTranslatePerDay: number | null;
  voiceReviewsPerDay: number | null;
  maxDevices: number | null;
  algos: ReadonlyArray<AlgoId>;
  voiceProvider: 'webspeech' | 'whisper';
}

/**
 * Entitlements as data. Changing monetization = changing this object
 * (later: a DB table / remote config), never touching feature code.
 *
 * At launch the ONLY dimension that's actually enforced is maxWords — the
 * extension doesn't rate-limit translate/voice reviews, cap devices, or
 * restrict which algorithm you pick, so free and premium are identical on
 * every other field for now. They're kept here (rather than deleted) as
 * the seam for the next paid features to land in, one field at a time, as
 * each one actually ships client-side enforcement — not before.
 */
export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    maxWords: 500,
    autoTranslatePerDay: null,
    voiceReviewsPerDay: null,
    maxDevices: null,
    algos: ['sm2', 'leitner'],
    voiceProvider: 'webspeech',
  },
  premium: {
    maxWords: null,
    autoTranslatePerDay: null,
    voiceReviewsPerDay: null,
    maxDevices: null,
    algos: ['sm2', 'leitner'],
    voiceProvider: 'webspeech',
  },
};
