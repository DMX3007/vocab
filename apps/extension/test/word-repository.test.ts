import 'fake-indexeddb/auto'; // gives Node a real in-memory IndexedDB
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { WordRepository } from '../src/lib/storage/word-repository';

// A fresh, isolated database per test so they never bleed into each other.
let repo: WordRepository;
let dbCounter = 0;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // wipe global IndexedDB state
  repo = new WordRepository(`vocabflow-test-${Date.now()}-${dbCounter++}`);
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
    await repo.recordReview(fresh.id, 5, 'typing', NOW); // graduates, due in days

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

describe('updateWord (translation only)', () => {
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
    // term and context are read-only — unchanged
    expect(updated.term).toBe('fortitude');
    expect(updated.contextSentence).toBe(sample.contextSentence);
  });
});

describe('recordReview', () => {
  it('advances the SRS state through the core scheduler and pushes dueAt forward', async () => {
    const w = await repo.saveWord(sample, NOW);
    const dueBefore = w.srsState.dueAt.getTime();
    const after = await repo.recordReview(w.id, 5, 'typing', NOW);
    expect(after.srsState.dueAt.getTime()).toBeGreaterThan(dueBefore);
    expect(after.srsState.repetitions).toBeGreaterThan(0);
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
