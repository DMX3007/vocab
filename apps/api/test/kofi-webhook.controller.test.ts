import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KofiWebhookController } from '../src/modules/webhooks/kofi.controller';
import { LicensesService } from '../src/modules/licenses/licenses.service';
import { LicenseStore } from '../src/modules/licenses/license-store';
import { EntitlementsService } from '../src/modules/entitlements/entitlements.service';
import { EmailService } from '../src/modules/email/email.service';
import { UnauthorizedException } from '@nestjs/common';

const TOKEN = 'test-verification-token';

function kofiPayload(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    verification_token: TOKEN,
    type: 'Donation',
    email: 'supporter@example.com',
    amount: '19.00',
    currency: 'USD',
    kofi_transaction_id: 'txn-abc',
    is_subscription_payment: false,
    ...overrides,
  });
}

describe('KofiWebhookController', () => {
  let controller: KofiWebhookController;
  let licenses: LicensesService;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.KOFI_VERIFICATION_TOKEN = TOKEN;
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.EMAIL_FROM = 'billing@vocabflow.app';
    licenses = new LicensesService(new LicenseStore(':memory:'), new EntitlementsService());
    const email = new EmailService();
    sendSpy = vi.spyOn(email, 'send').mockResolvedValue();
    controller = new KofiWebhookController(licenses, email);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues a premium license and emails it on a Donation', async () => {
    const result = await controller.handle(kofiPayload());
    expect(result).toEqual({ received: true, issued: true });
    expect(sendSpy).toHaveBeenCalledOnce();
    const [emailArgs] = sendSpy.mock.calls[0]!;
    expect(emailArgs.to).toBe('supporter@example.com');
    expect(emailArgs.text).toContain('VF-');
  });

  it('issues on a Subscription payment too', async () => {
    const result = await controller.handle(kofiPayload({ type: 'Subscription', kofi_transaction_id: 'txn-sub' }));
    expect(result.issued).toBe(true);
  });

  it('rejects a missing/wrong verification token — never issues on it', async () => {
    await expect(
      controller.handle(kofiPayload({ verification_token: 'wrong' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('acknowledges but does not issue for a type this product does not sell', async () => {
    const result = await controller.handle(kofiPayload({ type: 'Shop Order' }));
    expect(result).toEqual({ received: true, issued: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('replaying the same kofi_transaction_id (webhook retry) does not double-issue or double-email', async () => {
    await controller.handle(kofiPayload({ kofi_transaction_id: 'txn-retry' }));
    await controller.handle(kofiPayload({ kofi_transaction_id: 'txn-retry' }));
    // Both calls email the (same) key back out — that's fine, it's still
    // only ONE license record underneath.
    const record = licenses.validate(
      (sendSpy.mock.calls[0]![0].text.match(/VF-[A-Z0-9-]+/) ?? [])[0]!,
    );
    expect(record?.plan).toBe('premium');
  });

  it('malformed data does not crash — treated as unauthorized', async () => {
    await expect(controller.handle('not json')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
