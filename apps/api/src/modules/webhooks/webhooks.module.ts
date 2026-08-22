import { Module } from '@nestjs/common';
import { KofiWebhookController } from './kofi.controller';
import { LicensesModule } from '../licenses/licenses.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [LicensesModule, EmailModule],
  controllers: [KofiWebhookController],
})
export class WebhooksModule {}
