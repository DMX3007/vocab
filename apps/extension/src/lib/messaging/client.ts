import type { SaveWordInput, Word, ReviewMode, ReviewLog } from '../storage/types';
import type { AlgoId, Direction, Grade, Pace, SrsState } from '@vocably/core';
import type { Message, ResponseMap, MessageType } from './protocol';
import type { DrillDifficulty } from '../practice/drill';
import { reviveWord, reviveWords, reviveReviewLogs } from './revive';

// Client used by the popup and the content script. It hides the messaging
// and date-revival so callers work with the same shapes the repository
// returns. All data actually lives in the background-owned database.

async function send<T extends Message>(message: T): Promise<ResponseMap[T["type"]]> {
  const response = await browser.runtime.sendMessage(message);
  if (response && typeof response === "object" && '__error' in response) {
    throw new Error(String(response.__error))
  }
  return response as ResponseMap[T["type"]]
}

export const wordClient = {
  async saveWord(input: SaveWordInput): Promise<Word> {
    return reviveWord((await send({ type: 'SAVE_WORD', payload: { input } })));
  },
  async getAllWords(langTo: string): Promise<Word[]> {
    return reviveWords((await send({ type: 'GET_ALL_WORDS', payload: { langTo } })));
  },
  async getDueWords(now: Date, langTo: string): Promise<Word[]> {
    return reviveWords((await send({ type: 'GET_DUE_WORDS', payload: { langTo, now: now.toISOString() } })));
  },
  async countWords(langTo: string): Promise<number> {
    return (await send({ type: 'COUNT_WORDS', payload: { langTo } })) as number;
  },
  async recordReview(wordId: string, grade: Grade, mode: ReviewMode, direction: Direction, now: Date): Promise<Word> {
    return reviveWord(
      (await send({ type: 'RECORD_REVIEW', payload: { wordId, grade, mode, direction, now: now.toISOString() } })),
    );
  },
  async correctReview(
    wordId: string,
    preReviewState: SrsState,
    grade: Grade,
    reviewedAt: Date,
    now: Date,
  ): Promise<Word> {
    return reviveWord(
      await send({
        type: 'CORRECT_REVIEW',
        payload: {
          wordId,
          preReviewState: { ...preReviewState, dueAt: preReviewState.dueAt.toISOString() },
          grade,
          reviewedAt: reviewedAt.toISOString(),
          now: now.toISOString(),
        },
      }),
    );
  },
  async deleteWord(wordId: string, now: Date): Promise<void> {
    await send({ type: 'DELETE_WORD', payload: { wordId, now: now.toISOString() } });
  },
  async getAllReviewLogs(): Promise<ReviewLog[]> {
    return reviveReviewLogs(await send({ type: 'GET_ALL_LOGS', payload: {} }));
  },
  async moveWordsAlgo(wordIds: string[], algo: AlgoId, now: Date, pace?: Pace): Promise<Word[]> {
    return reviveWords(await send({ type: 'MOVE_WORDS_ALGO', payload: { wordIds, algo, pace, now: now.toISOString() } }));
  },
  async translate(term: string, langFrom: string, langTo: string): Promise<string> {
    return send({ type: 'TRANSLATE', payload: { term, langFrom, langTo } });
  },
  async shelveWord(wordId: string, now: Date): Promise<Word> {
    return reviveWord(await send({ type: 'SHELVE_WORD', payload: { wordId, now: now.toISOString() } }));
  },
  async unshelveWord(wordId: string, now: Date): Promise<Word> {
    return reviveWord(await send({ type: 'UNSHELVE_WORD', payload: { wordId, now: now.toISOString() } }));
  },
  /** Soft-deletes every word of one language. Returns how many were cleared. */
  async clearLibrary(langTo: string, now: Date): Promise<number> {
    return send({ type: 'CLEAR_LIBRARY', payload: { langTo, now: now.toISOString() } });
  },
  /** Every live word across every language, for a full-fidelity JSON export. */
  async exportLibrary(): Promise<Word[]> {
    return reviveWords(await send({ type: 'EXPORT_LIBRARY', payload: {} }));
  },
  /** Looks up (and caches) an example sentence/definition for a word.
   *  Cheap to call repeatedly — a no-op fetch once it's cached. */
  async lookupDictionary(wordId: string, now: Date): Promise<Word> {
    return reviveWord(await send({ type: 'LOOKUP_DICTIONARY', payload: { wordId, now: now.toISOString() } }));
  },
  /** Edits term/translations/contextSentence — pass only what changed. */
  async updateWord(
    wordId: string,
    changes: { term?: string; translations?: string[]; contextSentence?: string },
    now: Date,
  ): Promise<Word> {
    return reviveWord(await send({ type: 'UPDATE_WORD', payload: { wordId, changes, now: now.toISOString() } }));
  },
  /** Checks a pasted license key against the API. Never rejects on an
   *  invalid/unknown key — { valid: false } is an everyday result. */
  async activateLicense(key: string) {
    return send({ type: 'ACTIVATE_LICENSE', payload: { key } });
  },
  /** PRACTICE MODE. Both of these run the on-device model in the background
   *  worker — see PRACTICE_AVAILABILITY in the protocol for why they can't
   *  just be called locally from the on-page card. */
  async practiceAvailability() {
    return send({ type: 'PRACTICE_AVAILABILITY', payload: {} });
  },
  async generatePracticeDrill(langTo: string, difficulty: DrillDifficulty) {
    return send({ type: 'PRACTICE_GENERATE', payload: { langTo, difficulty } });
  },
};

export type WordClient = typeof wordClient;
