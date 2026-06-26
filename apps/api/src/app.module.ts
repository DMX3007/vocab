import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';

@Module({ imports: [HealthModule, EntitlementsModule] })
export class AppModule {}
