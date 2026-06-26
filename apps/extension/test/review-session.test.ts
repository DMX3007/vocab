import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('ReviewSession (normal mode)', () => {
  it('starts with a snapshot of due words for the active language', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    await save('virtues', 'добродетели', minutesAgo(20));

    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
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
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
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

  it('finishes when every card is answered', async () => {
    await save('a', 'а', minutesAgo(30));
    await save('b', 'б', minutesAgo(20));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    await session.answer('а', { latencyMs: 1000 }, NOW);
    expect(session.isFinished).toBe(false);
    await session.answer('б', { latencyMs: 1000 }, NOW);
    expect(session.isFinished).toBe(true);
    expect(session.currentCard).toBeNull();
  });

  it('start({ includeAll }) queues every word, even ones not yet due (manual review)', async () => {
    const fresh = await save('fortitude', 'стойкость', minutesAgo(30));
    await repo.recordReview(fresh.id, 5, 'typing', NOW); // push far into the future
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW, { includeAll: true });
    expect(session.total).toBe(1); // included despite not being due
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
