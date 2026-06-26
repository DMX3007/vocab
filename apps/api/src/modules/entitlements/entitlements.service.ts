import { Injectable } from '@nestjs/common';
import { PLANS, type PlanId, type PlanLimits } from './plans.config';

export interface EntitlementsSnapshot {
  plan: PlanId;
  limits: PlanLimits;
}

export interface UsageCheck {
  allowed: boolean;
  limit: number | null;
  remaining: number | null;
}

type NumericLimit = {
  [K in keyof PlanLimits]: PlanLimits[K] extends number | null ? K : never;
}[keyof PlanLimits];

@Injectable()
export class EntitlementsService {
  /** Fail-closed: anything unknown is treated as free. */
  forPlan(plan: PlanId): EntitlementsSnapshot {
    const id: PlanId = plan in PLANS ? plan : 'free';
    return { plan: id, limits: PLANS[id] };
  }

  canUse(plan: PlanId, metric: NumericLimit, currentUsage: number): UsageCheck {
    const { limits } = this.forPlan(plan);
    const limit = limits[metric];
    if (limit === null) return { allowed: true, limit: null, remaining: null };
    const remaining = Math.max(0, limit - currentUsage);
    return { allowed: currentUsage < limit, limit, remaining };
  }
}
