// DEMO MODE — see prompt-api.ts's header. Safe to delete with the folder.
//
// The pure half of the demo drill: choosing which library words to build a
// phrase around, writing the prompt, and cleaning up whatever the model
// returns. No browser APIs here, so it's all unit-testable.

import type { Word } from '../storage/types';

export type DrillDifficulty = 'simple' | 'hard';

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
  'You write very short English phrases for a vocabulary learner to translate.',
  'Rules:',
  '- Reply with ONE phrase only. No quotes, no explanation, no list, no preamble.',
  '- Write in English only.',
  '- Use every word you are given, in any grammatical form.',
  '- Keep it natural — something a person would actually say.',
].join('\n');

export function buildDrillPrompt(terms: string[], difficulty: DrillDifficulty): string {
  const list = terms.join(', ');
  return difficulty === 'simple'
    ? `Write one short, simple English phrase (at most 8 words) using: ${list}`
    : `Write one English sentence (12-20 words) using: ${list}. It may be complex — use a subordinate clause or an idiom.`;
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

/** Whether the library has enough usable words to drill at all. */
export function canDrill(words: Word[]): boolean {
  return words.some((w) => !w.deletedAt && !w.shelvedAt && w.term.trim());
}
