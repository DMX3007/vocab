import { describe, it, expect } from 'vitest';
import { wordStatus, sortWords, filterWords } from '../src/lib/review/library';
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
