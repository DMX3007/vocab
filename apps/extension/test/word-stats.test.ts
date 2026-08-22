import { describe, it, expect } from 'vitest';
import {
  computeWordStatsById,
  algoProgressLabel,
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
      algo: 'sm2', phase: 'review', stepIndex: 0,
      dueAt: NOW, intervalDays: 1, easeFactor: 2.5, repetitions: 1, lapses: 0,
      ...srsState,
    },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    shelvedAt: null,
    ...rest,
  };
}

function log(wordId: string, grade: number): ReviewLog {
  return { id: `l${Math.random()}`, wordId, grade: grade as ReviewLog['grade'], mode: 'typing', reviewedAt: NOW };
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

describe('algoProgressLabel', () => {
  it('Leitner: shows the 1-based box out of the ladder size', () => {
    expect(algoProgressLabel(word({ srsState: { algo: 'leitner', stepIndex: 2 } }))).toBe('Box 3/5');
  });
  it('SM-2 learning: shows the step', () => {
    expect(algoProgressLabel(word({ srsState: { algo: 'sm2', phase: 'learning', stepIndex: 1 } }))).toBe('Learning · step 2/9');
  });
  it('SM-2 relearning: shows the step', () => {
    expect(algoProgressLabel(word({ srsState: { algo: 'sm2', phase: 'relearning', stepIndex: 0 } }))).toBe('Relearning · step 1/1');
  });
  it('SM-2 review: shows the ease factor', () => {
    expect(algoProgressLabel(word({ srsState: { algo: 'sm2', phase: 'review', easeFactor: 2.3 } }))).toBe('Review · ease 2.3');
  });
});

describe('estimateReviewsToMastery', () => {
  it('Leitner: exact boxes remaining to the last box', () => {
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'leitner', stepIndex: 0 } }))).toBe(4);
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'leitner', stepIndex: 3 } }))).toBe(1);
  });
  it('Leitner: 0 once it has reached the last box (already mastered)', () => {
    expect(estimateReviewsToMastery(word({ srsState: { algo: 'leitner', stepIndex: 4 } }))).toBe(0);
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
