import { describe, it, expect } from 'vitest';
import { wordStatus, sortWords, filterWords, filterByAlgo, isFreshWord, sortForReview, isBurstWord } from '../src/lib/review/library';
import type { Word } from '../src/lib/storage/types';

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
      dueAt: new Date(NOW.getTime() + 86_400_000), // due tomorrow by default
      intervalDays: 0, easeFactor: 2.5, repetitions: 1, lapses: 0,
      ...srsState,
    },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    shelvedAt: null,
    ...rest,
  };
}

describe('wordStatus', () => {
  it('due wins even if the interval looks mastered', () => {
    const w = word({ srsState: { dueAt: new Date(NOW.getTime() - 1000), intervalDays: 30 } });
    expect(wordStatus(w, NOW)).toBe('due');
  });
  it('mastered once intervalDays >= 21', () => {
    expect(wordStatus(word({ srsState: { intervalDays: 21 } }), NOW)).toBe('mastered');
  });
  it('learning when interval has grown but not yet mastered', () => {
    expect(wordStatus(word({ srsState: { intervalDays: 5 } }), NOW)).toBe('learning');
  });
  it('fresh for a brand-new word (interval still 0)', () => {
    expect(wordStatus(word({ srsState: { intervalDays: 0 } }), NOW)).toBe('fresh');
  });
  it('Leitner is mastered by reaching the last box, not by a day count', () => {
    const w = word({ srsState: { algo: 'leitner', stepIndex: 4, intervalDays: 16 } });
    expect(wordStatus(w, NOW)).toBe('mastered');
    const notYet = word({ srsState: { algo: 'leitner', stepIndex: 3, intervalDays: 8 } });
    expect(wordStatus(notYet, NOW)).toBe('learning');
  });
  it('shelved wins over every other status, even an overdue word', () => {
    const w = word({ shelvedAt: NOW, srsState: { dueAt: new Date(NOW.getTime() - 1000), intervalDays: 30 } });
    expect(wordStatus(w, NOW)).toBe('shelved');
  });
});

describe('sortWords', () => {
  const a = word({ id: 'a', term: 'zebra', createdAt: new Date('2026-01-01'), srsState: { intervalDays: 10, dueAt: new Date('2026-06-20') } });
  const b = word({ id: 'b', term: 'apple', createdAt: new Date('2026-02-01'), srsState: { intervalDays: 30, dueAt: new Date('2026-06-15') } });

  it('alpha sorts case-sensitively by locale', () => {
    expect(sortWords([a, b], 'alpha').map((w) => w.id)).toEqual(['b', 'a']);
  });
  it('added sorts newest createdAt first', () => {
    expect(sortWords([a, b], 'added').map((w) => w.id)).toEqual(['b', 'a']);
  });
  it('due sorts soonest dueAt first', () => {
    expect(sortWords([a, b], 'due').map((w) => w.id)).toEqual(['b', 'a']);
  });
  it('mastered sorts by longest interval first', () => {
    expect(sortWords([a, b], 'mastered').map((w) => w.id)).toEqual(['b', 'a']);
  });
});

describe('filterWords', () => {
  const words = [word({ id: 'a', term: 'fortitude', translations: ['стойкость'] }), word({ id: 'b', term: 'candor', translations: ['откровенность'] })];
  it('matches by term', () => {
    expect(filterWords(words, 'fort').map((w) => w.id)).toEqual(['a']);
  });
  it('matches by translation', () => {
    expect(filterWords(words, 'откров').map((w) => w.id)).toEqual(['b']);
  });
  it('empty query returns everything', () => {
    expect(filterWords(words, '  ')).toEqual(words);
  });
});

describe('isFreshWord', () => {
  it('true while intervalDays is still 0 (never graduated the first ladder step)', () => {
    expect(isFreshWord(word({ srsState: { intervalDays: 0 } }))).toBe(true);
  });
  it('false once the interval has grown at all', () => {
    expect(isFreshWord(word({ srsState: { intervalDays: 1 } }))).toBe(false);
  });
});

describe('sortForReview', () => {
  it('puts every fresh word ahead of every repeat word, regardless of due order', () => {
    const overdueRepeat = word({ id: 'overdue-repeat', srsState: { intervalDays: 10, dueAt: new Date(NOW.getTime() - 1_000_000) } });
    const newerFresh = word({ id: 'newer-fresh', srsState: { intervalDays: 0, dueAt: new Date(NOW.getTime() - 1_000) } });
    // the repeat word is far more overdue, but the fresh word must still come first
    expect(sortForReview([overdueRepeat, newerFresh]).map((w) => w.id)).toEqual(['newer-fresh', 'overdue-repeat']);
  });

  it('orders within the fresh group by due time, most-overdue first', () => {
    const freshA = word({ id: 'a', srsState: { intervalDays: 0, dueAt: new Date(NOW.getTime() - 5_000) } });
    const freshB = word({ id: 'b', srsState: { intervalDays: 0, dueAt: new Date(NOW.getTime() - 50_000) } });
    expect(sortForReview([freshA, freshB]).map((w) => w.id)).toEqual(['b', 'a']);
  });

  it('orders within the repeat group by due time, most-overdue first', () => {
    const repeatA = word({ id: 'a', srsState: { intervalDays: 5, dueAt: new Date(NOW.getTime() - 5_000) } });
    const repeatB = word({ id: 'b', srsState: { intervalDays: 5, dueAt: new Date(NOW.getTime() - 50_000) } });
    expect(sortForReview([repeatA, repeatB]).map((w) => w.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array (order stays as given, even though the result reorders)', () => {
    const repeat = word({ id: 'repeat', srsState: { intervalDays: 10, dueAt: new Date(NOW.getTime() - 1_000_000) } });
    const fresh = word({ id: 'fresh', srsState: { intervalDays: 0, dueAt: new Date(NOW.getTime() - 1_000) } });
    const words = [repeat, fresh]; // already in "repeat first" order — sortForReview must flip the OUTPUT, not this array
    const result = sortForReview(words);
    expect(words.map((w) => w.id)).toEqual(['repeat', 'fresh']); // input untouched
    expect(result.map((w) => w.id)).toEqual(['fresh', 'repeat']); // output reordered
  });
});

describe('isBurstWord', () => {
  it('false for a brand-new word (learning, but never attempted)', () => {
    expect(isBurstWord(word({ srsState: { phase: 'learning', stepIndex: 0 } }))).toBe(false);
  });
  it('true once a learning-phase word has been attempted at least once', () => {
    expect(isBurstWord(word({ srsState: { phase: 'learning', stepIndex: 1 } }))).toBe(true);
  });
  it('true for a relearning-phase word already past its first step', () => {
    expect(isBurstWord(word({ srsState: { phase: 'relearning', stepIndex: 1 } }))).toBe(true);
  });
  it('false for a relearning-phase word that has not been attempted yet', () => {
    expect(isBurstWord(word({ srsState: { phase: 'relearning', stepIndex: 0 } }))).toBe(false);
  });
  it('true for a word that was JUST answered incorrectly — a miss resets stepIndex to 0, but lapses catches it', () => {
    expect(isBurstWord(word({ srsState: { phase: 'learning', stepIndex: 0, lapses: 1 } }))).toBe(true);
  });
  it('false once a word has graduated to review, regardless of stepIndex', () => {
    expect(isBurstWord(word({ srsState: { phase: 'review', stepIndex: 3 } }))).toBe(false);
  });
});

describe('filterByAlgo', () => {
  const sm2Word = word({ id: 'a', srsState: { algo: 'sm2' } });
  const leitnerWord = word({ id: 'b', srsState: { algo: 'leitner' } });
  const words = [sm2Word, leitnerWord];

  it('"all" returns everything', () => {
    expect(filterByAlgo(words, 'all')).toEqual(words);
  });
  it('filters down to just the requested algorithm', () => {
    expect(filterByAlgo(words, 'sm2').map((w) => w.id)).toEqual(['a']);
    expect(filterByAlgo(words, 'leitner').map((w) => w.id)).toEqual(['b']);
  });
});
