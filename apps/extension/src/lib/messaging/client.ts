import type { SaveWordInput, Word, ReviewMode } from '../storage/types';
import type { Grade } from '@vocabflow/core';
import type { Message, ResponseMap, MessageType } from './protocol';
import { reviveWord, reviveWords } from './revive';

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
  async recordReview(wordId: string, grade: Grade, mode: ReviewMode, now: Date): Promise<Word> {
    return reviveWord(
      (await send({ type: 'RECORD_REVIEW', payload: { wordId, grade, mode, now: now.toISOString() } })),
    );
  },
};

export type WordClient = typeof wordClient;
