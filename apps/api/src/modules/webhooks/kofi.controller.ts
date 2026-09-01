import { Body, Controller, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { LicensesService } from '../licenses/licenses.service';
import { EmailService } from '../email/email.service';

interface KofiPayload {
  verification_token: string;
  type: string; // 'Donation' | 'Subscription' | 'Commission' | 'Shop Order'
  email: string;
  amount: string;
  currency: string;
  kofi_transaction_id: string;
  is_subscription_payment: boolean;
}

// Purchase types that earn a Premium license. Everything else (Commission,
// Shop Order — not something this product sells today) is acknowledged
// with 200 so Ko-fi doesn't retry, but issues nothing.
const LICENSE_WORTHY_TYPES = new Set(['Donation', 'Subscription']);

@Controller('v1/webhooks/kofi')
export class KofiWebhookController {
  private readonly logger = new Logger(KofiWebhookController.name);

  constructor(
    private readonly licenses: LicensesService,
    private readonly email: EmailService,
  ) {}

  // Ko-fi POSTs application/x-www-form-urlencoded with a single `data`
  // field holding a JSON string — not a JSON body — see
  // https://ko-fi.com/manage/webhooks at the time this was written.
  @Post()
  async handle(@Body('data') data: string) {
    const payload = this.parse(data);
    if (!payload || payload.verification_token !== process.env.KOFI_VERIFICATION_TOKEN) {
      // Deliberately not swallowed into a 200: a wrong/missing token is
      // never a genuine Ko-fi retry (Ko-fi always sends the token it was
      // configured with), so there's no retry storm to protect against —
      // only unrecognized requests hitting this endpoint.
      throw new UnauthorizedException();
    }

    if (!LICENSE_WORTHY_TYPES.has(payload.type)) {
      return { received: true, issued: false };
    }
    if (!payload.email) {
      this.logger.warn(`Ko-fi ${payload.type} with no email — cannot deliver a license (txn ${payload.kofi_transaction_id})`);
      return { received: true, issued: false };
    }

    const license = this.licenses.issue({
      email: payload.email,
      plan: 'premium',
      source: 'kofi',
      sourceTransactionId: payload.kofi_transaction_id,
    });

    await this.email.send({
      to: payload.email,
      subject: 'Your BrowseVocab Premium license',
      text: [
        `Thank you for supporting BrowseVocab!`,
        ``,
        `Your license key: ${license.key}`,
        ``,
        `Paste it into the extension's Plan tab, under "Already have a license key?", to unlock Premium.`,
      ].join('\n'),
    });

    return { received: true, issued: true };
  }

  private parse(data: string): KofiPayload | null {
    if (!data) return null;
    try {
      return JSON.parse(data) as KofiPayload;
    } catch {
      return null;
    }
  }
}
