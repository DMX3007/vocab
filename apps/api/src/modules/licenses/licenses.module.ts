import { Module } from '@nestjs/common';
import { LicensesController } from './licenses.controller';
import { LicensesService, LICENSE_STORE } from './licenses.service';
import { LicenseStore } from './license-store';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [EntitlementsModule],
  controllers: [LicensesController],
  providers: [
    {
      provide: LICENSE_STORE,
      // LICENSE_DB_PATH unset -> ':memory:', which is only fine for local
      // dev/tests: on a real deploy this MUST point at a persistent volume,
      // or every restart silently forgets every license ever issued.
      useFactory: () => new LicenseStore(process.env.LICENSE_DB_PATH ?? ':memory:'),
    },
    LicensesService,
  ],
  exports: [LicensesService],
})
export class LicensesModule {}
