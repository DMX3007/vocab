import { describe, it, expect } from 'vitest';
import { wordStatus, sortWords, filterWords, filterByAlgo, isFreshWord, sortForReview, isBurstWord, shouldSuggestShelving, SHELVE_SUGGEST_LAPSES } from '../src/lib/review/library';
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
      algo: 'sm2', pace: 'aggressive', phase: 'review', stepIndex: 0,
      dueAt: new Date(NOW.getTime() + 86_400_000), // due tomorrow by default
      intervalDays: 0, easeFactor: 2.5, repetitions: 1, lapses: 0,
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
    const w = word({ srsState: { algo: 'leitner', stepIndex: 5, intervalDays: 16 } });
    expect(wordStatus(w, NOW)).toBe('mastered');
    const notYet = word({ srsState: { algo: 'leitner', stepIndex: 4, intervalDays: 8 } });
    expect(wordStatus(notYet, NOW)).toBe('learning');
  });
  it('shelved wins over every other status, even an overdue word', () => {
    const w = word({ shelvedAt: NOW, srsState: { dueAt: new Date(NOW.getTime() - 1000), intervalDays: 30 } });
    expect(wordStatus(w, NOW)).toBe('shelved');
  });
});

describe('shouldSuggestShelving', () => {
  it('false below the lapse threshold', () => {
    expect(shouldSuggestShelving(word({ srsState: { lapses: SHELVE_SUGGEST_LAPSES - 1 } }))).toBe(false);
  });
  it('true once lapses reaches the threshold', () => {
    expect(shouldSuggestShelving(word({ srsState: { lapses: SHELVE_SUGGEST_LAPSES } }))).toBe(true);
  });
  it('stays true well past the threshold', () => {
    expect(shouldSuggestShelving(word({ srsState: { lapses: SHELVE_SUGGEST_LAPSES + 10 } }))).toBe(true);
  });
  it('false for a word already shelved — no point suggesting it again', () => {
    const w = word({ shelvedAt: NOW, srsState: { lapses: SHELVE_SUGGEST_LAPSES + 5 } });
    expect(shouldSuggestShelving(w)).toBe(false);
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

/** Never answered at all: the state initialState() hands a just-saved word. */
const untouched = { stepIndex: 0, lapses: 0, repetitions: 0 } as const;

describe('isFreshWord', () => {
  it('true for a word that has never been answered', () => {
    expect(isFreshWord(word({ srsState: { ...untouched } }))).toBe(true);
  });

  it('false once it has been answered even once — including mid-learning-ladder', () => {
    // The regression this whole helper was rewritten for: a word part-way
    // through the learning ladder still has intervalDays === 0 (only
    // graduating sets it), so the old intervalDays-based test called this
    // "fresh" for all 14 default steps.
    expect(isFreshWord(word({ srsState: { ...untouched, stepIndex: 1, intervalDays: 0 } }))).toBe(false);
  });

  it('false after a miss, which resets stepIndex but bumps lapses', () => {
    expect(isFreshWord(word({ srsState: { ...untouched, lapses: 1 } }))).toBe(false);
  });

  it('false for a graduated word', () => {
    expect(isFreshWord(word({ srsState: { repetitions: 1, intervalDays: 4 } }))).toBe(false);
  });
});

describe('sortForReview', () => {
  it('puts a never-answered word ahead of a repeat word, regardless of due order', () => {
    const overdueRepeat = word({ id: 'overdue-repeat', srsState: { repetitions: 3, intervalDays: 10, dueAt: new Date(NOW.getTime() - 1_000_000) } });
    const newerFresh = word({ id: 'newer-fresh', srsState: { ...untouched, dueAt: new Date(NOW.getTime() - 1_000) } });
    // the repeat word is far more overdue, but a word never once attempted still leads
    expect(sortForReview([overdueRepeat, newerFresh]).map((w) => w.id)).toEqual(['newer-fresh', 'overdue-repeat']);
  });

  it('REGRESSION: a half-learned word no longer outranks a badly-overdue one', () => {
    // The reported bug: learning steps are ~25s apart, so half-learned words
    // re-enter the queue constantly. When they counted as "fresh" they took
    // absolute priority forever and words due hours ago simply piled up in
    // the popup, never reaching the card. Now only NEVER-ANSWERED words get
    // that head start, so overdue-ness decides between these two.
    const justDrilled = word({ id: 'half-learned', srsState: { stepIndex: 3, repetitions: 0, intervalDays: 0, dueAt: new Date(NOW.getTime() - 25_000) } });
    const hoursOverdue = word({ id: 'hours-overdue', srsState: { repetitions: 2, intervalDays: 4, dueAt: new Date(NOW.getTime() - 3 * 3_600_000) } });
    expect(sortForReview([justDrilled, hoursOverdue]).map((w) => w.id)).toEqual(['hours-overdue', 'half-learned']);
  });

  it('orders within the never-answered group by due time, most-overdue first', () => {
    const freshA = word({ id: 'a', srsState: { ...untouched, dueAt: new Date(NOW.getTime() - 5_000) } });
    const freshB = word({ id: 'b', srsState: { ...untouched, dueAt: new Date(NOW.getTime() - 50_000) } });
    expect(sortForReview([freshA, freshB]).map((w) => w.id)).toEqual(['b', 'a']);
  });

  it('orders within the repeat group by due time, most-overdue first', () => {
    const repeatA = word({ id: 'a', srsState: { intervalDays: 5, dueAt: new Date(NOW.getTime() - 5_000) } });
    const repeatB = word({ id: 'b', srsState: { intervalDays: 5, dueAt: new Date(NOW.getTime() - 50_000) } });
    expect(sortForReview([repeatA, repeatB]).map((w) => w.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array (order stays as given, even though the result reorders)', () => {
    const repeat = word({ id: 'repeat', srsState: { repetitions: 3, intervalDays: 10, dueAt: new Date(NOW.getTime() - 1_000_000) } });
    const fresh = word({ id: 'fresh', srsState: { ...untouched, dueAt: new Date(NOW.getTime() - 1_000) } });
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
