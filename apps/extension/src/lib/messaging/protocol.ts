import type { SaveWordInput, ReviewMode, WireWord } from '../storage/types';
import type { Grade } from '@vocabflow/core';

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
};

export type ResponseMap = {
  SAVE_WORD: WireWord;
  GET_ALL_WORDS: WireWord[];
  GET_DUE_WORDS: WireWord[];
  COUNT_WORDS: number;
  RECORD_REVIEW: WireWord;
  GET_REVIEW_LOGS: unknown[];
};


export type MessageType = keyof RequestMap;

export type Message = {
  [K in keyof RequestMap]: { type: K, payload: RequestMap[K] }
}[keyof RequestMap]

export type ContentCommand = | { type: "SHOW_OVERLAY"; langTo: string } | { type: "GET_PAGE_CONTEXT" }

/** Dates don't survive structured-clone messaging cleanly across all paths,
 *  so we serialize them as ISO strings and revive them on the receiving end. */
export type Wire<T> = T extends Date
  ? string
  : T extends Array<infer U>
  ? Array<Wire<U>>
  : T extends object
  ? { [K in keyof T]: Wire<T[K]> }
  : T;
