import type { DictionaryInfo } from '../storage/types';

// The review card's "example sentence" provider. Free Dictionary API is
// free, no key/signup required, and covers English — a good fit since
// word.term is always English here, unlike the translate provider which
// has to handle whatever langTo is active.
// https://dictionaryapi.dev
const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en';

interface ApiDefinition {
  definition: string;
  example?: string;
}
interface ApiMeaning {
  partOfSpeech: string;
  definitions: ApiDefinition[];
}
interface ApiEntry {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings: ApiMeaning[];
}

/** Looks up one English word. Returns null for "no entry" — extremely
 *  common here (slang, rare words, multi-word phrases, proper nouns), so
 *  it's treated as a normal outcome, not an error. Still throws on a
 *  genuine network/HTTP failure, so a caller can tell "nothing found" apart
 *  from "couldn't check" and only cache the former. */
export async function fetchDictionaryInfo(
  term: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DictionaryInfo | null> {
  const response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(term)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Dictionary request failed: HTTP ${response.status}`);
  }

  const entries = (await response.json()) as ApiEntry[];
  const phonetic = entries.find((e) => e.phonetic)?.phonetic
    ?? entries.flatMap((e) => e.phonetics ?? []).find((p) => p.text)?.text
    ?? null;

  // Prefer whichever definition actually has an example sentence — most
  // entries carry several definitions but only some of them do.
  for (const entry of entries) {
    for (const meaning of entry.meanings) {
      for (const def of meaning.definitions) {
        if (def.example) {
          return { partOfSpeech: meaning.partOfSpeech, definition: def.definition, example: def.example, phonetic };
        }
      }
    }
  }

  // No example anywhere in the entry — fall back to the first definition,
  // still useful on its own even without a sentence to show alongside it.
  const firstMeaning = entries[0]?.meanings[0];
  const firstDef = firstMeaning?.definitions[0];
  if (!firstMeaning || !firstDef) return null;
  return { partOfSpeech: firstMeaning.partOfSpeech, definition: firstDef.definition, example: null, phonetic };
}
