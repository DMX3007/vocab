import type { AlgoId } from '@vocabflow/core';
import type { Word } from '../storage/types';
import { isMastered } from './progress';

// Pure helpers for the Library tab: how a word is bucketed (for the status
// badge + banner counts) and how the list is sorted/filtered. Kept separate
// from the component so the categorization logic is unit-testable.

export type WordStatus = 'due' | 'mastered' | 'learning' | 'fresh';

export function wordStatus(word: Word, now: Date): WordStatus {
  if (word.srsState.dueAt.getTime() <= now.getTime()) return 'due';
  if (isMastered(word)) return 'mastered';
  if (word.srsState.intervalDays > 0) return 'learning';
  return 'fresh';
}

/** A word that hasn't graduated its algorithm's first ladder step yet: SM-2
 *  still walking the learning steps, or Leitner never reviewed at all.
 *  Same "fresh" bucket wordStatus() reports, exposed on its own since the
 *  review queue needs it independently of the due/mastered/learning label. */
export function isFreshWord(word: Word): boolean {
  return word.srsState.intervalDays === 0;
}

/** Review queue order: brand-new words first (so learning stays a priority
 *  instead of getting crowded out by an ever-growing repeat backlog), then
 *  everything else most-overdue first. Each group keeps its own due-order
 *  internally — this only decides which group goes first. */
export function sortForReview(words: Word[]): Word[] {
  return [...words].sort((a, b) => {
    const aFresh = isFreshWord(a);
    const bFresh = isFreshWord(b);
    if (aFresh !== bFresh) return aFresh ? -1 : 1;
    return a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime();
  });
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
