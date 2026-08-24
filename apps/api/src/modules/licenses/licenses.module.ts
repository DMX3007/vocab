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
      // or every restart silently forgets every license ever issued. Refuse
      // to boot in production rather than silently falling back — losing
      // every license on a restart should never happen quietly.
      useFactory: () => {
        const dbPath = process.env.LICENSE_DB_PATH;
        if (!dbPath && process.env.NODE_ENV === 'production') {
          throw new Error(
            'LICENSE_DB_PATH must be set in production — refusing to start with an in-memory license store that forgets every license on restart.',
          );
        }
        return new LicenseStore(dbPath ?? ':memory:');
      },
    },
    LicensesService,
  ],
  exports: [LicensesService],
})
export class LicensesModule {}
