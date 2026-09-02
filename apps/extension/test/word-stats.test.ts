import { describe, it, expect } from 'vitest';
import {
  computeWordStatsById,
  algoProgress,
  estimateReviewsToMastery,
  masteryProgress,
} from '../src/lib/review/word-stats';
import type { Word, ReviewLog } from '../src/lib/storage/types';

const NOW = new Date('2026-06-13T12:00:00Z');

function word(overrides: Omit<Partial<Word>, 'srsState'> & { srsState?: Partial<Word['srsState']> } = {}): Word {
  const { srsState, ...rest } = overrides;
  return {
    id: 'w1',
    term: 'fortitude',
    translations: ['стойкость'],
    langFrom: 'en',
    langTo: 'ru',
    contextSentence: '',
    sourceUrl: '',
    srsState: {
      algo: 'sm2', pace: 'aggressive', phase: 'review', stepIndex: 0,
      dueAt: NOW, intervalDays: 1, easeFactor: 2.5, repetitions: 1, lapses: 0,
      ...srsState,
    },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    shelvedAt: null,
    dictionary: null,
    dictionaryFetchedAt: null,
    ...rest,
  };
}

function log(wordId: string, grade: number): ReviewLog {
  return {
    id: `l${Math.random()}`,
    wordId,
    grade: grade as ReviewLog['grade'],
    mode: 'typing',
    direction: 'forward',
    reviewedAt: NOW,
  };
}

describe('computeWordStatsById', () => {
  it('groups logs per word and computes success/error rate', () => {
    const logs = [log('a', 5), log('a', 1), log('a', 3), log('a', 0), log('b', 4)];
    const stats = computeWordStatsById(logs);
    expect(stats.get('a')).toEqual({ total: 4, passed: 2, failed: 2, successRate: 50, errorRate: 50 });
    expect(stats.get('b')).toEqual({ total: 1, passed: 1, failed: 0, successRate: 100, errorRate: 0 });
  });

  it('a word with no logs simply has no entry', () => {
    const stats = computeWordStatsById([log('a', 5)]);
    expect(stats.get('nope')).toBeUndefined();
  });
});

describe('algoProgress', () => {
  it('Leitner: the 1-based box out of the ladder size', () => {
    expect(algoProgress(word({ srsState: { algo: 'leitner', stepIndex: 2 } }))).toEqual({ kind: 'box', step: 3, total: 6 });
  });
  it('SM-2 learning: the step', () => {
    expect(algoProgress(word({ srsState: { algo: 'sm2', phase: 'learning', stepIndex: 1 } })))
      .toEqual({ kind: 'learning', step: 2, total: 14 });
  });
  it('SM-2 relearning: the step', () => {
    expect(algoProgress(word({ srsState: { algo: 'sm2', phase: 'relearning', stepIndex: 0 } })))
      .toEqual({ kind: 'relearning', step: 1, total: 1 });
  });
  it('SM-2 review: the ease factor, rounded to 1 decimal', () => {
    expect(algoProgress(word({ srsState: { algo: 'sm2', phase: 'review', easeFactor: 2.3 } })))
      .toEqual({ kind: 'review', ease: 2.3 });
  });
  it("SM-2 learning: the 'total' reads the word's OWN pace, not a fixed config", () => {
    expect(algoProgress(word({ srsState: { algo: 'sm2', pace: 'gentle', phase: 'learning', stepIndex: 0 } })))
      .toEqual({ kind: 'learning', step: 1, total: 5 });
    expect(algoProgress(word({ srsState: { algo: 'sm2', pace: 'standard', phase: 'learning', stepIndex: 0 } })))
      .toEqual({ kind: 'learning', step: 1, total: 10 });
    expect(algoProgress(word({ srsState: { algo: 'sm2', pace: 'aggressive', phase: 'learning', stepIndex: 0 } })))
      .toEqual({ kind: 'learning', step: 1, total: 14 });
  });
});

describe('masteryProgress', () => {
  it('0 for a brand-new word, 1 once mastered', () => {
    expect(masteryProgress(word({ srsState: { phase: 'learning', stepIndex: 0, intervalDays: 0 } as Word['srsState'] }))).toBe(0);
    expect(masteryProgress(word({ srsState: { phase: 'review', intervalDays: 50 } as Word['srsState'] }))).toBe(1);
  });

  it('is already most of the way up before the word graduates', () => {
    // The whole point of measuring in REVIEWS not days: on the aggressive
    // ladder 14 of the 18 reviews happen before graduating, but only ~7 of
    // the ~88 days do. A day-based bar would read near-empty here, which is
    // exactly when the user has done the most work.
    const nearlyGraduated = word({
      srsState: { algo: 'sm2', pace: 'aggressive', phase: 'learning', stepIndex: 13, intervalDays: 0, easeFactor: 2.5 } as Word['srsState'],
    });
    expect(masteryProgress(nearlyGraduated)).toBeGreaterThan(0.6);
    expect(masteryProgress(nearlyGraduated)).toBeLessThan(1);
  });

  it('rises monotonically while stepping up the learning ladder', () => {
    const at = (stepIndex: number) => masteryProgress(word({
      srsState: { algo: 'sm2', pace: 'aggressive', phase: 'learning', stepIndex, intervalDays: 0, easeFactor: 2.5 } as Word['srsState'],
    }));
    const series = [0, 3, 7, 11, 13].map(at);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeGreaterThan(series[i - 1]!);
  });

  it('goes DOWN after a lapse, mirroring the interval it just lost', () => {
    // Progress is re-derived, never banked — same reversibility isMastered
    // has. A bar that only ever rose would be lying about the schedule.
    const before = word({ srsState: { algo: 'sm2', pace: 'aggressive', phase: 'review', stepIndex: 0, intervalDays: 16, easeFactor: 2.5 } as Word['srsState'] });
    const afterLapse = word({ srsState: { ...before.srsState, phase: 'relearning', intervalDays: 8, easeFactor: 1.9 } });
    expect(masteryProgress(afterLapse)).toBeLessThan(masteryProgress(before));
  });

  it('a harder word shows less progress than an easy one at the same step', () => {
    // Measured against its OWN journey at its current ease: low ease really
    // does mean more reviews left, so the bar should say so.
    const st = { algo: 'sm2', pace: 'aggressive', phase: 'review', stepIndex: 0, intervalDays: 3 } as Word['srsState'];
    const easy = word({ srsState: { ...st, easeFactor: 2.5 } });
    const hard = word({ srsState: { ...st, easeFactor: 1.3 } });
    expect(masteryProgress(hard)).toBeLessThan(masteryProgress(easy));
  });

  it('Leitner walks its boxes as an even fraction', () => {
    const atBox = (stepIndex: number) => masteryProgress(word({ srsState: { algo: 'leitner', stepIndex, intervalDays: 0 } as Word['srsState'] }));
    expect(atBox(0)).toBe(0);
    expect(atBox(5)).toBe(1); // last box === mastered for Leitner
    expect(atBox(2)).toBeGreaterThan(atBox(1));
  });

  it('always lands within 0..1, whatever state it is handed', () => {
    const weird = word({ srsState: { algo: 'sm2', pace: 'aggressive', phase: 'relearning', stepIndex: 0, intervalDays: 20, easeFactor: 1.3 } as Word['srsState'] });
    const p = masteryProgress(weird);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe('estimateReviewsToMastery', () => {
  it('Leitner: exact boxes remaining to the last box', () => {
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'leitner', stepIndex: 0 } }))).toBe(5);
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'leitner', stepIndex: 3 } }))).toBe(2);
  });
  it('Leitner: 0 once it has reached the last box (already mastered)', () => {
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'leitner', stepIndex: 5 } }))).toBe(0);
  });

  it('SM-2 review: 0 once the interval has already reached the mastery threshold', () => {
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'sm2', phase: 'review', intervalDays: 25 } }))).toBe(0);
  });
  it('SM-2 review: a positive estimate that shrinks as ease/interval grow', () => {
    const slow = estimateReviewsToMastery(word({ srsState: { algo: 'sm2', phase: 'review', intervalDays: 2, easeFactor: 1.3 } }));
    const fast = estimateReviewsToMastery(word({ srsState: { algo: 'sm2', phase: 'review', intervalDays: 2, easeFactor: 2.5 } }));
    expect(slow).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThan(0);
  });
  it('SM-2 still learning: counts the remaining steps plus the post-graduation projection', () => {
    const learning = estimateReviewsToMastery(word({ srsState: { algo: 'sm2', phase: 'learning', stepIndex: 0, easeFactor: 2.5 } }));
    const almostGraduated = estimateReviewsToMastery(word({ srsState: { algo: 'sm2', phase: 'learning', stepIndex: 2, easeFactor: 2.5 } }));
    expect(learning).toBeGreaterThan(almostGraduated);
  });
});
