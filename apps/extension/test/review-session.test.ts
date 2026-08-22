import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CONFIG } from '@vocabflow/core';
import { WordRepository } from '../src/lib/storage/word-repository';
import { ReviewSession, DEFAULT_SESSION_CONFIG } from '../src/lib/review/session';

// The orchestrator glues the building blocks into one flow:
//   repository (which words are due) + core (direction, grading, scheduling).
// It does NOT know about browser tabs or interruption — that lives a layer
// above and decides merely whether to START a session.

let repo: WordRepository;
let dbCounter = 0;
const NOW = new Date('2026-06-10T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repo = new WordRepository(`vocabflow-session-${Date.now()}-${dbCounter++}`);
  await repo.open();
});

const save = (term: string, translation: string, createdAt: Date) =>
  repo.saveWord(
    { term, translation, contextSentence: `…${term}…`, sourceUrl: 'u', langFrom: 'en', langTo: 'ru' },
    createdAt,
  );

// rng that always picks 'forward' so card direction is deterministic in tests
const forwardRng = () => 0.0;

// The product default is one word per session (see DEFAULT_SESSION_CONFIG);
// tests that exercise multi-card queue mechanics — ordering, advancing,
// shuffling — opt into a bigger batch explicitly rather than relying on it.
const multiCardTuning = { maxCards: 20 };

describe('ReviewSession (normal mode)', () => {
  it('defaults to just the single most-urgent due word, not the whole backlog', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    await save('virtues', 'добродетели', minutesAgo(20));

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    expect(session.total).toBe(1);
    expect(session.currentCard!.term).toBe('fortitude'); // most-overdue of the two
  });

  it('starts with a snapshot of due words for the active language', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    await save('virtues', 'добродетели', minutesAgo(20));

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng, multiCardTuning);
    await session.start('ru', NOW);

    expect(session.total).toBe(2);
    expect(session.remaining).toBe(2);
    expect(session.isFinished).toBe(false);
  });

  it('serves cards most-overdue first', async () => {
    await save('newer', 'новее', minutesAgo(5));
    await save('older', 'старее', minutesAgo(90)); // waited longest -> first

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    expect(session.currentCard!.term).toBe('older');
  });

  it('prioritizes brand-new words ahead of the repeat backlog, even when the backlog is far more overdue', async () => {
    // A word that already graduated review and is now badly overdue —
    // "ordered" repeat material with a long history behind it.
    const repeat = await save('candor', 'откровенность', minutesAgo(60 * 24 * 30));
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60_000);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
      await repo.recordReview(repeat.id, 4, 'typing', tenDaysAgo); // walk the full ladder to graduate, interval 1d
    }
    const graduated = (await repo.getWord(repeat.id))!;
    expect(graduated.srsState.intervalDays).toBeGreaterThan(0); // confirms it's "repeat", not fresh
    expect(graduated.srsState.dueAt.getTime()).toBeLessThan(NOW.getTime()); // and well overdue by now

    // A word that was just added — barely due, never reviewed.
    await save('fortitude', 'стойкость', minutesAgo(1));

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    expect(session.currentCard!.term).toBe('fortitude'); // new word wins despite being far less overdue
    expect(session.total).toBe(1); // with the default one-card cap, the repeat word doesn't even get queued
  });

  it('each card exposes a direction and what to show vs. what to ask', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    const card = session.currentCard!;
    expect(card.direction).toBe('forward'); // forced by forwardRng
    expect(card.prompt).toBe('fortitude'); // forward: show the term...
    expect(card.expected).toEqual(['стойкость']); // ...ask for the translation
  });

  it('reverse direction swaps prompt and expected answer', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    const reverseRng = () => 0.99;
    const session = new ReviewSession(repo, { mode: 'normal' }, reverseRng);
    await session.start('ru', NOW);

    const card = session.currentCard!;
    expect(card.direction).toBe('reverse');
    expect(card.prompt).toBe('стойкость'); // reverse: show the translation...
    expect(card.expected).toEqual(['fortitude']); // ...ask for the term
  });

  it('answering grades the response and advances to the next card', async () => {
    await save('older', 'старее', minutesAgo(90));
    await save('newer', 'новее', minutesAgo(5));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng, multiCardTuning);
    await session.start('ru', NOW);

    const result = await session.answer('старее', { latencyMs: 2000 }, NOW);
    expect(result.verdict).toBe('correct');
    expect(session.remaining).toBe(1);
    expect(session.currentCard!.term).toBe('newer');
  });

  it('persists each answer: SRS advances and a review log is written', async () => {
    const w = await save('fortitude', 'стойкость', minutesAgo(30));
    const dueBefore = w.srsState.dueAt.getTime();
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);
    await session.answer('стойкость', { latencyMs: 2000 }, NOW);

    const stored = (await repo.getWord(w.id))!;
    expect(stored.srsState.dueAt.getTime()).toBeGreaterThan(dueBefore);
    expect(await repo.getReviewLogs(w.id)).toHaveLength(1);
  });

  it('a snapshot session does not re-queue a word failed during it', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    await session.answer('totally wrong', { latencyMs: 2000 }, NOW); // fail
    expect(session.isFinished).toBe(true); // the failed word does NOT reappear now
  });

  describe('lastAnsweredWord / shelveLastAnswered', () => {
    it('is null before the first answer', async () => {
      await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', NOW);
      expect(session.lastAnsweredWord).toBeNull();
    });

    it('holds the just-graded word, with its post-answer SRS state', async () => {
      const w = await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', NOW);
      await session.answer('totally wrong', { latencyMs: 2000 }, NOW);
      expect(session.lastAnsweredWord?.id).toBe(w.id);
      expect(session.lastAnsweredWord?.srsState.lapses).toBe(1); // a miss counts as a lapse
    });

    it('shelveLastAnswered shelves the just-graded word and it stops showing up as due', async () => {
      const w = await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', NOW);
      await session.answer('totally wrong', { latencyMs: 2000 }, NOW);

      await session.shelveLastAnswered(NOW);
      expect(session.lastAnsweredWord?.shelvedAt).not.toBeNull();
      const stored = await repo.getWord(w.id);
      expect(stored?.shelvedAt).not.toBeNull();
      expect(await repo.getDueWords(minutesAgo(-1000), 'ru')).toHaveLength(0);
    });

    it('is a no-op before any answer has happened', async () => {
      await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', NOW);
      await expect(session.shelveLastAnswered(NOW)).resolves.toBeUndefined();
    });
  });

  it('shuffle() swaps the current card for a different one, without grading or dropping it', async () => {
    const a = await save('fortitude', 'стойкость', minutesAgo(30));
    await save('candor', 'откровенность', minutesAgo(20));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng, multiCardTuning);
    await session.start('ru', NOW);

    expect(session.currentCard!.wordId).toBe(a.id); // most-overdue first, as usual
    session.shuffle();
    expect(session.currentCard!.wordId).not.toBe(a.id); // a different word is now showing
    expect(session.total).toBe(2); // still both queued
    expect(session.remaining).toBe(2); // nothing was answered

    // the skipped word wasn't dropped — it resurfaces later in the same session
    await session.answer('откровенность', { latencyMs: 1000 }, NOW);
    expect(session.currentCard!.wordId).toBe(a.id);
    expect((await repo.getReviewLogs(a.id))).toHaveLength(0); // never graded by the shuffle itself
  });

  it('shuffle() works under the default one-word-per-session cap, as long as more than one word is due', async () => {
    // Regression: maxCards: 1 must not leave shuffle with nothing to swap
    // to just because only one card is ever GRADED per session — the pool
    // of candidates it can shuffle through is separate from that cap.
    const a = await save('fortitude', 'стойкость', minutesAgo(30));
    await save('candor', 'откровенность', minutesAgo(20));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng); // default tuning: maxCards 1

    await session.start('ru', NOW);
    expect(session.total).toBe(1); // still just one word gets graded...
    expect(session.canShuffle).toBe(true); // ...but shuffle has another candidate to offer
    expect(session.currentCard!.wordId).toBe(a.id);

    session.shuffle();
    expect(session.currentCard!.wordId).not.toBe(a.id); // swapped to the other due word
    expect(session.total).toBe(1); // the one-word cap itself is unaffected by shuffling
  });

  it('shuffle() is a no-op with only one card left (nothing else to switch to)', async () => {
    const a = await save('fortitude', 'стойкость', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    session.shuffle();
    expect(session.currentCard!.wordId).toBe(a.id);
    expect(session.total).toBe(1);
  });

  it('shuffle() is a no-op once the session is finished', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);
    await session.answer('стойкость', { latencyMs: 1000 }, NOW);

    expect(session.isFinished).toBe(true);
    expect(() => session.shuffle()).not.toThrow();
    expect(session.currentCard).toBeNull();
  });

  it('finishes when every card is answered', async () => {
    await save('a', 'а', minutesAgo(30));
    await save('b', 'б', minutesAgo(20));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng, multiCardTuning);
    await session.start('ru', NOW);

    await session.answer('а', { latencyMs: 1000 }, NOW);
    expect(session.isFinished).toBe(false);
    await session.answer('б', { latencyMs: 1000 }, NOW);
    expect(session.isFinished).toBe(true);
    expect(session.currentCard).toBeNull();
  });

  it('start({ includeAll }) queues every word, even ones not yet due (manual review)', async () => {
    const fresh = await save('fortitude', 'стойкость', minutesAgo(30));
    await repo.recordReview(fresh.id, 5, 'typing', NOW); // advances a step, not due yet
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW, { includeAll: true });
    expect(session.total).toBe(1); // included despite not being due
  });

  it('start({ algoFilter }) only queues due words on that algorithm', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30)); // sm2 (default)
    await repo.saveWord(
      { term: 'candor', translation: 'откровенность', contextSentence: '…', sourceUrl: 'u', langFrom: 'en', langTo: 'ru' },
      minutesAgo(20),
      'leitner',
    );

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW, { algoFilter: 'leitner' });
    expect(session.total).toBe(1);
    expect(session.currentCard?.term).toBe('candor');
  });

  it('start({ algoFilter: "all" }) (or omitted) queues every due word regardless of algorithm', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    await repo.saveWord(
      { term: 'candor', translation: 'откровенность', contextSentence: '…', sourceUrl: 'u', langFrom: 'en', langTo: 'ru' },
      minutesAgo(20),
      'leitner',
    );

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng, multiCardTuning);
    await session.start('ru', NOW, { algoFilter: 'all' });
    expect(session.total).toBe(2);
  });

  it('caps the session at maxCards, leaving the rest for next time', async () => {
    for (let i = 0; i < DEFAULT_SESSION_CONFIG.maxCards + 5; i++) {
      await save(`w${i}`, `п${i}`, minutesAgo(100 - i));
    }
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);
    expect(session.total).toBe(DEFAULT_SESSION_CONFIG.maxCards);
  });

  it('answering after the session is finished throws (guard against misuse)', async () => {
    await save('a', 'а', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);
    await session.answer('а', { latencyMs: 1000 }, NOW);
    await expect(session.answer('x', { latencyMs: 1000 }, NOW)).rejects.toThrow();
  });
});
