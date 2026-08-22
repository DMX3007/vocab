import { describe, it, expect, beforeEach } from 'vitest';
import { LicensesService } from '../src/modules/licenses/licenses.service';
import { LicenseStore } from '../src/modules/licenses/license-store';
import { EntitlementsService } from '../src/modules/entitlements/entitlements.service';

const NOW = new Date('2026-08-22T12:00:00Z');

describe('LicensesService', () => {
  let store: LicenseStore;
  let svc: LicensesService;

  beforeEach(() => {
    store = new LicenseStore(':memory:'); // fresh in-memory DB per test
    svc = new LicensesService(store, new EntitlementsService());
  });

  it('issues a premium license with a VF-XXXX-XXXX-XXXX-XXXX key', () => {
    const record = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi' }, NOW);
    expect(record.key).toMatch(/^VF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(record.plan).toBe('premium');
    expect(record.revokedAt).toBeNull();
  });

  it('two separate purchases get two different keys', () => {
    const a = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi' }, NOW);
    const b = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi' }, NOW);
    expect(a.key).not.toBe(b.key);
  });

  it('replaying the same source transaction returns the SAME key, not a new one', () => {
    // Webhook providers retry on anything but a 2xx — must not double-issue.
    const first = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi', sourceTransactionId: 'txn-1' }, NOW);
    const retry = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi', sourceTransactionId: 'txn-1' }, NOW);
    expect(retry.key).toBe(first.key);
    expect(retry.id).toBe(first.id);
  });

  it('a different transaction id still gets its own key, even for the same email', () => {
    const a = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi', sourceTransactionId: 'txn-1' }, NOW);
    const b = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi', sourceTransactionId: 'txn-2' }, NOW);
    expect(a.key).not.toBe(b.key);
  });

  it('validates a freshly issued key and returns its plan entitlements', () => {
    const record = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi' }, NOW);
    const snapshot = svc.validate(record.key);
    expect(snapshot?.plan).toBe('premium');
    expect(snapshot?.limits.maxWords).toBeNull(); // premium = unlimited
  });

  it('trims whitespace a user might paste around the key', () => {
    const record = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi' }, NOW);
    expect(svc.validate(`  ${record.key}  `)?.plan).toBe('premium');
  });

  it('an unknown key is invalid, not an error', () => {
    expect(svc.validate('VF-0000-0000-0000-0000')).toBeNull();
  });

  it('a revoked key (e.g. after a refund) stops validating', () => {
    const record = svc.issue({ email: 'a@b.com', plan: 'premium', source: 'kofi' }, NOW);
    expect(svc.validate(record.key)).not.toBeNull();
    store.revoke(record.key, NOW);
    expect(svc.validate(record.key)).toBeNull();
  });
});
