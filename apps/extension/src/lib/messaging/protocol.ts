import type { SaveWordInput, ReviewMode, WireWord, WireReviewLog } from '../storage/types';
import type { AlgoId, Grade, Pace } from '@vocably/core';
import type { AlgoFilter } from '../review/library';

// Why this exists: in a Chrome extension the content script runs in the
// WEB PAGE's origin and the popup runs in the EXTENSION's origin. They do
// NOT share IndexedDB. So exactly ONE context — the background service
// worker — owns the database, and everyone else talks to it via messages.
// This file is the single source of truth for that message contract.

export type RequestMap = {
  SAVE_WORD: { input: SaveWordInput };
  GET_ALL_WORDS: { langTo: string };
  GET_DUE_WORDS: { langTo: string; now: string };
  COUNT_WORDS: { langTo: string };
  RECORD_REVIEW: { wordId: string; grade: Grade; mode: ReviewMode; now: string };
  GET_REVIEW_LOGS: { wordId: string };
  DELETE_WORD: { wordId: string; now: string };
  GET_ALL_LOGS: Record<string, never>;
  MOVE_WORDS_ALGO: { wordIds: string[]; algo: AlgoId; pace?: Pace; now: string };
  TRANSLATE: { term: string; langFrom: string; langTo: string };
  SHELVE_WORD: { wordId: string; now: string };
  UNSHELVE_WORD: { wordId: string; now: string };
  CLEAR_LIBRARY: { langTo: string; now: string };
  EXPORT_LIBRARY: Record<string, never>;
  LOOKUP_DICTIONARY: { wordId: string; now: string };
  UPDATE_WORD: {
    wordId: string;
    changes: { term?: string; translations?: string[]; contextSentence?: string };
    now: string;
  };
  ACTIVATE_LICENSE: { key: string };
};

export type ResponseMap = {
  SAVE_WORD: WireWord;
  GET_ALL_WORDS: WireWord[];
  GET_DUE_WORDS: WireWord[];
  COUNT_WORDS: number;
  RECORD_REVIEW: WireWord;
  GET_REVIEW_LOGS: unknown[];
  DELETE_WORD: null;
  GET_ALL_LOGS: WireReviewLog[];
  MOVE_WORDS_ALGO: WireWord[];
  TRANSLATE: string;
  SHELVE_WORD: WireWord;
  UNSHELVE_WORD: WireWord;
  CLEAR_LIBRARY: number;
  EXPORT_LIBRARY: WireWord[];
  LOOKUP_DICTIONARY: WireWord;
  UPDATE_WORD: WireWord;
  ACTIVATE_LICENSE: { valid: boolean; plan?: 'free' | 'premium'; limits?: { maxWords: number | null } };
};


export type MessageType = keyof RequestMap;

export type Message = {
  [K in keyof RequestMap]: { type: K, payload: RequestMap[K] }
}[keyof RequestMap]

/** Sent by background.ts after any action that could cross an achievement
 *  threshold (SAVE_WORD, RECORD_REVIEW) — every trigger path (the popup's
 *  Add Word modal, the in-page tooltip, the on-page review overlay) funnels
 *  through those two handlers, so this is computed exactly once regardless
 *  of where the action happened. Broadcast two ways: browser.runtime.sendMessage
 *  reaches the popup if it's open, browser.tabs.sendMessage(activeTabId, ...)
 *  reaches that tab's content script for an on-page toast — see
 *  Popup.tsx's message listener and content.ts's showAchievementToast. */
export type AchievementUnlockedMessage = { type: 'ACHIEVEMENT_UNLOCKED'; ids: string[] };

export type ContentCommand =
  | { type: "SHOW_OVERLAY"; langTo: string; algoFilter?: AlgoFilter }
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "SHOW_STREAK_REMINDER"; streak: number; todayCount: number; dailyGoal: number }
  | AchievementUnlockedMessage

/** Dates don't survive structured-clone messaging cleanly across all paths,
 *  so we serialize them as ISO strings and revive them on the receiving end. */
export type Wire<T> =
  // «если T — это Date → замени на string»
  T extends Date ? string
  // «если T — массив чего-то (infer U = вытащи это "что-то" в переменную U) → верни массив из Wire<U>». 
  : T extends Array<infer U> ? Array<Wire<U>>
  // «если T — объект → построй такой же объект, но каждое поле прогони через Wire»
  : T extends object ? { [K in keyof T]: Wire<T[K]> }
  // «иначе (число, строка, boolean) — оставь как есть». Wire<number> = number.
  : T;
