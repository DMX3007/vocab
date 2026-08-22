import { describe, it, expect } from 'vitest';
import { EntitlementsService } from '../src/modules/entitlements/entitlements.service';
import { PLANS } from '../src/modules/entitlements/plans.config';

describe('plans config', () => {
  it('defines free and premium plans', () => {
    expect(PLANS.free).toBeDefined();
    expect(PLANS.premium).toBeDefined();
  });

  it('free plan has a finite word cap, premium is unlimited', () => {
    expect(PLANS.free.maxWords).toBeGreaterThan(0);
    expect(PLANS.premium.maxWords).toBeNull();
  });

  it('at launch, maxWords is the only dimension that actually differs — everything else is unenforced so far', () => {
    const { maxWords: _free, ...freeRest } = PLANS.free;
    const { maxWords: _premium, ...premiumRest } = PLANS.premium;
    expect(freeRest).toEqual(premiumRest);
  });
});

describe('EntitlementsService', () => {
  const svc = new EntitlementsService();

  it('returns the full entitlements snapshot for a plan', () => {
    const e = svc.forPlan('free');
    expect(e.plan).toBe('free');
    expect(e.limits.maxWords).toBe(PLANS.free.maxWords);
  });

  it('unknown plan falls back to free (fail-closed)', () => {
    // @ts-expect-error deliberately wrong input
    expect(svc.forPlan('enterprise').plan).toBe('free');
  });

  it('canUse: under the limit -> allowed', () => {
    const r = svc.canUse('free', 'maxWords', 10);
    expect(r.allowed).toBe(true);
  });

  it('canUse: at/over the limit -> denied with limit info (premium upsell signal)', () => {
    const limit = PLANS.free.maxWords!;
    const r = svc.canUse('free', 'maxWords', limit);
    expect(r.allowed).toBe(false);
    expect(r.limit).toBe(limit);
  });

  it('canUse: null limit means unlimited', () => {
    const r = svc.canUse('premium', 'maxWords', 1_000_000);
    expect(r.allowed).toBe(true);
  });
});
