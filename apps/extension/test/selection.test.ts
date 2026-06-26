import { describe, it, expect } from 'vitest';
import { analyzeSelection } from '../src/lib/selection';

// analyzeSelection(fullText, selectionStart, selectionEnd) decides whether
// a selection deserves a tooltip and, if yes, returns what we will save:
//   { term, contextSentence } — or null when the tooltip must NOT appear.
// Indices mirror what the content script gets from the DOM Range.

const TEXT =
  'The platform asked a question. Fortitude means strength in adversity. He showed great fortitude during the crisis.';

const select = (fragment: string) => {
  const start = TEXT.indexOf(fragment);
  return analyzeSelection(TEXT, start, start + fragment.length);
};

describe('analyzeSelection', () => {
  it('single word: term + the full sentence it lives in as context', () => {
    const r = select('Fortitude');
    expect(r).not.toBeNull();
    expect(r!.term).toBe('Fortitude');
    expect(r!.contextSentence).toBe('Fortitude means strength in adversity.');
  });

  it('a phrase is allowed (multi-word selections are valid vocabulary)', () => {
    const r = select('strength in adversity');
    expect(r!.term).toBe('strength in adversity');
    expect(r!.contextSentence).toBe('Fortitude means strength in adversity.');
  });

  it('a whole sentence is the maximum allowed selection', () => {
    const r = select('Fortitude means strength in adversity.');
    expect(r).not.toBeNull();
  });

  it('selection crossing a sentence boundary -> no tooltip', () => {
    const r = select('adversity. He showed');
    expect(r).toBeNull();
  });

  it('whitespace-only or empty selection -> no tooltip', () => {
    const i = TEXT.indexOf(' question');
    expect(analyzeSelection(TEXT, i, i + 1)).toBeNull();
    expect(analyzeSelection(TEXT, 5, 5)).toBeNull();
  });

  it('surrounding whitespace is trimmed from the term, context unaffected', () => {
    const start = TEXT.indexOf(' Fortitude means');
    const r = analyzeSelection(TEXT, start, start + ' Fortitude '.length);
    expect(r!.term).toBe('Fortitude');
    expect(r!.contextSentence).toBe('Fortitude means strength in adversity.');
  });

  it('selection at the very start and very end of the text still gets context', () => {
    expect(select('The platform')!.contextSentence).toBe('The platform asked a question.');
    expect(select('the crisis.')!.contextSentence).toBe(
      'He showed great fortitude during the crisis.',
    );
  });
});

// Known simplifications, deliberately NOT tested yet (backlog):
// - abbreviations ("Mr. Smith") confuse the naive sentence splitter;
// - sentence boundaries are . ! ? … only — no support for quotes/brackets;
// - real DOM Ranges across element boundaries arrive in loop 4 smoke tests.
