import type { Word } from '../storage/types';
import { MASTERED_INTERVAL_DAYS } from './progress';

// Pure helpers for the Library tab: how a word is bucketed (for the status
// badge + banner counts) and how the list is sorted/filtered. Kept separate
// from the component so the categorization logic is unit-testable.

export type WordStatus = 'due' | 'mastered' | 'learning' | 'fresh';

export function wordStatus(word: Word, now: Date): WordStatus {
  if (word.srsState.dueAt.getTime() <= now.getTime()) return 'due';
  if (word.srsState.intervalDays >= MASTERED_INTERVAL_DAYS) return 'mastered';
  if (word.srsState.intervalDays > 0) return 'learning';
  return 'fresh';
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
