import type { AlgoId } from '@vocably/core';
import type { Word } from '../storage/types';
import { isMastered } from './progress';

// Pure helpers for the Library tab: how a word is bucketed (for the status
// badge + banner counts) and how the list is sorted/filtered. Kept separate
// from the component so the categorization logic is unit-testable.

export type WordStatus = 'shelved' | 'due' | 'mastered' | 'learning' | 'fresh';

export function wordStatus(word: Word, now: Date): WordStatus {
  // Checked first: a shelved word is set aside on purpose, so it should
  // never read as "due" just because time passed while it sat there.
  if (word.shelvedAt) return 'shelved';
  if (word.srsState.dueAt.getTime() <= now.getTime()) return 'due';
  if (isMastered(word)) return 'mastered';
  if (word.srsState.intervalDays > 0) return 'learning';
  return 'fresh';
}

/** A word that has never actually been attempted — saved, but not answered
 *  even once (right or wrong). The mirror image of isBurstWord below; see
 *  its comment for why `lapses` has to be checked alongside `stepIndex`
 *  (a wrong answer resets stepIndex to 0, so stepIndex alone can't tell
 *  "just missed it" apart from "never tried").
 *
 *  Deliberately NOT `intervalDays === 0`, which is what this used to be:
 *  intervalDays stays 0 for a word's WHOLE learning ladder (scheduleLearning
 *  never touches it — only graduating does), so that test called a word
 *  "fresh" through all 14 default learning steps, not just when brand-new.
 *  Paired with sortForReview's absolute fresh-first rule and a one-card
 *  session, that starved the repeat backlog outright — see sortForReview. */
export function isFreshWord(word: Word): boolean {
  const { stepIndex, lapses, repetitions } = word.srsState;
  return stepIndex === 0 && lapses === 0 && repetitions === 0;
}

/** Review queue order: never-attempted words first (so a word you just saved
 *  gets started promptly instead of sitting behind a long backlog), then
 *  everything else most-overdue first.
 *
 *  That head start is deliberately ONE-SHOT — it lasts only until a word's
 *  first answer, not for its whole learning ladder. Absolute priority for
 *  an entire phase can't just delay the other group, it starves it forever
 *  whenever the priority group keeps refilling: learning steps are ~25
 *  SECONDS apart, so a handful of half-learned words re-enter the queue
 *  continuously and, with one card graded per session (maxCards), nothing
 *  that had graduated would ever come up again — words piling up "due" in
 *  the popup for hours while review kept serving the same few. Once a word
 *  has been touched once it competes on plain overdue-ness like everything
 *  else, so no word can be crowded out indefinitely. */
export function sortForReview(words: Word[]): Word[] {
  return [...words].sort((a, b) => {
    const aFresh = isFreshWord(a);
    const bFresh = isFreshWord(b);
    if (aFresh !== bFresh) return aFresh ? -1 : 1;
    return a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime();
  });
}

/** A word actively mid-drill: still on its learning/relearning ladder AND
 *  already attempted at least once — not a brand-new, untouched word.
 *  This is what content.ts's fast burst-poll uses to decide whether to
 *  auto-reappear the review overlay without waiting on the normal ambient
 *  throttle: a word the user already started drilling deserves a fast
 *  follow-up, but a whole untouched backlog firing an overlay every few
 *  seconds would be exactly the nagging the throttle exists to prevent.
 *
 *  Checks stepIndex > 0 OR lapses > 0, not just stepIndex: a wrong answer
 *  resets stepIndex back to 0, which alone would be indistinguishable
 *  from a word that's never been touched — lapses (which only ever goes
 *  up) is what actually tells "attempted and just missed" apart from
 *  "never attempted". */
export function isBurstWord(word: Word): boolean {
  const { phase, stepIndex, lapses } = word.srsState;
  return (phase === 'learning' || phase === 'relearning') && (stepIndex > 0 || lapses > 0);
}

/** Lapses (see SrsState.lapses) at which a word is worth suggesting a
 *  shelve for — it's failed enough times in a row that drilling it
 *  further right now is probably not working. */
export const SHELVE_SUGGEST_LAPSES = 4;

/** Whether to suggest shelving this word right after a miss — see
 *  ReviewCard, which shows the suggestion only once per session per word
 *  (dismissible), never proactively elsewhere. */
export function shouldSuggestShelving(word: Word): boolean {
  return !word.shelvedAt && word.srsState.lapses >= SHELVE_SUGGEST_LAPSES;
}

export type LibrarySort = 'added' | 'due' | 'alpha' | 'mastered';

export function sortWords(words: Word[], sort: LibrarySort): Word[] {
  const arr = [...words];
  switch (sort) {
    case 'added':
      return arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    case 'due':
      return arr.sort((a, b) => a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime());
    case 'alpha':
      return arr.sort((a, b) => a.term.localeCompare(b.term));
    case 'mastered':
      return arr.sort((a, b) => b.srsState.intervalDays - a.srsState.intervalDays);
  }
}

export function filterWords(words: Word[], query: string): Word[] {
  const q = query.trim().toLowerCase();
  if (!q) return words;
  return words.filter(
    (w) => w.term.toLowerCase().includes(q) || w.translations.some((t) => t.toLowerCase().includes(q)),
  );
}

export type AlgoFilter = 'all' | AlgoId;

export function filterByAlgo(words: Word[], filter: AlgoFilter): Word[] {
  if (filter === 'all') return words;
  return words.filter((w) => w.srsState.algo === filter);
}
