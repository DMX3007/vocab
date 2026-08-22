import { Injectable, Logger } from '@nestjs/common';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

/**
 * Thin wrapper over Resend's REST API via plain fetch — deliberately not
 * the `resend` npm package. It's one POST request; a dependency (and its
 * own transitive deps) buys nothing here that fetch doesn't already do.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(input: SendEmailInput): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      // Misconfiguration, not a user-facing failure: the license was already
      // issued and IS valid — only the delivery email failed to go out. Log
      // loudly so this gets noticed and the key can be resent by hand.
      this.logger.error(`RESEND_API_KEY/EMAIL_FROM not configured — could not email ${input.to}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Resend send failed (${res.status}) for ${input.to}: ${body}`);
    }
  }
}
