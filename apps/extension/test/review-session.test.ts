import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CONFIG } from '@vocably/core';
import { WordRepository } from '../src/lib/storage/word-repository';
import { ReviewSession, DEFAULT_SESSION_CONFIG, type SessionDataSource } from '../src/lib/review/session';
import type { ReviewLog } from '../src/lib/storage/types';

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
  repo = new WordRepository(`vocably-session-${Date.now()}-${dbCounter++}`);
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
      await repo.recordReview(repeat.id, 4, 'typing', 'forward', tenDaysAgo); // walk the full ladder to graduate, interval 1d
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

  it('REGRESSION: a badly-overdue word is not starved by words still walking the learning ladder', async () => {
    // The reported bug, end to end: words showed as due in the popup for
    // hours but never reached the card. Learning steps are ~25s apart, so
    // half-learned words re-enter the queue constantly; while they counted
    // as "fresh" they took absolute priority, and with one card graded per
    // session (maxCards) nothing past the learning phase ever came up.
    const overdue = await save('candor', 'откровенность', minutesAgo(60 * 24 * 30));
    const longAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60_000);
    for (let i = 0; i < DEFAULT_CONFIG.learningStepsSec.length; i++) {
      await repo.recordReview(overdue.id, 4, 'typing', 'forward', longAgo); // graduate it, then leave it overdue
    }

    // Three words mid-ladder: each answered once, so each is due again in ~25s.
    for (const term of ['alpha', 'beta', 'gamma']) {
      const w = await save(term, `${term}-ru`, minutesAgo(5));
      await repo.recordReview(w.id, 4, 'typing', 'forward', minutesAgo(5));
    }

    // Every one-card session, 30s apart — enough for the 25s steps to keep
    // re-qualifying, which is exactly what used to crowd the backlog out.
    const served: string[] = [];
    let clock = NOW;
    for (let i = 0; i < 6; i++) {
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', clock);
      const card = session.currentCard;
      if (!card) break;
      served.push(card.term);
      await session.answer(card.expected[0]!, { latencyMs: 1000 }, clock);
      clock = new Date(clock.getTime() + 30_000);
    }
    // It must come up promptly, not after the learning words cycle forever.
    expect(served).toContain('candor');
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

  describe('direction picking uses REAL history, not a fixed 50/50', () => {
    // rng=0.3 is the discriminating value here: with a genuinely neutral
    // 50/50 split (chanceOfForward=0.5), 0.3 < 0.5 -> 'forward'. Once the
    // word's real history skews hard toward reverse failing, chanceOfForward
    // drops well below 0.3 -> 'reverse'. A regression back to the old
    // hardcoded-neutral stats would make this test pick 'forward' again.
    const discriminatingRng = () => 0.3;

    it('a fresh word with no history still gets a neutral 50/50 (not skewed by default)', async () => {
      await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, discriminatingRng);
      await session.start('ru', NOW);
      expect(session.currentCard!.direction).toBe('forward');
    });

    it('weights toward whichever direction the word has actually been failed in', async () => {
      const w = await save('fortitude', 'стойкость', minutesAgo(30));
      // Reverse: failed every time. Forward: passed every time.
      for (let i = 0; i < 5; i++) await repo.recordReview(w.id, 1, 'typing', 'reverse', minutesAgo(20));
      for (let i = 0; i < 5; i++) await repo.recordReview(w.id, 4, 'typing', 'forward', minutesAgo(10));

      const session = new ReviewSession(repo, { mode: 'normal' }, discriminatingRng);
      await session.start('ru', NOW);
      // Same rng value that picked 'forward' with no history now picks
      // 'reverse' — real per-direction failure history is driving this,
      // not a coin flip on every card.
      expect(session.currentCard!.direction).toBe('reverse');
    });

    it('logs from before the `direction` field existed are skipped, not miscounted', async () => {
      const w = await save('fortitude', 'стойкость', minutesAgo(30));
      for (let i = 0; i < 5; i++) await repo.recordReview(w.id, 1, 'typing', 'reverse', minutesAgo(20));
      // Simulate legacy data: strip `direction` off the stored logs, and
      // proxy every other call straight through to the real repo.
      const legacyLogs = (await repo.getReviewLogs(w.id)).map((l) => {
        const { direction: _direction, ...rest } = l;
        return rest as unknown as ReviewLog;
      });
      const legacyRepo: SessionDataSource = {
        getDueWords: (...args) => repo.getDueWords(...args),
        getAllWords: (...args) => repo.getAllWords(...args),
        recordReview: (...args) => repo.recordReview(...args),
        correctReview: (...args) => repo.correctReview(...args),
        shelveWord: (...args) => repo.shelveWord(...args),
        getAllReviewLogs: async () => legacyLogs,
      };

      const session = new ReviewSession(legacyRepo, { mode: 'normal' }, discriminatingRng);
      await session.start('ru', NOW);
      // No usable direction on any log -> falls back to neutral, same as a
      // word with no history at all.
      expect(session.currentCard!.direction).toBe('forward');
    });
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

  it('defaults to "typing" mode, but records "voice" when the answer came from speech (ReviewCard\'s mic button)', async () => {
    const w = await save('fortitude', 'стойкость', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);
    await session.answer('стойкость', { latencyMs: 2000 }, NOW, 'voice');

    const logs = await repo.getReviewLogs(w.id);
    expect(logs[0]!.mode).toBe('voice');
  });

  it('a snapshot session does not re-queue a word failed during it', async () => {
    await save('fortitude', 'стойкость', minutesAgo(30));
    const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
    await session.start('ru', NOW);

    await session.answer('totally wrong', { latencyMs: 2000 }, NOW); // fail
    expect(session.isFinished).toBe(true); // the failed word does NOT reappear now
  });

  it('regression: grades against the exact card shown, even if a second dice roll would pick a different direction', async () => {
    // pickDirection() is called once inside toCard() to pick 'forward' vs
    // 'reverse'. If currentCard and answer() each called toCard() (and so
    // rng()) independently, a rng that returns a different value on its
    // second call could show the user one direction (e.g. reverse: the
    // Russian translation, expecting the English term) while grading
    // against the OTHER (forward: expecting the Russian translation) —
    // marking a genuinely correct answer wrong. Alternating 0.01/0.99
    // reproduces that mismatch if the card is ever recomputed mid-turn.
    await save('fortitude', 'стойкость', minutesAgo(30));
    let call = 0;
    const alternatingRng = () => (call++ % 2 === 0 ? 0.01 : 0.99);
    const session = new ReviewSession(repo, { mode: 'normal' }, alternatingRng);
    await session.start('ru', NOW);

    const shownCard = session.currentCard!;
    expect(shownCard.direction).toBe('forward'); // first roll: 0.01 -> forward
    expect(shownCard.expected).toEqual(['стойкость']);

    // Reading currentCard again must return the SAME card, not re-roll.
    expect(session.currentCard).toBe(shownCard);

    // Answering with what the shown (forward) card expects must be graded
    // correct — a second, independent toCard() call inside answer() would
    // have rolled 'reverse' (expected: ['fortitude']) and marked this wrong.
    const result = await session.answer('стойкость', { latencyMs: 1000 }, NOW);
    expect(result.verdict).toBe('correct');
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

  describe('markLastAnsweredCorrect', () => {
    it('is a no-op before any answer has happened', async () => {
      await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', NOW);
      await expect(session.markLastAnsweredCorrect(NOW)).resolves.toBeNull();
    });

    it('re-grades a wrongly-marked answer as correct, matching what a straight pass would have produced', async () => {
      const w = await save('fortitude', 'стойкость', minutesAgo(30));
      const session = new ReviewSession(repo, { mode: 'normal' }, forwardRng);
      await session.start('ru', NOW);

      const wrong = await session.answer('totally wrong', { latencyMs: 2000 }, NOW);
      expect(wrong.verdict).toBe('wrong');
      expect(session.lastAnsweredWord?.srsState.lapses).toBe(1);

      const corrected = await session.markLastAnsweredCorrect(new Date(NOW.getTime() + 5_000));
      expect(corrected?.verdict).toBe('correct');
      expect(session.lastAnsweredWord?.srsState.lapses).toBe(0); // the lapse never happened
      // A normal first-step pass, scheduled from the ORIGINAL answer time
      // (NOW) — not the correction time, and not stacked on the failed
      // review's already-reset stepIndex.
      expect(session.lastAnsweredWord?.srsState.dueAt.getTime()).toBe(NOW.getTime() + 25_000);

      const logs = await repo.getReviewLogs(w.id);
      expect(logs).toHaveLength(1); // corrected in place, not stacked
      expect(logs[0]!.grade).toBe(4);
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
    await repo.recordReview(fresh.id, 5, 'typing', 'forward', NOW); // advances a step, not due yet
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
