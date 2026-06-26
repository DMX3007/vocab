import type { SrsState } from '@vocabflow/core';

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
}

export type WireWord = Omit<Word, 'createdAt' | 'updatedAt' | 'deletedAt' | 'srsState'> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  srsState: Omit<Word['srsState'], 'dueAt'> & { dueAt: string };
};

export type ReviewMode = 'typing' | 'voice';

/** Append-only record of one review. The source of truth for SRS history. */
export interface ReviewLog {
  id: string;
  wordId: string;
  reviewedAt: Date;
  mode: ReviewMode;
  grade: number;
}
