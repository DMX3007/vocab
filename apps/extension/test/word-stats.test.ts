import { describe, it, expect } from 'vitest';
import {
  computeWordStatsById,
  algoProgress,
  estimateReviewsToMastery,
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
