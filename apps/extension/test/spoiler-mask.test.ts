import { describe, it, expect } from 'vitest';
import { maskSpoilers } from '../src/lib/review/spoiler-mask';

describe('maskSpoilers', () => {
  it('masks the term wherever it appears, case-insensitively', () => {
    const parts = maskSpoilers('Her Fortitude carried the team through fortitude tests.', ['fortitude']);
    expect(parts.map((p) => [p.text, p.spoiler])).toEqual([
      ['Her ', false],
      ['Fortitude', true],
      [' carried the team through ', false],
      ['fortitude', true],
      [' tests.', false],
    ]);
  });

  it('only masks whole words, not a term that is a substring of a longer word', () => {
    const parts = maskSpoilers('The cats sat on the mat.', ['cat']);
    expect(parts).toEqual([{ text: 'The cats sat on the mat.', spoiler: false }]);
  });

  it('masks the longest matching term first when one term contains another', () => {
    const parts = maskSpoilers('a rite of passage', ['rite', 'rite of passage']);
    expect(parts.map((p) => p.text)).toEqual(['a ', 'rite of passage']);
    expect(parts[1]!.spoiler).toBe(true);
  });

  it('handles multiple distinct accepted answers', () => {
    const parts = maskSpoilers('стойкость и упорство', ['стойкость', 'упорство']);
    expect(parts.map((p) => [p.text, p.spoiler])).toEqual([
      ['стойкость', true],
      [' и ', false],
      ['упорство', true],
    ]);
  });

  it('returns the sentence unchanged with no spoiler terms', () => {
    expect(maskSpoilers('Nothing to hide here.', [])).toEqual([
      { text: 'Nothing to hide here.', spoiler: false },
    ]);
  });

  it('handles an empty sentence', () => {
    expect(maskSpoilers('', ['fortitude'])).toEqual([{ text: '', spoiler: false }]);
  });

  it('ignores blank/whitespace-only terms', () => {
    const parts = maskSpoilers('Just a sentence.', ['', '   ']);
    expect(parts).toEqual([{ text: 'Just a sentence.', spoiler: false }]);
  });
});
