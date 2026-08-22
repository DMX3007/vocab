import 'fake-indexeddb/auto'; // gives Node a real in-memory IndexedDB
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CONFIG } from '@vocably/core';
import { WordRepository } from '../src/lib/storage/word-repository';

// A fresh, isolated database per test so they never bleed into each other.
let repo: WordRepository;
let dbCounter = 0;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // wipe global IndexedDB state
  repo = new WordRepository(`vocably-test-${Date.now()}-${dbCounter++}`);
  await repo.open();
});

const sample = {
  term: 'fortitude',
  translation: 'стойкость',
  contextSentence: 'He showed great fortitude during the crisis.',
  sourceUrl: 'https://evolveinc.io/post',
  langFrom: 'en',
  langTo: 'ru',
};

const NOW = new Date('2026-06-10T12:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('saveWord', () => {
  it('stores a word with a generated id, createdAt, and an initial SRS state due now', async () => {
    const saved = await repo.saveWord(sample, NOW);
    expect(saved.id).toBeTruthy();
    expect(saved.term).toBe('fortitude');
    expect(saved.translations).toEqual(['стойкость']);
    expect(saved.createdAt.getTime()).toBe(NOW.getTime());
    // a brand-new word is immediately reviewable
    expect(saved.srsState.dueAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(saved.srsState.phase).toBe('learning');
  });

  it('does NOT duplicate the same term+langTo: a second save updates the existing word', async () => {
    const first = await repo.saveWord(sample, NOW);
    const second = await repo.saveWord(
      { ...sample, translation: 'твёрдость духа' },
      later(1000),
    );
    expect(second.id).toBe(first.id); // same row
    const all = await repo.getAllWords('ru');
    expect(all).toHaveLength(1);
    // the new translation is merged in, the old one kept
    expect(all[0]!.translations).toContain('стойкость');
    expect(all[0]!.translations).toContain('твёрдость духа');
  });

  it('the SAME term in a DIFFERENT target language is a separate word', async () => {
    await repo.saveWord(sample, NOW);
    await repo.saveWord({ ...sample, langTo: 'de', translation: 'Standhaftigkeit' }, NOW);
    expect(await repo.getAllWords('ru')).toHaveLength(1);
    expect(await repo.getAllWords('de')).toHaveLength(1);
  });
});

describe('getDueWords (scoped to the active target language)', () => {
  it('returns only due words of the requested language', async () => {
    const ru = await repo.saveWord(sample, NOW);
    const es = await repo.saveWord(
      { ...sample, term: 'casa', translation: 'дом', langTo: 'es' },
      NOW,
    );
    const result = await repo.getDueWords(later(1000), 'ru');
    const ids = result.map((w) => w.id);
    expect(ids).toContain(ru.id);
    expect(ids).not.toContain(es.id); // other language never leaks in
  });

  it('returns only words whose dueAt has passed', async () => {
    const due = await repo.saveWord(sample, NOW);
    // push a second word into the future by reviewing it well
    const fresh = await repo.saveWord({ ...sample, term: 'alacrity', translation: 'рвение' }, NOW);
    await repo.recordReview(fresh.id, 5, 'typing', NOW); // advances a step, due in ~25s

    const result = await repo.getDueWords(later(1000), 'ru');
    const ids = result.map((w) => w.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(fresh.id);
  });

  it('excludes soft-deleted words', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.deleteWord(w.id, NOW);
    expect(await repo.getDueWords(later(1000), 'ru')).toHaveLength(0);
  });

  it('excludes shelved words, even though they are due', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.shelveWord(w.id, NOW);
    expect(await repo.getDueWords(later(1000), 'ru')).toHaveLength(0);
  });
});

describe('shelveWord / unshelveWord', () => {
  it('shelving hides a word from due, but it still shows up in the Library list', async () => {
    const w = await repo.saveWord(sample, NOW);
    const shelved = await repo.shelveWord(w.id, NOW);
    expect(shelved.shelvedAt?.getTime()).toBe(NOW.getTime());
    expect(await repo.getDueWords(later(1000), 'ru')).toHaveLength(0);
    const all = await repo.getAllWords('ru');
    expect(all.map((x) => x.id)).toContain(w.id);
  });

  it('unshelving clears shelvedAt and makes the word due right away, not whenever it was due before', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.shelveWord(w.id, NOW);
    const unshelved = await repo.unshelveWord(w.id, later(999_999));
    expect(unshelved.shelvedAt).toBeNull();
    expect(unshelved.srsState.dueAt.getTime()).toBe(later(999_999).getTime());
    expect(await repo.getDueWords(later(999_999), 'ru')).toHaveLength(1);
  });

  it('leaves algorithm progress untouched — shelving is not the same as resetting', async () => {
    const w = await repo.saveWord(sample, NOW);
    const reviewed = await repo.recordReview(w.id, 4, 'typing', NOW);
    const shelved = await repo.shelveWord(w.id, later(1000));
    expect(shelved.srsState.stepIndex).toBe(reviewed.srsState.stepIndex);
    const unshelved = await repo.unshelveWord(w.id, later(2000));
    expect(unshelved.srsState.stepIndex).toBe(reviewed.srsState.stepIndex);
  });

  it('throws for an id that does not exist', async () => {
    await expect(repo.shelveWord('nope', NOW)).rejects.toThrow();
    await expect(repo.unshelveWord('nope', NOW)).rejects.toThrow();
  });
});

describe('clearLibrary', () => {
  it('soft-deletes every live word of the given language and returns the count', async () => {
    await repo.saveWord(sample, NOW);
    await repo.saveWord({ ...sample, term: 'virtues', translation: 'добродетели' }, NOW);
    await repo.saveWord({ ...sample, term: 'casa', translation: 'дом', langTo: 'es' }, NOW);

    const cleared = await repo.clearLibrary('ru', later(1000));
    expect(cleared).toBe(2);
    expect(await repo.getAllWords('ru')).toHaveLength(0);
    expect(await repo.getAllWords('es')).toHaveLength(1); // a different language is untouched
  });

  it('leaves review logs intact — clearing the word list is not clearing history', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.recordReview(w.id, 4, 'typing', NOW);
    await repo.clearLibrary('ru', later(1000));
    expect(await repo.getReviewLogs(w.id)).toHaveLength(1);
  });

  it('is a no-op (returns 0) when the language has no live words', async () => {
    await repo.saveWord(sample, NOW);
    await repo.deleteWord((await repo.getAllWords('ru'))[0]!.id, NOW);
    expect(await repo.clearLibrary('ru', later(1000))).toBe(0);
  });

  it('already-shelved words get cleared too, not just the visibly-due ones', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.shelveWord(w.id, NOW);
    expect(await repo.clearLibrary('ru', later(1000))).toBe(1);
  });
});

describe('getAllWordsEverywhere', () => {
  it('spans every language, unlike getAllWords', async () => {
    await repo.saveWord(sample, NOW);
    await repo.saveWord({ ...sample, term: 'casa', translation: 'дом', langTo: 'es' }, NOW);
    const all = await repo.getAllWordsEverywhere();
    expect(all.map((w) => w.langTo).sort()).toEqual(['es', 'ru']);
  });

  it('excludes soft-deleted words', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.deleteWord(w.id, NOW);
    expect(await repo.getAllWordsEverywhere()).toHaveLength(0);
  });
});

describe('setDictionaryInfo', () => {
  const info = { partOfSpeech: 'noun', definition: 'Courage.', example: 'She showed fortitude.', phonetic: null };

  it('caches the lookup result and stamps dictionaryFetchedAt', async () => {
    const w = await repo.saveWord(sample, NOW);
    const updated = await repo.setDictionaryInfo(w.id, info, later(1000));
    expect(updated.dictionary).toEqual(info);
    expect(updated.dictionaryFetchedAt?.getTime()).toBe(later(1000).getTime());
  });

  it('also stamps dictionaryFetchedAt for a "nothing found" result (info: null)', async () => {
    const w = await repo.saveWord(sample, NOW);
    const updated = await repo.setDictionaryInfo(w.id, null, later(1000));
    expect(updated.dictionary).toBeNull();
    expect(updated.dictionaryFetchedAt).not.toBeNull();
  });

  it('leaves SRS progress and everything else untouched', async () => {
    const w = await repo.saveWord(sample, NOW);
    const reviewed = await repo.recordReview(w.id, 4, 'typing', NOW);
    const updated = await repo.setDictionaryInfo(w.id, info, later(1000));
    expect(updated.srsState).toEqual(reviewed.srsState);
  });

  it('throws for an id that does not exist', async () => {
    await expect(repo.setDictionaryInfo('nope', info, NOW)).rejects.toThrow();
  });
});

describe('getAllWords (scoped to the active target language)', () => {
  it('lists words of the requested language but hides soft-deleted ones', async () => {
    const a = await repo.saveWord(sample, NOW);
    await repo.saveWord({ ...sample, term: 'virtues', translation: 'добродетели' }, NOW);
    await repo.deleteWord(a.id, NOW);
    const all = await repo.getAllWords('ru');
    expect(all).toHaveLength(1);
    expect(all[0]!.term).toBe('virtues');
  });

  it('does not mix in words from other languages', async () => {
    await repo.saveWord(sample, NOW); // ru
    await repo.saveWord({ ...sample, term: 'casa', translation: 'дом', langTo: 'es' }, NOW);
    expect(await repo.getAllWords('ru')).toHaveLength(1);
    expect(await repo.getAllWords('es')).toHaveLength(1);
  });
});

describe('countWords (per language, for the dropdown badges)', () => {
  it('counts only non-deleted words of each language', async () => {
    await repo.saveWord(sample, NOW); // ru
    await repo.saveWord({ ...sample, term: 'virtues', translation: 'добродетели' }, NOW); // ru
    const es = await repo.saveWord({ ...sample, term: 'casa', translation: 'дом', langTo: 'es' }, NOW);
    await repo.deleteWord(es.id, NOW);
    expect(await repo.countWords('ru')).toBe(2);
    expect(await repo.countWords('es')).toBe(0);
  });
});

describe('updateWord', () => {
  it('replaces the translations and bumps updatedAt, without resetting SRS progress', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.recordReview(w.id, 4, 'typing', NOW); // advance SRS a bit
    const before = (await repo.getWord(w.id))!;

    const updated = await repo.updateWord(w.id, { translations: ['непреклонность'] }, later(5000));
    expect(updated.translations).toEqual(['непреклонность']);
    expect(updated.updatedAt.getTime()).toBe(later(5000).getTime());
    // SRS untouched: same phase/step as before the edit
    expect(updated.srsState.stepIndex).toBe(before.srsState.stepIndex);
    expect(updated.srsState.phase).toBe(before.srsState.phase);
    // fields not passed are left alone
    expect(updated.term).toBe('fortitude');
    expect(updated.contextSentence).toBe(sample.contextSentence);
  });

  it('edits the term alone', async () => {
    const w = await repo.saveWord(sample, NOW);
    const updated = await repo.updateWord(w.id, { term: 'resilience' }, later(1000));
    expect(updated.term).toBe('resilience');
    expect(updated.translations).toEqual([sample.translation]);
    expect(updated.contextSentence).toBe(sample.contextSentence);
  });

  it('edits the context sentence alone', async () => {
    const w = await repo.saveWord(sample, NOW);
    const updated = await repo.updateWord(w.id, { contextSentence: 'A new example.' }, later(1000));
    expect(updated.contextSentence).toBe('A new example.');
    expect(updated.term).toBe(sample.term);
    expect(updated.translations).toEqual([sample.translation]);
  });

  it('edits multiple fields at once', async () => {
    const w = await repo.saveWord(sample, NOW);
    const updated = await repo.updateWord(
      w.id,
      { term: 'resilience', translations: ['стойкость', 'выносливость'], contextSentence: 'A new example.' },
      later(1000),
    );
    expect(updated.term).toBe('resilience');
    expect(updated.translations).toEqual(['стойкость', 'выносливость']);
    expect(updated.contextSentence).toBe('A new example.');
  });

  it('clears the cached dictionary lookup when the term changes', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.setDictionaryInfo(w.id, { partOfSpeech: 'noun', definition: 'strength', example: null, phonetic: null }, NOW);

    const updated = await repo.updateWord(w.id, { term: 'resilience' }, later(1000));
    expect(updated.dictionary).toBeNull();
    expect(updated.dictionaryFetchedAt).toBeNull();
  });

  it('keeps the cached dictionary lookup when the term is unchanged', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.setDictionaryInfo(w.id, { partOfSpeech: 'noun', definition: 'strength', example: null, phonetic: null }, NOW);

    const updated = await repo.updateWord(w.id, { translations: ['непреклонность'] }, later(1000));
    expect(updated.dictionary).toEqual({ partOfSpeech: 'noun', definition: 'strength', example: null, phonetic: null });
    expect(updated.dictionaryFetchedAt).not.toBeNull();
  });

  it('keeps the cached dictionary lookup when the term is passed but identical', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.setDictionaryInfo(w.id, { partOfSpeech: 'noun', definition: 'strength', example: null, phonetic: null }, NOW);

    const updated = await repo.updateWord(w.id, { term: sample.term }, later(1000));
    expect(updated.dictionary).toEqual({ partOfSpeech: 'noun', definition: 'strength', example: null, phonetic: null });
  });
});

describe('recordReview', () => {
  it('advances the SRS state through the core scheduler and pushes dueAt forward', async () => {
    const w = await repo.saveWord(sample, NOW);
    const dueBefore = w.srsState.dueAt.getTime();
    const after = await repo.recordReview(w.id, 4, 'typing', NOW);
    expect(after.srsState.dueAt.getTime()).toBeGreaterThan(dueBefore);
    expect(after.srsState.stepIndex).toBeGreaterThan(0); // advanced within the learning ladder
  });

  it('appends an immutable review log entry (source of truth)', async () => {
    const w = await repo.saveWord(sample, NOW);
    await repo.recordReview(w.id, 4, 'typing', NOW);
    await repo.recordReview(w.id, 1, 'voice', later(60_000));
    const logs = await repo.getReviewLogs(w.id);
    expect(logs).toHaveLength(2);
    expect(logs[0]!.grade).toBe(4);
    expect(logs[0]!.mode).toBe('typing');
    expect(logs[1]!.mode).toBe('voice');
  });
});

describe('getAllReviewLogs (across every word and language, for Progress stats)', () => {
  it('returns every log, oldest first, regardless of word or language', async () => {
    const a = await repo.saveWord(sample, NOW);
    const b = await repo.saveWord(
      { ...sample, term: 'casa', translation: 'дом', langTo: 'es' },
      NOW,
    );
    await repo.recordReview(b.id, 5, 'typing', later(1000));
    await repo.recordReview(a.id, 3, 'typing', NOW);
    const logs = await repo.getAllReviewLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]!.wordId).toBe(a.id); // NOW comes before later(1000)
    expect(logs[1]!.wordId).toBe(b.id);
  });

  it('returns an empty array when nothing has been reviewed yet', async () => {
    await repo.saveWord(sample, NOW);
    expect(await repo.getAllReviewLogs()).toEqual([]);
  });
});

describe('per-word algorithm', () => {
  it('saveWord defaults new words to sm2, but honors an explicit algo', async () => {
    const sm2Word = await repo.saveWord(sample, NOW);
    expect(sm2Word.srsState.algo).toBe('sm2');

    const leitnerWord = await repo.saveWord({ ...sample, term: 'candor' }, NOW, 'leitner');
    expect(leitnerWord.srsState.algo).toBe('leitner');
  });

  it('recordReview schedules each word with ITS OWN algorithm', async () => {
    const sm2Word = await repo.saveWord(sample, NOW, 'sm2');
    const leitnerWord = await repo.saveWord({ ...sample, term: 'candor' }, NOW, 'leitner');

    const afterSm2 = await repo.recordReview(sm2Word.id, 4, 'typing', NOW);
    const afterLeitner = await repo.recordReview(leitnerWord.id, 4, 'typing', NOW);

    expect(afterSm2.srsState.algo).toBe('sm2');
    expect(afterLeitner.srsState.algo).toBe('leitner');
    // A single grade-4 review: SM-2 takes it through a learning STEP (still
    // phase 'learning', no interval yet), while Leitner promotes it straight
    // to box 2 (a 2-day interval) — proof the repo dispatched to two
    // different schedulers, not one shared instance.
    expect(afterSm2.srsState.phase).toBe('learning');
    expect(afterSm2.srsState.intervalDays).toBe(0);
    expect(afterLeitner.srsState.intervalDays).toBe(2);
  });

  describe('moveWordsAlgo', () => {
    it('switches the algorithm and resets progress to fresh/due-now', async () => {
      let w = await repo.saveWord(sample, NOW, 'sm2');
      for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
        w = await repo.recordReview(w.id, 4, 'typing', NOW); // walk the full learning ladder to graduate
      }
      expect(w.srsState.intervalDays).toBeGreaterThan(0);

      const [moved] = await repo.moveWordsAlgo([w.id], 'leitner', later(1000));
      expect(moved!.srsState.algo).toBe('leitner');
      expect(moved!.srsState.intervalDays).toBe(0); // fresh, like a brand-new word
      expect(moved!.srsState.dueAt.getTime()).toBeLessThanOrEqual(later(1000).getTime());
      // term/translations/context are untouched
      expect(moved!.term).toBe('fortitude');
      expect(moved!.translations).toEqual(['стойкость']);
    });

    it('moves several words in one call', async () => {
      const a = await repo.saveWord(sample, NOW, 'sm2');
      const b = await repo.saveWord({ ...sample, term: 'candor' }, NOW, 'sm2');
      const moved = await repo.moveWordsAlgo([a.id, b.id], 'leitner', later(1000));
      expect(moved).toHaveLength(2);
      expect(moved.every((w) => w.srsState.algo === 'leitner')).toBe(true);
    });

    it('silently skips ids that do not exist', async () => {
      const a = await repo.saveWord(sample, NOW, 'sm2');
      const moved = await repo.moveWordsAlgo([a.id, 'nope'], 'leitner', later(1000));
      expect(moved).toHaveLength(1);
    });
  });
});
