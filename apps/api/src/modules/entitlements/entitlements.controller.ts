import { Controller, Get } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';

@Controller('v1/me')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get('entitlements')
  getMine() {
    // skeleton: plan comes from the authenticated user once auth module lands
    return this.entitlements.forPlan('free');
  }
}
