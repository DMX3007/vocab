import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({ imports: [HealthModule, EntitlementsModule, LicensesModule, WebhooksModule] })
export class AppModule {}
