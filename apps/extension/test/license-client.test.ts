import { describe, it, expect, vi } from 'vitest';
import { validateLicense } from '../src/lib/licensing/license-client';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('validateLicense', () => {
  it('returns the plan/limits for a valid key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ valid: true, plan: 'premium', limits: { maxWords: null } }),
    );
    const result = await validateLicense('VF-AAAA-BBBB-CCCC-DDDD', fetchImpl);
    expect(result).toEqual({ valid: true, plan: 'premium', limits: { maxWords: null } });
  });

  it('returns valid: false for an unknown key, without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ valid: false }));
    const result = await validateLicense('nope', fetchImpl);
    expect(result.valid).toBe(false);
  });

  it('POSTs the key as JSON to /v1/licenses/validate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ valid: false }));
    await validateLicense('VF-AAAA-BBBB-CCCC-DDDD', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/v1/licenses/validate');
    expect(JSON.parse(init.body)).toEqual({ key: 'VF-AAAA-BBBB-CCCC-DDDD' });
  });

  it('throws on an HTTP error (network/server failure, not an invalid key)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    await expect(validateLicense('VF-AAAA-BBBB-CCCC-DDDD', fetchImpl)).rejects.toThrow('HTTP 503');
  });
});
