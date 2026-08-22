import { Body, Controller, Post } from '@nestjs/common';
import { LicensesService } from './licenses.service';

@Controller('v1/licenses')
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  /** Called by the extension when the user pastes a license key into the
   *  Plan tab. Deliberately returns { valid: false } rather than a 4xx for
   *  a bad/unknown key — this is queried on every activation attempt,
   *  including plenty of typos, not an error condition. */
  @Post('validate')
  validate(@Body('key') key: string) {
    if (!key || typeof key !== 'string') return { valid: false as const };
    const snapshot = this.licenses.validate(key);
    if (!snapshot) return { valid: false as const };
    return { valid: true as const, plan: snapshot.plan, limits: snapshot.limits };
  }
}
