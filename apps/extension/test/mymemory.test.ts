import { describe, it, expect, vi } from 'vitest';
import { translateWord } from '../src/lib/translate/mymemory';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('translateWord', () => {
  it('returns the translated text on a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ responseData: { translatedText: 'стойкость' }, responseStatus: 200 }),
    );
    const result = await translateWord('fortitude', 'en', 'ru', fetchImpl);
    expect(result).toBe('стойкость');
  });

  it('sends the term and langpair as query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ responseData: { translatedText: 'x' }, responseStatus: 200 }),
    );
    await translateWord('fortitude', 'en', 'ru', fetchImpl);
    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get('q')).toBe('fortitude');
    expect(url.searchParams.get('langpair')).toBe('en|ru');
  });

  it('throws when the HTTP response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    await expect(translateWord('fortitude', 'en', 'ru', fetchImpl)).rejects.toThrow('HTTP 503');
  });

  it('throws when responseStatus is not 200 (e.g. quota exceeded)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ responseStatus: 403, responseDetails: 'DAILY LIMIT EXCEEDED' }),
    );
    await expect(translateWord('fortitude', 'en', 'ru', fetchImpl)).rejects.toThrow('DAILY LIMIT EXCEEDED');
  });

  it('throws when the response has no translated text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ responseData: { translatedText: '' }, responseStatus: 200 }),
    );
    await expect(translateWord('fortitude', 'en', 'ru', fetchImpl)).rejects.toThrow('no text');
  });

  it('throws when responseData is missing entirely', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ responseStatus: 200 }));
    await expect(translateWord('fortitude', 'en', 'ru', fetchImpl)).rejects.toThrow('no text');
  });
});
