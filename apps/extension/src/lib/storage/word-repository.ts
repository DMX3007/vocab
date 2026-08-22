import Dexie, { type Table } from 'dexie';
import {
  createScheduler,
  initialState,
  DEFAULT_CONFIG,
  type AlgoId,
  type Grade,
  type SrsAlgorithm,
} from '@vocabflow/core';
import type { DictionaryInfo, ReviewLog, ReviewMode, SaveWordInput, Word } from './types';

// A tiny id generator. crypto.randomUUID exists in extension contexts and
// in modern Node; client-generated ids let a word exist before any network.
const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Every word carries its OWN algorithm (word.srsState.algo), so a review
// picks its scheduler from this registry rather than the repo running one
// fixed algorithm for everything.
const schedulers: Record<AlgoId, SrsAlgorithm> = {
  sm2: createScheduler('sm2', DEFAULT_CONFIG),
  leitner: createScheduler('leitner'),
};

/**
 * The word repository: the only thing that talks to IndexedDB.
 * It is intentionally "dumb storage" — it never decides WHICH word to show
 * next or which language is active; callers pass the language in. Higher
 * layers (the review orchestrator, the popup) make those decisions.
 */
export class WordRepository {
  private db: Dexie & {
    words: Table<Word, string>;
    reviewLogs: Table<ReviewLog, string>;
  };

  constructor(databaseName = 'vocabflow') {
    this.db = new Dexie(databaseName) as typeof this.db;
    this.db.version(1).stores({
      // Indexed fields only. deletedAt is NOT indexed: IndexedDB can't index
      // null, and live words store null there — we filter it in memory.
      words: 'id, langTo',
      reviewLogs: 'id, wordId',
    });
  }

  open(): Promise<Dexie> {
    return this.db.open();
  }

  /** Saves a selection. If the same term+langTo already exists, merges into it.
   *  `algo` picks the scheduler for a brand-new word only — merging into an
   *  existing word never touches its algorithm or progress. */
  async saveWord(input: SaveWordInput, now: Date, algo: AlgoId = 'sm2'): Promise<Word> {
    const existing = await this.findLive(input.term, input.langTo);

    if (existing) {
      // Don't create a duplicate card — add the new translation if it's new.
      const translations = existing.translations.includes(input.translation)
        ? existing.translations
        : [...existing.translations, input.translation];
      const updated: Word = { ...existing, translations, updatedAt: now };
      await this.db.words.put(updated);
      return updated;
    }

    const word: Word = {
      id: newId(),
      term: input.term,
      translations: [input.translation],
      langFrom: input.langFrom,
      langTo: input.langTo,
      contextSentence: input.contextSentence,
      sourceUrl: input.sourceUrl,
      srsState: initialState(algo, now), // brand-new word is due immediately
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      shelvedAt: null,
      dictionary: null,
      dictionaryFetchedAt: null,
    };
    await this.db.words.add(word);
    return word;
  }

  getWord(id: string): Promise<Word | undefined> {
    return this.db.words.get(id);
  }

  /** Due words of ONE language: dueAt passed, not deleted, not shelved.
   *  `!w.shelvedAt` (not `=== null`) also treats a pre-migration row that
   *  never got the field at all as not-shelved. */
  async getDueWords(now: Date, langTo: string): Promise<Word[]> {
    const words = await this.liveWordsOf(langTo);
    return words.filter((w) => !w.shelvedAt && w.srsState.dueAt.getTime() <= now.getTime());
  }

  /** All words of ONE language (for the Library tab), newest first. */
  async getAllWords(langTo: string): Promise<Word[]> {
    const words = await this.liveWordsOf(langTo);
    return words.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Count of live words of a language (for the language-dropdown badges). */
  async countWords(langTo: string): Promise<number> {
    return (await this.liveWordsOf(langTo)).length;
  }

  /** Every live word across every language, full fidelity — for a JSON
   *  export/backup, not scoped to whatever language happens to be active. */
  async getAllWordsEverywhere(): Promise<Word[]> {
    const words = await this.db.words.toArray();
    return words.filter((w) => w.deletedAt === null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Soft-deletes every live word of ONE language — "Clear library".
   *  Review logs are untouched, same as deleteWord: Progress stats and
   *  earned XP/streak history survive a clear. Returns how many were
   *  cleared, for the confirmation UI. */
  async clearLibrary(langTo: string, now: Date): Promise<number> {
    const words = await this.liveWordsOf(langTo);
    await this.db.transaction('rw', this.db.words, async () => {
      for (const word of words) {
        await this.db.words.put({ ...word, deletedAt: now, updatedAt: now });
      }
    });
    return words.length;
  }

  /** Edits the translations only. Term, context and SRS progress are untouched. */
  async updateWord(
    id: string,
    changes: { translations: string[] },
    now: Date,
  ): Promise<Word> {
    const word = await this.db.words.get(id);
    if (!word) throw new Error(`Word not found: ${id}`);
    const updated: Word = { ...word, translations: changes.translations, updatedAt: now };
    await this.db.words.put(updated);
    return updated;
  }

  /** Soft delete: mark deletedAt, keep the row for future sync. */
  async deleteWord(id: string, now: Date): Promise<void> {
    const word = await this.db.words.get(id);
    if (!word) return;
    await this.db.words.put({ ...word, deletedAt: now, updatedAt: now });
  }

  /** Sets a word aside: excluded from getDueWords (and so from review)
   *  until unshelveWord brings it back. SRS progress is untouched — its
   *  due date just stops being checked while shelved. */
  async shelveWord(id: string, now: Date): Promise<Word> {
    const word = await this.db.words.get(id);
    if (!word) throw new Error(`Word not found: ${id}`);
    const updated: Word = { ...word, shelvedAt: now, updatedAt: now };
    await this.db.words.put(updated);
    return updated;
  }

  /** Brings a shelved word back into rotation, due immediately rather than
   *  dumping however much backlog built up while it was set aside. */
  async unshelveWord(id: string, now: Date): Promise<Word> {
    const word = await this.db.words.get(id);
    if (!word) throw new Error(`Word not found: ${id}`);
    const updated: Word = {
      ...word,
      shelvedAt: null,
      srsState: { ...word.srsState, dueAt: now },
      updatedAt: now,
    };
    await this.db.words.put(updated);
    return updated;
  }

  /** Caches a dictionary lookup result (or the fact that none was found —
   *  info may be null). The actual fetch happens in background.ts, not
   *  here: this repo is dumb storage and makes no network calls. */
  async setDictionaryInfo(id: string, info: DictionaryInfo | null, now: Date): Promise<Word> {
    const word = await this.db.words.get(id);
    if (!word) throw new Error(`Word not found: ${id}`);
    const updated: Word = { ...word, dictionary: info, dictionaryFetchedAt: now, updatedAt: now };
    await this.db.words.put(updated);
    return updated;
  }

  /** Records a review: advance SRS via the core scheduler + append a log. */
  async recordReview(
    wordId: string,
    grade: Grade,
    mode: ReviewMode,
    now: Date,
  ): Promise<Word> {
    const word = await this.db.words.get(wordId);
    if (!word) throw new Error(`Word not found: ${wordId}`);

    const srsState = schedulers[word.srsState.algo].schedule(word.srsState, grade, now);
    const updated: Word = { ...word, srsState, updatedAt: now };

    await this.db.transaction('rw', this.db.words, this.db.reviewLogs, async () => {
      await this.db.words.put(updated);
      await this.db.reviewLogs.add({
        id: newId(),
        wordId,
        reviewedAt: now,
        mode,
        grade,
      });
    });
    return updated;
  }

  /** Switches one or more words onto a different algorithm. There's no honest way to
   *  convert an ease factor into a Leitner box (or back), so progress resets: the
   *  word starts fresh under the new algorithm, due immediately. */
  async moveWordsAlgo(ids: string[], algo: AlgoId, now: Date): Promise<Word[]> {
    return this.db.transaction('rw', this.db.words, async () => {
      const updated: Word[] = [];
      for (const id of ids) {
        const word = await this.db.words.get(id);
        if (!word) continue;
        const next: Word = { ...word, srsState: initialState(algo, now), updatedAt: now };
        await this.db.words.put(next);
        updated.push(next);
      }
      return updated;
    });
  }

  /** Review history of a word, oldest first. */
  async getReviewLogs(wordId: string): Promise<ReviewLog[]> {
    const logs = await this.db.reviewLogs.where('wordId').equals(wordId).toArray();
    return logs.sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
  }

  /** Every review ever logged, across all words and languages — the raw material for Progress stats. */
  async getAllReviewLogs(): Promise<ReviewLog[]> {
    const logs = await this.db.reviewLogs.toArray();
    return logs.sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
  }

  // ── internal helpers ───────────────────────────────────────────
  private async liveWordsOf(langTo: string): Promise<Word[]> {
    const words = await this.db.words.where('langTo').equals(langTo).toArray();
    return words.filter((w) => w.deletedAt === null);
  }

  private async findLive(term: string, langTo: string): Promise<Word | undefined> {
    const candidates = await this.liveWordsOf(langTo);
    return candidates.find((w) => w.term === term);
  }
}
