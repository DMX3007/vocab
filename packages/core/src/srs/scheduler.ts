import { createSm2 } from './sm2';
import type { AlgoId, SchedulerConfig, SrsAlgorithm } from './types';

export function createScheduler(algo: AlgoId, config: SchedulerConfig): SrsAlgorithm {
  switch (algo) {
    case 'sm2':
      return createSm2(config);
    default: {
      const exhaustive: never = algo;
      throw new Error(`Unknown SRS algorithm: ${exhaustive}`);
    }
  }
}
