export type PlanId = 'free' | 'premium';

export interface PlanLimits {
  /** null = unlimited */
  maxWords: number | null;
  autoTranslatePerDay: number | null;
  voiceReviewsPerDay: number | null;
  maxDevices: number | null;
  algos: ReadonlyArray<'sm2' | 'leitner' | 'fsrs'>;
  voiceProvider: 'webspeech' | 'whisper';
}

/**
 * Entitlements as data. Changing monetization = changing this object
 * (later: a DB table / remote config), never touching feature code.
 * Counters in UsageCounter run from day one even while everything is free,
 * so future pricing is based on real usage distributions.
 */
export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    maxWords: 500,
    autoTranslatePerDay: 50,
    voiceReviewsPerDay: 100,
    maxDevices: 1,
    algos: ['sm2', 'leitner'],
    voiceProvider: 'webspeech',
  },
  premium: {
    maxWords: null,
    autoTranslatePerDay: null,
    voiceReviewsPerDay: null,
    maxDevices: null,
    algos: ['sm2', 'leitner', 'fsrs'],
    voiceProvider: 'whisper',
  },
};
