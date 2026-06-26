import {
  gradeAnswer,
  pickDirection,
  type Direction,
  type GradeContext,
  type GradeResult,
  type Grade,
} from '@vocabflow/core';
import type { Word, ReviewMode } from '../storage/types';

// The session only needs these three methods. Both the real WordRepository
// (used in tests) and the messaging wordClient (used in the popup) satisfy
// this, so the session works the same in both worlds.
export interface SessionDataSource {
  getDueWords(now: Date, langTo: string): Promise<Word[]>;
  getAllWords(langTo: string): Promise<Word[]>;
  recordReview(wordId: string, grade: Grade, mode: ReviewMode, now: Date): Promise<Word>;
}

export type SessionMode = 'normal'; // 'intensive' (Yagodkin) arrives in its own loop

export interface SessionConfig {
  mode: SessionMode;
}

export interface SessionTuning {
  /** Soft cap so a big backlog doesn't dump 80 cards at once and burn the user out. */
  maxCards: number;
}

export const DEFAULT_SESSION_CONFIG: SessionTuning = {
  maxCards: 20,
};

/** One card as presented to the UI. */
export interface ReviewCard {
  wordId: string;
  term: string;
  direction: Direction;
  /** what the user sees */
  prompt: string;
  /** accepted answers for what we ask back */
  expected: string[];
  contextSentence: string;
  sourceUrl: string;
}

/**
 * Orchestrates one review session in NORMAL mode.
 *
 * It takes a SNAPSHOT of the due words at start(): a word failed during the
 * session goes to relearning and comes back in a FUTURE session, never
 * looping inside the current one. (Intensive/Yagodkin mode — drilling a word
 * repeatedly within a session — will be a separate mode in its own loop.)
 *
 * It deliberately knows nothing about browser tabs or interruption; a layer
 * above decides whether to start a session at all (canInterrupt).
 */
export class ReviewSession {
  private queue: Word[] = [];
  private index = 0;
  private started = false;

  constructor(
    private readonly repo: SessionDataSource,
    private readonly config: SessionConfig,
    private readonly rng: () => number = Math.random,
    private readonly tuning: SessionTuning = DEFAULT_SESSION_CONFIG,
  ) {}

  /** Builds the snapshot: due words of this language, most-overdue first, capped. */
  /** Builds the snapshot: due words of this language, most-overdue first, capped.
   *  With { includeAll } it queues every (non-deleted) word regardless of due
   *  date — used by the manual "force review" trigger for testing. */
  async start(
    langTo: string,
    now: Date,
    options: { includeAll?: boolean } = {},
  ): Promise<void> {
    const pool = options.includeAll
      ? await this.repo.getAllWords(langTo)
      : await this.repo.getDueWords(now, langTo);
    pool.sort((a, b) => a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime());
    this.queue = pool.slice(0, this.tuning.maxCards);
    this.index = 0;
    this.started = true;
  }

  get total(): number {
    return this.queue.length;
  }

  get remaining(): number {
    return Math.max(0, this.queue.length - this.index);
  }

  get isFinished(): boolean {
    return this.started && this.index >= this.queue.length;
  }

  get currentCard(): ReviewCard | null {
    if (this.isFinished) return null;
    const word = this.queue[this.index];
    if (!word) return null;
    return this.toCard(word);
  }

  /** Grades the answer, persists it (SRS + log), and advances to the next card. */
  async answer(text: string, context: GradeContext, now: Date): Promise<GradeResult> {
    if (this.isFinished) {
      throw new Error('Cannot answer: the session is already finished.');
    }
    const word = this.queue[this.index]!;
    const card = this.toCard(word);

    const result = gradeAnswer(text, card.expected, context);
    await this.repo.recordReview(word.id, result.grade, 'typing', now);

    this.index += 1;
    return result;
  }

  // ── internal ───────────────────────────────────────────────────
  private toCard(word: Word): ReviewCard {
    const direction = pickDirection(this.directionStats(word), this.rng);
    const translations = word.translations;

    // forward: show the term, ask for the translation.
    // reverse: show a translation, ask for the term.
    const prompt = direction === 'forward' ? word.term : (translations[0] ?? '');
    const expected = direction === 'forward' ? translations : [word.term];

    return {
      wordId: word.id,
      term: word.term,
      direction,
      prompt,
      expected,
      contextSentence: word.contextSentence,
      sourceUrl: word.sourceUrl,
    };
  }

  /**
   * Per-direction failure stats for the picker. The full version reads the
   * review log; for now we start neutral (50/50) — wiring real per-direction
   * history is a small follow-up once logs carry the direction.
   */
  private directionStats(_word: Word) {
    return {
      forward: { shown: 0, failed: 0 },
      reverse: { shown: 0, failed: 0 },
    };
  }
}
