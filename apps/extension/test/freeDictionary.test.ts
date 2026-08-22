import { describe, it, expect, vi } from 'vitest';
import { fetchDictionaryInfo } from '../src/lib/dictionary/freeDictionary';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const entryWithExample = [
  {
    phonetic: '/fəˈtʃuːd/',
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'Strength in the face of pain or adversity.' },
          { definition: 'Courage.', example: 'She showed great fortitude during the illness.' },
        ],
      },
    ],
  },
];

const entryWithNoExampleAnywhere = [
  {
    meanings: [
      { partOfSpeech: 'noun', definitions: [{ definition: 'A quality of being resolute.' }] },
    ],
  },
];

describe('fetchDictionaryInfo', () => {
  it('picks the first definition that has an example, even if earlier ones do not', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(entryWithExample));
    const info = await fetchDictionaryInfo('fortitude', fetchImpl);
    expect(info).toEqual({
      partOfSpeech: 'noun',
      definition: 'Courage.',
      example: 'She showed great fortitude during the illness.',
      phonetic: '/fəˈtʃuːd/',
    });
  });

  it('requests the exact endpoint for the given term', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(entryWithExample));
    await fetchDictionaryInfo('fortitude', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.dictionaryapi.dev/api/v2/entries/en/fortitude');
  });

  it('falls back to the first definition when nothing has an example', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(entryWithNoExampleAnywhere));
    const info = await fetchDictionaryInfo('word', fetchImpl);
    expect(info).toEqual({
      partOfSpeech: 'noun',
      definition: 'A quality of being resolute.',
      example: null,
      phonetic: null,
    });
  });

  it('returns null (not an error) on a 404 — no entry for the word', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: 'No Definitions Found' }, false, 404));
    const info = await fetchDictionaryInfo('zxqwerty', fetchImpl);
    expect(info).toBeNull();
  });

  it('throws on a genuine HTTP failure, distinct from "not found"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    await expect(fetchDictionaryInfo('fortitude', fetchImpl)).rejects.toThrow('HTTP 503');
  });

  it('returns null when the entry array is empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    expect(await fetchDictionaryInfo('fortitude', fetchImpl)).toBeNull();
  });
});
