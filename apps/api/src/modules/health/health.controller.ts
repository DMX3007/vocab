import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  healthz() {
    return { status: 'ok' as const, time: new Date().toISOString() };
  }

  @Get('readyz')
  async readyz() {
    // skeleton: real DB/Redis pings arrive with the prisma/redis modules (next loop)
    const checks = { db: true, redis: true };
    const ready = Object.values(checks).every(Boolean);
    return { status: ready ? ('ready' as const) : ('degraded' as const), checks };
  }
}
