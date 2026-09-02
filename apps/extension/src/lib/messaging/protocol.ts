import type { SaveWordInput, ReviewMode, WireWord, WireReviewLog, WireSrsState } from '../storage/types';
import type { AlgoId, Direction, Grade, Pace } from '@vocably/core';
import type { AlgoFilter } from '../review/library';
import type { DrillDifficulty as PracticeDifficulty } from '../practice/drill';
import type { ModelAvailability } from '../practice/prompt-api';

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
  RECORD_REVIEW: { wordId: string; grade: Grade; mode: ReviewMode; direction: Direction; now: string };
  /** See WordRepository.correctReview's doc comment. */
  CORRECT_REVIEW: { wordId: string; preReviewState: WireSrsState; grade: Grade; reviewedAt: string; now: string };
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
  /** PRACTICE MODE (see lib/practice/prompt-api.ts). Generation lives in the
   *  background service worker for one hard reason: the Prompt API is only
   *  exposed to EXTENSION contexts, and the Practice card is drawn by a
   *  content script, which runs in the page's isolated world with no
   *  LanguageModel global at all. So the card asks, the worker generates. */
  PRACTICE_AVAILABILITY: Record<string, never>;
  PRACTICE_GENERATE: { langTo: string; difficulty: PracticeDifficulty };
};

export type ResponseMap = {
  SAVE_WORD: WireWord;
  GET_ALL_WORDS: WireWord[];
  GET_DUE_WORDS: WireWord[];
  COUNT_WORDS: number;
  RECORD_REVIEW: WireWord;
  CORRECT_REVIEW: WireWord;
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
  PRACTICE_AVAILABILITY: { availability: ModelAvailability; canTranslate: boolean };
  PRACTICE_GENERATE: PracticeDrill;
};

/** One generated phrase, already parsed and cleaned by the worker so the
 *  card renders data rather than raw model output. */
export interface PracticeDrill {
  english: string;
  /** The target-language rendering, or null when the model can't write that
   *  language (see MODEL_OUTPUT_LANGUAGES) or didn't return a usable line. */
  translated: string | null;
  /** The picked words' own saved translations — the cue used when the model
   *  can't write the target language. Correct by construction: they come
   *  from the user's own library. */
  cues: string[];
  /** Which library words the phrase was built from. */
  terms: string[];
}


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
  /** PRACTICE MODE: the popup asks the active tab to open the Practice card
   *  on the page, the same surface the review overlay uses. */
  | { type: "SHOW_PRACTICE"; langTo: string }
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "SHOW_STREAK_REMINDER"; streak: number; todayCount: number; dailyGoal: number }
  | AchievementUnlockedMessage

/** Content-script -> background, for coordinating who's allowed to show the
 *  review overlay right now — see background.ts's overlay lock. A separate
 *  channel from Message/RequestMap above (which the popup also uses):
 *  the handler needs sender.tab.id to know which tab is asking, which the
 *  generic request/response dispatch doesn't thread through, and popup
 *  requests wouldn't have one anyway (the popup isn't a tab). */
export type BackgroundCommand =
  | { type: "REQUEST_SHOW_OVERLAY"; langTo: string }
  | { type: "RELEASE_OVERLAY_LOCK" }

export type RequestShowOverlayResponse = { granted: boolean }

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
