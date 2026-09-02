import { describe, it, expect, vi } from 'vitest';
import {
  pickDrillWords,
  buildDrillPrompt,
  parseGeneratedPhrase,
  cleanGeneratedPhrase,
  canDrill,
  resolveTranslation,
  tokenizePhrase,
  findLocalHint,
  SYSTEM_PROMPT,
} from '../src/lib/practice/drill';
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
    const p = buildDrillPrompt(['fortitude', 'candor'], 'simple', 'Russian');
    expect(p).toContain('fortitude');
    expect(p).toContain('candor');
  });

  it('asks for something longer/more complex on hard than on simple', () => {
    expect(buildDrillPrompt(['a'], 'simple', 'Russian')).toMatch(/short|simple/i);
    expect(buildDrillPrompt(['a'], 'hard', 'Russian')).toMatch(/complex|clause|idiom/i);
  });

  it('asks for the translation by the language\'s real name', () => {
    expect(buildDrillPrompt(['a'], 'simple', 'Japanese')).toContain('Japanese');
  });

  it('does NOT ask for a translation when the model cannot write that language', () => {
    // Russian et al. are outside the on-device model's attested output set
    // (see MODEL_OUTPUT_LANGUAGES). Asking anyway yields confident nonsense,
    // which is exactly what a learner can't detect — so we don't ask.
    const p = buildDrillPrompt(['a'], 'simple', null);
    expect(p).not.toMatch(/translate/i);
    expect(p).toMatch(/one line only/i);
  });

  it('the system prompt composes in English first, then translates', () => {
    // The phrase is always ORIGINATED in English — the model's strongest
    // language — and only then rendered into the target, so the half the
    // learner is asked to produce is never the model's weakest output.
    expect(SYSTEM_PROMPT).toMatch(/English first/i);
    expect(SYSTEM_PROMPT).toMatch(/two lines/i);
  });
});

describe('parseGeneratedPhrase', () => {
  it('splits the two labelled lines', () => {
    const r = parseGeneratedPhrase('EN: He showed great fortitude.\nTR: Он проявил стойкость.');
    expect(r.english).toBe('He showed great fortitude.');
    expect(r.translated).toBe('Он проявил стойкость.');
  });

  it('works without labels', () => {
    const r = parseGeneratedPhrase('He showed fortitude.\nОн проявил стойкость.');
    expect(r.english).toBe('He showed fortitude.');
    expect(r.translated).toBe('Он проявил стойкость.');
  });

  it('ignores blank lines between the two', () => {
    const r = parseGeneratedPhrase('EN: One.\n\n\nTR: Один.');
    expect(r.english).toBe('One.');
    expect(r.translated).toBe('Один.');
  });

  it('returns translated: null when the model only gave one line', () => {
    // Must not throw — the UI just disables the direction that needs it.
    const r = parseGeneratedPhrase('EN: He showed fortitude.');
    expect(r.english).toBe('He showed fortitude.');
    expect(r.translated).toBeNull();
  });

  it('returns an empty english for empty output rather than throwing', () => {
    expect(parseGeneratedPhrase('')).toEqual({ english: '', translated: null });
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

describe('resolveTranslation', () => {
  const ok = (text: string) => vi.fn().mockResolvedValue(text);

  it('uses the model when it can actually write that language', async () => {
    const translate = ok('never used');
    const r = await resolveTranslation('Er zeigte Mut.', 'He showed fortitude.', 'en', 'de', translate);
    expect(r).toEqual({ text: 'Er zeigte Mut.', source: 'model' });
    expect(translate).not.toHaveBeenCalled(); // no needless network call
  });

  it('REGRESSION: falls back to the provider for a language the model cannot write', async () => {
    // Russian is outside MODEL_OUTPUT_LANGUAGES, so the model returns no
    // second line. Without this fallback the card showed only the bare list
    // of words — not a phrase to translate — which is exactly how practice
    // mode appeared broken for Russian users.
    const translate = ok('Он проявил стойкость.');
    const r = await resolveTranslation(null, 'He showed fortitude.', 'en', 'ru', translate);
    expect(r).toEqual({ text: 'Он проявил стойкость.', source: 'provider' });
    expect(translate).toHaveBeenCalledWith('He showed fortitude.', 'en', 'ru');
  });

  it('ignores a model translation in a language it does not attest to', async () => {
    // A model that answers in Russian anyway is confidently wrong in the one
    // way a learner cannot catch, so it is discarded rather than shown.
    const translate = ok('Он проявил стойкость.');
    const r = await resolveTranslation('Он праявил стойкасть.', 'He showed fortitude.', 'en', 'ru', translate);
    expect(r.source).toBe('provider');
  });

  it('returns none when the provider fails, rather than throwing', async () => {
    // Offline or rate-limited is an everyday case; the UI drops to word cues.
    const r = await resolveTranslation(null, 'He showed fortitude.', 'en', 'ru', vi.fn().mockRejectedValue(new Error('offline')));
    expect(r).toEqual({ text: null, source: 'none' });
  });

  it('returns none for a blank provider response', async () => {
    const r = await resolveTranslation(null, 'He showed fortitude.', 'en', 'ru', ok('   '));
    expect(r).toEqual({ text: null, source: 'none' });
  });

  it('never calls the provider with an empty phrase', async () => {
    const translate = ok('x');
    expect(await resolveTranslation(null, '   ', 'en', 'ru', translate)).toEqual({ text: null, source: 'none' });
    expect(translate).not.toHaveBeenCalled();
  });
});

describe('tokenizePhrase', () => {
  it('round-trips: joining the tokens reproduces the phrase exactly', () => {
    const phrase = 'Он проявил стойкость, не так ли?';
    expect(tokenizePhrase(phrase).map((t) => t.text).join('')).toBe(phrase);
  });

  it('marks Cyrillic as words, not punctuation', () => {
    // /\w+/ is ASCII-only and would treat every Russian word as a gap —
    // and the languages this feature exists for are exactly the non-Latin
    // ones, since those are the ones the model can't write.
    const words = tokenizePhrase('Он проявил стойкость.').filter((t) => t.isWord).map((t) => t.text);
    expect(words).toEqual(['Он', 'проявил', 'стойкость']);
  });

  it('keeps hyphens and apostrophes inside a single word', () => {
    const words = tokenizePhrase("a well-known man doesn't quit").filter((t) => t.isWord).map((t) => t.text);
    expect(words).toEqual(['a', 'well-known', 'man', "doesn't", 'quit']);
  });

  it('handles an empty phrase without throwing', () => {
    expect(tokenizePhrase('')).toEqual([]);
  });
});

describe('findLocalHint', () => {
  const pairs = [{ term: 'fortitude', cue: 'стойкость' }, { term: 'candor', cue: 'откровенность' }];

  it('matches a cue exactly, in either direction', () => {
    expect(findLocalHint('стойкость', pairs)).toBe('fortitude');
    expect(findLocalHint('fortitude', pairs)).toBe('стойкость');
  });

  it('is case-insensitive', () => {
    expect(findLocalHint('Стойкость', pairs)).toBe('fortitude');
  });

  it('matches an inflected form by its stem', () => {
    // Russian inflects heavily; the saved cue is the dictionary form but the
    // phrase contains whatever case the sentence needed.
    expect(findLocalHint('стойкостью', pairs)).toBe('fortitude');
  });

  it('does not match on a stem too short to be meaningful', () => {
    // Guards against "на" matching "например" and handing out nonsense.
    expect(findLocalHint('от', pairs)).toBeNull();
  });

  it('returns null for a word that is not in the drill at all', () => {
    // The caller falls back to the translation provider from here.
    expect(findLocalHint('проявил', pairs)).toBeNull();
  });

  it('returns null for blank input and empty pairs', () => {
    expect(findLocalHint('   ', pairs)).toBeNull();
    expect(findLocalHint('стойкость', [])).toBeNull();
  });
});
