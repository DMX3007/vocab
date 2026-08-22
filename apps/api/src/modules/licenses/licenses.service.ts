import { Injectable, Inject } from '@nestjs/common';
import { LicenseStore, type LicenseRecord } from './license-store';
import { generateLicenseKey } from './license-key';
import { EntitlementsService, type EntitlementsSnapshot } from '../entitlements/entitlements.service';
import type { PlanId } from '../entitlements/plans.config';

export const LICENSE_STORE = Symbol('LICENSE_STORE');

export interface IssueLicenseInput {
  email: string;
  plan: PlanId;
  source: string;
  sourceTransactionId?: string | null;
}

@Injectable()
export class LicensesService {
  constructor(
    @Inject(LICENSE_STORE) private readonly store: LicenseStore,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Mints a new key, unless this exact (source, transaction) already has
   *  one — a payment webhook retries on anything but a 2xx response, and a
   *  retry must hand back the SAME key rather than mint (and email) a
   *  second one for a single purchase. */
  issue(input: IssueLicenseInput, now: Date = new Date()): LicenseRecord {
    if (input.sourceTransactionId) {
      const existing = this.store.findBySourceTransaction(input.source, input.sourceTransactionId);
      if (existing) return existing;
    }
    return this.store.insert(
      {
        key: generateLicenseKey(),
        email: input.email,
        plan: input.plan,
        source: input.source,
        sourceTransactionId: input.sourceTransactionId ?? null,
      },
      now,
    );
  }

  /** null = not a valid, currently-active license for anything (unknown key,
   *  or revoked — e.g. after a refund). Never throws on a bad key: an
   *  invalid license is an expected, everyday input here, not an error. */
  validate(key: string): EntitlementsSnapshot | null {
    const record = this.store.findByKey(key.trim());
    if (!record || record.revokedAt) return null;
    return this.entitlements.forPlan(record.plan);
  }
}
