import { createSm2 } from './sm2';
import { createLeitner, DEFAULT_LEITNER_CONFIG } from './leitner';
import type { AlgoId, SchedulerConfig, SrsAlgorithm } from './types';

// `config` only shapes SM-2 — Leitner has its own (fixed) box ladder and
// ignores it. Kept as one optional param rather than a per-algo union so
// callers that only ever run SM-2 (most call sites, today) don't have to
// think about the other algorithm's config shape at all.
export function createScheduler(algo: AlgoId, config?: SchedulerConfig): SrsAlgorithm {
  switch (algo) {
    case 'sm2':
      if (!config) throw new Error('createScheduler("sm2", config) requires a config');
      return createSm2(config);
    case 'leitner':
      return createLeitner(DEFAULT_LEITNER_CONFIG);
    default: {
      const exhaustive: never = algo;
      throw new Error(`Unknown SRS algorithm: ${exhaustive}`);
    }
  }
}
