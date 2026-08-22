import { describe, it, expect } from 'vitest';
import { diffChars } from '../src/lib/review/diff';

describe('diffChars', () => {
  it('marks every character correct for an exact match', () => {
    expect(diffChars('стойкость', 'стойкость')).toEqual(
      [...'стойкость'].map((char) => ({ char, correct: true })),
    );
  });

  it('always returns exactly one entry per typed character', () => {
    expect(diffChars('abc', 'xyz')).toHaveLength(3);
    expect(diffChars('abcdef', 'ab')).toHaveLength(6);
    expect(diffChars('ab', 'abcdef')).toHaveLength(2);
  });

  it('flags a single substituted letter without cascading to the rest of the word', () => {
    // "стайкость" vs "стойкость" — one letter swapped (а for о), the rest lines up
    const result = diffChars('стайкость', 'стойкость');
    const wrongIndexes = result.flatMap((d, i) => (d.correct ? [] : [i]));
    expect(wrongIndexes).toEqual([2]); // only the swapped letter
  });

  it('flags an extra typed letter, not everything after it', () => {
    // "stoiikost" has one extra "i" inserted after "sto"
    const result = diffChars('stoiikost', 'stoikost');
    expect(result.filter((d) => !d.correct)).toHaveLength(1);
  });

  it('does not blame the typed letters for one the user left out entirely', () => {
    // "stokost" is missing an "i" compared to "stoikost" — every letter the
    // user DID type is still correct, there's just nothing typed to color
    // for the missing one.
    const result = diffChars('stokost', 'stoikost');
    expect(result.every((d) => d.correct)).toBe(true);
    expect(result).toHaveLength(7);
  });

  it('handles an empty typed answer', () => {
    expect(diffChars('', 'anything')).toEqual([]);
  });
});
