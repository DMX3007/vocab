import {
  gradeAnswer,
  pickDirection,
  type Direction,
  type GradeContext,
  type GradeResult,
  type Grade,
  type SrsState,
} from '@vocably/core';
import type { Word, ReviewMode } from '../storage/types';
import { sortForReview, type AlgoFilter } from './library';

// Grade awarded when the user overrides a "wrong" verdict to correct (see
// markLastAnsweredCorrect) — a normal pass, not GRADE_CORRECT_FAST (5):
// they're fixing a marking mistake, not claiming the extra confidence a
// perfect/instant answer would (5 skips ahead in scheduleLearning — see
// packages/core's sm2.ts — which a typo-correction shouldn't trigger).
const OVERRIDE_CORRECT_GRADE: Grade = 4;

// The session only needs these four methods. Both the real WordRepository
// (used in tests) and the messaging wordClient (used in the popup) satisfy
// this, so the session works the same in both worlds.
export interface SessionDataSource {
  getDueWords(now: Date, langTo: string): Promise<Word[]>;
  getAllWords(langTo: string): Promise<Word[]>;
  recordReview(wordId: string, grade: Grade, mode: ReviewMode, now: Date): Promise<Word>;
  /** See WordRepository.correctReview's doc comment. */
  correctReview(wordId: string, preReviewState: SrsState, grade: Grade, reviewedAt: Date, now: Date): Promise<Word>;
  shelveWord(wordId: string, now: Date): Promise<Word>;
}

export type SessionMode = 'normal'; // 'intensive' (Yagodkin) arrives in its own loop

export interface SessionConfig {
  mode: SessionMode;
}

export interface SessionTuning {
  /** How many words one "Review" click queues. Matches the live due list's
   *  one-at-a-time model: you get the single most-urgent word (see
   *  sortForReview — fresh words first, then most-overdue), answer it, and
   *  the session ends there rather than marching through a stacked batch. */
  maxCards: number;
}

export const DEFAULT_SESSION_CONFIG: SessionTuning = {
  maxCards: 1,
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
  /** language of `term` / language of the translations — lets the UI look
   *  up the right voice for pronunciation without threading Word around. */
  langFrom: string;
  langTo: string;
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
  // ALL sorted/filtered due candidates, uncapped — shuffle draws its
  // alternatives from here. `maxCards` only limits how many ever get
  // GRADED (via answeredCount below); it never limits how many candidates
  // are available to shuffle through before committing to one. Without
  // this split, maxCards: 1 (the default: one word per session) would
  // leave shuffle with nothing to switch to, since there'd be nothing
  // left in the pool once the single active card was taken.
  private pool: Word[] = [];
  private index = 0;
  private answeredCount = 0;
  private started = false;
  /** The card for the CURRENT index, computed once and reused — not
   *  recomputed on every read. toCard() rolls a random direction
   *  (pickDirection), so calling it twice for the same turn (once to show
   *  the card, again inside answer() to grade it) could roll two DIFFERENT
   *  directions: the user sees the Russian translation and correctly types
   *  the English term, but grading independently re-rolled "forward" and
   *  checked the answer against the translations instead — a real bug,
   *  not hypothetical. Caching the card the moment its turn starts and
   *  reusing it for both display and grading makes that impossible. */
  private currentCardCache: ReviewCard | null = null;
  /** The word just graded by answer(), post-update (fresh lapses/srsState) —
   *  lets the UI decide whether to suggest shelving it without threading a
   *  whole extra round-trip. Null before the first answer of the session. */
  private lastAnswered: Word | null = null;
  /** lastAnswered's SRS state from BEFORE that answer, plus the moment it
   *  was answered — captured alongside lastAnswered so markLastAnsweredCorrect
   *  can replay the scheduler from the same starting point recordReview used,
   *  instead of stacking a second review on top of the wrong one. */
  private lastAnsweredPreState: SrsState | null = null;
  private lastAnsweredAt: Date | null = null;

  constructor(
    private readonly repo: SessionDataSource,
    private readonly config: SessionConfig,
    private readonly rng: () => number = Math.random,
    private readonly tuning: SessionTuning = DEFAULT_SESSION_CONFIG,
  ) {}

  /** Builds the candidate pool: brand-new words first, then everything else
   *  most-overdue first (see sortForReview) — so a growing repeat backlog
   *  never crowds new words out. The pool itself is uncapped; only
   *  `total`/`remaining` (below) are capped at maxCards. With
   *  { includeAll } it pools every (non-deleted) word regardless of due
   *  date — used by the manual "force review" trigger for testing. With
   *  { algoFilter } set to a specific algorithm, only that algorithm's
   *  words are pooled — lets the popup start a session scoped to "just
   *  Leitner" or "just SM-2" instead of everything due. */
  async start(
    langTo: string,
    now: Date,
    options: { includeAll?: boolean; algoFilter?: AlgoFilter } = {},
  ): Promise<void> {
    const pool = options.includeAll
      ? await this.repo.getAllWords(langTo)
      : await this.repo.getDueWords(now, langTo);
    const filtered = !options.algoFilter || options.algoFilter === 'all'
      ? pool
      : pool.filter((w) => w.srsState.algo === options.algoFilter);
    this.pool = sortForReview(filtered);
    this.index = 0;
    this.answeredCount = 0;
    this.started = true;
    this.refreshCurrentCard();
  }

  get total(): number {
    return Math.min(this.pool.length, this.tuning.maxCards);
  }

  get remaining(): number {
    return Math.max(0, this.total - this.answeredCount);
  }

  get isFinished(): boolean {
    return this.started && (this.answeredCount >= this.tuning.maxCards || this.index >= this.pool.length);
  }

  /** Whether shuffle() would actually do anything right now — the UI uses
   *  this to disable the Shuffle button, rather than `remaining` (which is
   *  capped at maxCards and says nothing about how big the pool is). */
  get canShuffle(): boolean {
    return !this.isFinished && this.pool.length - this.index > 1;
  }

  get currentCard(): ReviewCard | null {
    return this.isFinished ? null : this.currentCardCache;
  }

  /** The word behind the verdict currently on screen — null until the
   *  first answer(). See shouldSuggestShelving in library.ts for how the
   *  UI uses this. */
  get lastAnsweredWord(): Word | null {
    return this.lastAnswered;
  }

  /** Swaps the current card for a different one from the pool. The skipped
   *  word is NOT graded and its SRS state doesn't change — it's simply
   *  deferred to a random later spot in the pool, so nothing is dropped,
   *  it just isn't what's shown right now. No-op once nothing else in the
   *  pool is left to switch to (regardless of maxCards). */
  shuffle(): void {
    if (this.isFinished) return;
    const remaining = this.pool.length - this.index;
    if (remaining <= 1) return;
    const [current] = this.pool.splice(this.index, 1);
    const otherCount = this.pool.length - this.index;
    const offset = 1 + Math.floor(this.rng() * otherCount);
    this.pool.splice(this.index + offset, 0, current!);
    this.refreshCurrentCard();
  }

  /** Grades the answer, persists it (SRS + log), and advances to the next
   *  card. Grades against currentCardCache.expected — the SAME card the
   *  user was just shown — never a freshly-recomputed one; see
   *  currentCardCache's comment for why that distinction matters. */
  async answer(text: string, context: GradeContext, now: Date): Promise<GradeResult> {
    if (this.isFinished) {
      throw new Error('Cannot answer: the session is already finished.');
    }
    const word = this.pool[this.index]!;
    const card = this.currentCardCache!;

    const result = gradeAnswer(text, card.expected, context);
    this.lastAnsweredPreState = word.srsState; // captured before recordReview mutates it
    this.lastAnsweredAt = now;
    this.lastAnswered = await this.repo.recordReview(word.id, result.grade, 'typing', now);

    this.index += 1;
    this.answeredCount += 1;
    this.refreshCurrentCard();
    return result;
  }

  /** Shelves the word behind the verdict currently on screen (see
   *  lastAnsweredWord) — a no-op if nothing's been answered yet. */
  async shelveLastAnswered(now: Date): Promise<void> {
    if (!this.lastAnswered) return;
    this.lastAnswered = await this.repo.shelveWord(this.lastAnswered.id, now);
  }

  /** The user is confident the just-graded "wrong" answer was actually
   *  right — a typo the SRS's own tolerance didn't happen to cover, most
   *  often. Re-grades it as a normal pass instead of stacking a second
   *  review on top of the wrong one (see WordRepository.correctReview). A
   *  no-op — returning null — before any answer, or once the last answer
   *  was already correct (nothing to fix). */
  async markLastAnsweredCorrect(now: Date): Promise<GradeResult | null> {
    if (!this.lastAnswered || !this.lastAnsweredPreState || !this.lastAnsweredAt) return null;

    this.lastAnswered = await this.repo.correctReview(
      this.lastAnswered.id,
      this.lastAnsweredPreState,
      OVERRIDE_CORRECT_GRADE,
      this.lastAnsweredAt,
      now,
    );
    return { verdict: 'correct', grade: OVERRIDE_CORRECT_GRADE };
  }

  // ── internal ───────────────────────────────────────────────────
  /** Recomputes currentCardCache from whatever's now at `index` — a fresh
   *  toCard() call (and so a fresh direction roll) is correct HERE, since
   *  it's a genuinely new turn. Called after every index/pool change:
   *  start(), answer() advancing, and shuffle() swapping the active word. */
  private refreshCurrentCard(): void {
    const word = this.pool[this.index];
    this.currentCardCache = word ? this.toCard(word) : null;
  }

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
      langFrom: word.langFrom,
      langTo: word.langTo,
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
