import type { Direction, SrsState } from '@vocably/core';

/** One cached dictionary lookup (see lib/dictionary/freeDictionary.ts) —
 *  a definition, its part of speech, and an example sentence when the
 *  provider has one (many entries don't). */
export interface DictionaryInfo {
  partOfSpeech: string;
  definition: string;
  example: string | null;
  phonetic: string | null;
}

/** What the tooltip hands us when the user saves a selection. */
export interface SaveWordInput {
  term: string;
  translation: string;
  contextSentence: string;
  sourceUrl: string;
  langFrom: string;
  langTo: string;
}

/** A stored vocabulary word. `id` is client-generated so it exists offline. */
export interface Word {
  id: string;
  term: string;
  translations: string[]; // several accepted answers, any one counts as correct
  langFrom: string;
  langTo: string;
  contextSentence: string;
  sourceUrl: string;
  srsState: SrsState;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // soft delete — kept for future sync
  /** Set while the user has set this word aside (too hard for now, or
   *  already known) — excluded from due/review, kept in the Library under
   *  its own "Shelved" status until un-shelved. */
  shelvedAt: Date | null;
  /** Cached dictionary lookup, or null if none was found. */
  dictionary: DictionaryInfo | null;
  /** Set the first time a lookup is attempted, found or not — so a word
   *  with no dictionary entry isn't re-fetched on every review. Null means
   *  "never looked up yet", distinct from "looked up, nothing found". */
  dictionaryFetchedAt: Date | null;
}

export type WireSrsState = Omit<SrsState, 'dueAt'> & { dueAt: string };

export type WireWord = Omit<Word, 'createdAt' | 'updatedAt' | 'deletedAt' | 'shelvedAt' | 'dictionaryFetchedAt' | 'srsState'> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  shelvedAt: string | null;
  dictionaryFetchedAt: string | null;
  srsState: WireSrsState;
};

export type ReviewMode = 'typing' | 'voice';

/** Append-only record of one review. The source of truth for SRS history —
 *  including which direction was asked, so pickDirection (see
 *  @vocably/core) can weight future reviews toward whichever direction the
 *  user actually struggles with, instead of a fixed 50/50 guess. */
export interface ReviewLog {
  id: string;
  wordId: string;
  reviewedAt: Date;
  mode: ReviewMode;
  grade: number;
  direction: Direction;
}

export type WireReviewLog = Omit<ReviewLog, 'reviewedAt'> & { reviewedAt: string };
