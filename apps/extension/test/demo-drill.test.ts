import { describe, it, expect } from 'vitest';
import {
  pickDrillWords,
  buildDrillPrompt,
  cleanGeneratedPhrase,
  canDrill,
  SYSTEM_PROMPT,
} from '../src/lib/demo/drill';
import type { Word } from '../src/lib/storage/types';

const NOW = new Date('2026-06-13T12:00:00Z');

function word(overrides: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'fortitude',
    translations: ['стойкость'],
    langFrom: 'en',
    langTo: 'ru',
    contextSentence: '',
    sourceUrl: '',
    srsState: {
      algo: 'sm2', pace: 'aggressive', phase: 'learning', stepIndex: 0,
      dueAt: NOW, intervalDays: 0, easeFactor: 2.5, repetitions: 0, lapses: 0,
    },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    shelvedAt: null,
    dictionary: null,
    dictionaryFetchedAt: null,
    ...overrides,
  };
}

describe('pickDrillWords', () => {
  const many = Array.from({ length: 10 }, (_, i) => word({ id: `w${i}`, term: `term${i}` }));

  it('picks 2 for simple, 4 for hard', () => {
    expect(pickDrillWords(many, 'simple', () => 0)).toHaveLength(2);
    expect(pickDrillWords(many, 'hard', () => 0)).toHaveLength(4);
  });

  it('never repeats the same word within one drill', () => {
    const picked = pickDrillWords(many, 'hard', () => 0.5);
    expect(new Set(picked.map((w) => w.id)).size).toBe(picked.length);
  });

  it('skips deleted, shelved, and blank-term words', () => {
    const pool = [
      word({ id: 'ok', term: 'good' }),
      word({ id: 'del', term: 'deleted', deletedAt: NOW }),
      word({ id: 'shelf', term: 'shelved', shelvedAt: NOW }),
      word({ id: 'blank', term: '   ' }),
    ];
    expect(pickDrillWords(pool, 'hard', () => 0).map((w) => w.id)).toEqual(['ok']);
  });

  it('returns fewer than requested rather than padding when the library is small', () => {
    expect(pickDrillWords([word()], 'hard', () => 0)).toHaveLength(1);
    expect(pickDrillWords([], 'simple', () => 0)).toEqual([]);
  });
});

describe('buildDrillPrompt', () => {
  it('names every word in the prompt', () => {
    const p = buildDrillPrompt(['fortitude', 'candor'], 'simple');
    expect(p).toContain('fortitude');
    expect(p).toContain('candor');
  });

  it('asks for something longer/more complex on hard than on simple', () => {
    expect(buildDrillPrompt(['a'], 'simple')).toMatch(/short|simple/i);
    expect(buildDrillPrompt(['a'], 'hard')).toMatch(/complex|clause|idiom/i);
  });

  it('the system prompt pins the model to English only', () => {
    // The safety property this whole mode rests on: the model must never
    // author target-language text a learner can't check.
    expect(SYSTEM_PROMPT).toMatch(/English only/i);
  });
});

describe('cleanGeneratedPhrase', () => {
  it('passes a clean phrase through untouched', () => {
    expect(cleanGeneratedPhrase('He showed great fortitude.')).toBe('He showed great fortitude.');
  });

  it('strips a chatty preamble', () => {
    expect(cleanGeneratedPhrase("Sure! Here's a phrase: He showed great fortitude."))
      .toBe('He showed great fortitude.');
  });

  it('strips wrapping quotes, straight and curly', () => {
    expect(cleanGeneratedPhrase('"He showed fortitude."')).toBe('He showed fortitude.');
    expect(cleanGeneratedPhrase('“He showed fortitude.”')).toBe('He showed fortitude.');
  });

  it('strips a bullet marker', () => {
    expect(cleanGeneratedPhrase('- He showed fortitude.')).toBe('He showed fortitude.');
  });

  it('keeps only the first line, dropping any tacked-on explanation', () => {
    expect(cleanGeneratedPhrase('He showed fortitude.\n\nThis uses the word in context.'))
      .toBe('He showed fortitude.');
  });

  it('ignores leading blank lines', () => {
    expect(cleanGeneratedPhrase('\n\n  He showed fortitude.  ')).toBe('He showed fortitude.');
  });

  it('returns empty string for empty output rather than throwing', () => {
    expect(cleanGeneratedPhrase('')).toBe('');
    expect(cleanGeneratedPhrase('   \n  ')).toBe('');
  });

  it('does not mistake a normal sentence containing a colon for a preamble', () => {
    // The preamble strip is bounded to a short prefix so real sentences survive.
    const long = 'After a very long and genuinely difficult week of travel: he rested.';
    expect(cleanGeneratedPhrase(long)).toBe(long);
  });
});

describe('canDrill', () => {
  it('false for an empty or fully unusable library', () => {
    expect(canDrill([])).toBe(false);
    expect(canDrill([word({ deletedAt: NOW })])).toBe(false);
  });

  it('true as soon as one usable word exists', () => {
    expect(canDrill([word()])).toBe(true);
  });
});
