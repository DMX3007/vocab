import { describe, it, expect } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('healthz reports ok with a timestamp', () => {
    const r = controller.healthz();
    expect(r.status).toBe('ok');
    expect(new Date(r.time).getTime()).not.toBeNaN();
  });

  it('readyz lists dependency checks (db/redis stubbed true for skeleton)', async () => {
    const r = await controller.readyz();
    expect(r.status).toBe('ready');
    expect(r.checks).toHaveProperty('db');
    expect(r.checks).toHaveProperty('redis');
  });
});
