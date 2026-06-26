import { describe, it, expect } from 'vitest';
import { EntitlementsService } from '../src/modules/entitlements/entitlements.service';
import { PLANS } from '../src/modules/entitlements/plans.config';

describe('plans config', () => {
  it('defines free and premium plans', () => {
    expect(PLANS.free).toBeDefined();
    expect(PLANS.premium).toBeDefined();
  });

  it('free plan has finite limits, premium is unlimited where it matters', () => {
    expect(PLANS.free.maxWords).toBeGreaterThan(0);
    expect(PLANS.free.autoTranslatePerDay).toBeGreaterThan(0);
    expect(PLANS.premium.maxWords).toBeNull();
    expect(PLANS.premium.autoTranslatePerDay).toBeNull();
  });

  it('fsrs is premium-only at launch, sm2 is free', () => {
    expect(PLANS.free.algos).toContain('sm2');
    expect(PLANS.free.algos).not.toContain('fsrs');
    expect(PLANS.premium.algos).toContain('fsrs');
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
    const r = svc.canUse('free', 'autoTranslatePerDay', 10);
    expect(r.allowed).toBe(true);
  });

  it('canUse: at/over the limit -> denied with limit info (premium upsell signal)', () => {
    const limit = PLANS.free.autoTranslatePerDay!;
    const r = svc.canUse('free', 'autoTranslatePerDay', limit);
    expect(r.allowed).toBe(false);
    expect(r.limit).toBe(limit);
  });

  it('canUse: null limit means unlimited', () => {
    const r = svc.canUse('premium', 'autoTranslatePerDay', 1_000_000);
    expect(r.allowed).toBe(true);
  });
});
