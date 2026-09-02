// PRACTICE MODE — see prompt-api.ts's header. Safe to delete with the folder.
//
// The pure half of the practice drill: choosing which library words to build a
// phrase around, writing the prompt, and cleaning up whatever the model
// returns. No browser APIs here, so it's all unit-testable.

import type { Word } from '../storage/types';
import { modelCanWrite } from './prompt-api';

export type DrillDifficulty = 'simple' | 'hard';

/** Which language the LEARNER produces.
 *
 *  Naming here is deliberately about the learner, not about the app's
 *  `targetLang` field — those mean opposite things and it's a real trap.
 *  `targetLang` is the language words are translated INTO (Russian, say),
 *  while `langFrom` is hardcoded 'en': the language of the pages you read,
 *  which is the one you're actually learning. So a Russian speaker reading
 *  English has targetLang = their NATIVE language.
 *
 *  'english'  — prompt shown in targetLang, learner writes English.
 *               Producing the language you're learning: the useful drill.
 *  'target'   — prompt shown in English, learner writes targetLang. */
export type DrillDirection = 'english' | 'target';

/** How many library words one generated phrase is built around. A hard
 *  phrase uses more of them, which is most of what makes it harder. */
const WORDS_PER_DRILL: Record<DrillDifficulty, number> = { simple: 2, hard: 4 };

/** Picks up to N distinct words at random. Random rather than due-ordered
 *  on purpose: this mode is vocabulary ACTIVATION, deliberately separate
 *  from the SRS — it must never read or write scheduling state, or the two
 *  systems would quietly fight over the same words. */
export function pickDrillWords(
  words: Word[],
  difficulty: DrillDifficulty,
  rng: () => number = Math.random,
): Word[] {
  const usable = words.filter((w) => !w.deletedAt && !w.shelvedAt && w.term.trim());
  const want = Math.min(WORDS_PER_DRILL[difficulty], usable.length);
  const pool = [...usable];
  const picked: Word[] = [];
  while (picked.length < want && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    picked.push(pool.splice(i, 1)[0]!);
  }
  return picked;
}

/** The system prompt. Deliberately pins the model to ENGLISH ONLY: a small
 *  on-device model is far more reliable in English than in an inflected
 *  language, and a language app that shows learners malformed target-language
 *  text teaches them errors they can't detect. The user translates INTO
 *  their target language themselves — the model never writes it. */
export const SYSTEM_PROMPT = [
  'You write very short phrases for a vocabulary learner to translate.',
  'Rules:',
  '- Compose the phrase in English first. Then translate it.',
  '- Reply with EXACTLY two lines and nothing else:',
  '  EN: <the English phrase>',
  '  TR: <the translation>',
  '- No quotes, no explanation, no list, no preamble.',
  '- Use every word you are given, in any grammatical form.',
  '- Keep it natural — something a person would actually say.',
].join('\n');

/** `targetLanguageLabel` is null when the on-device model can't write that
 *  language at all (see MODEL_OUTPUT_LANGUAGES — Russian, Italian,
 *  Portuguese and Chinese are all outside its attested set). In that case
 *  we simply don't ask for a translation: requesting output the model has
 *  no support for produces confident-looking nonsense, which is the one
 *  thing a learner can't detect. Those languages get their translation from
 *  the separate provider instead — see resolveTranslation. */
export function buildDrillPrompt(
  terms: string[],
  difficulty: DrillDifficulty,
  targetLanguageLabel: string | null,
): string {
  const list = terms.join(', ');
  const ask = difficulty === 'simple'
    ? `Write one short, simple English phrase (at most 8 words) using: ${list}`
    : `Write one English sentence (12-20 words) using: ${list}. It may be complex — use a subordinate clause or an idiom.`;
  return targetLanguageLabel === null
    ? `${ask}\nReply with that one line only.`
    : `${ask}\nThen translate that phrase into ${targetLanguageLabel}.`;
}

export interface GeneratedPhrase {
  english: string;
  /** The targetLang rendering, or null when the model didn't give a usable
   *  second line. Only ever shown as a PROMPT to understand — never as a
   *  reference answer to imitate, since a small model is least reliable
   *  exactly here and a learner couldn't tell a bad one from a good one. */
  translated: string | null;
}

/** Splits the model's two labelled lines apart. Tolerant of a missing or
 *  differently-labelled second line: a translation we can't trust to exist
 *  simply disables the direction that depends on it, rather than failing
 *  the whole drill. */
export function parseGeneratedPhrase(raw: string): GeneratedPhrase {
  const lines = raw
    .split('\n')
    .map((l) => cleanGeneratedPhrase(l))
    .filter((l) => l.length > 0);
  return {
    english: lines[0] ?? '',
    translated: lines[1] ?? null,
  };
}

/** Small models like to wrap output in quotes, prefix it ("Sure! Here's..."),
 *  or bolt on an explanation. Keep the first real line and strip the wrapping
 *  so the learner sees a phrase, not a chat response. */
export function cleanGeneratedPhrase(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';

  return firstLine
    // drop a leading "Sure, here is a phrase:" style preamble
    .replace(/^[^:]{0,40}:\s*/, '')
    // drop list/bullet markers
    .replace(/^[-*•]\s*/, '')
    // drop symmetric wrapping quotes
    .replace(/^["'“‘](.*)["'”’]$/, '$1')
    .trim();
}

/** Gets the phrase into the language the learner reads it in, in order of
 *  trust, and says which source won.
 *
 *  The on-device model only attests to five output languages
 *  (MODEL_OUTPUT_LANGUAGES), so for Russian — and Italian, Portuguese,
 *  Chinese — it returns no second line at all. Before this fallback existed
 *  the card had nothing left to show but the bare list of words, which is
 *  not a phrase anyone can translate: the mode silently stopped working for
 *  exactly the languages it was least able to serve.
 *
 *  `translate` is injected so this stays testable without a network call;
 *  the worker passes the same provider the Add-Word tooltip's AUTO button
 *  uses. A provider failure is not an error here — cues are a worse but
 *  honest last resort, and the UI explains itself when it lands there. */
export async function resolveTranslation(
  modelTranslation: string | null,
  english: string,
  sourceLang: string,
  targetLang: string,
  translate: (text: string, from: string, to: string) => Promise<string>,
): Promise<{ text: string | null; source: 'model' | 'provider' | 'none' }> {
  // Trusted only when the model can actually write the language — asking it
  // anyway yields confident nonsense, the one thing a learner can't detect.
  if (modelCanWrite(targetLang) && modelTranslation) {
    return { text: modelTranslation, source: 'model' };
  }
  if (!english.trim()) return { text: null, source: 'none' };
  try {
    const text = (await translate(english, sourceLang, targetLang)).trim();
    return text ? { text, source: 'provider' } : { text: null, source: 'none' };
  } catch {
    return { text: null, source: 'none' };
  }
}

/** Whether the library has enough usable words to drill at all. */
export function canDrill(words: Word[]): boolean {
  return words.some((w) => !w.deletedAt && !w.shelvedAt && w.term.trim());
}
