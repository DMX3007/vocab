import { describe, it, expect } from 'vitest';
import { strings as en, plural as enPlural } from '../src/lib/i18n/en';
import { strings as ru, plural as ruPlural } from '../src/lib/i18n/ru';
import { pluralIndex, detectDefaultLocale } from '../src/lib/i18n/locale';

describe('translation dictionaries', () => {
  it('ru has a translation for every en key, and no extra keys', () => {
    const enKeys = Object.keys(en).sort();
    const ruKeys = Object.keys(ru).sort();
    expect(ruKeys).toEqual(enKeys);
  });

  it('ru has a plural entry for every en plural key, and no extra keys', () => {
    const enKeys = Object.keys(enPlural).sort();
    const ruKeys = Object.keys(ruPlural).sort();
    expect(ruKeys).toEqual(enKeys);
  });

  it('no dictionary value is empty', () => {
    for (const [key, value] of Object.entries({ ...en, ...ru })) {
      expect(value.trim().length, `empty value for ${key}`).toBeGreaterThan(0);
    }
  });

  it('every plural entry has exactly 3 forms, none empty', () => {
    for (const [key, forms] of Object.entries({ ...enPlural, ...ruPlural })) {
      expect(forms, key).toHaveLength(3);
      for (const f of forms) expect(f.trim().length, `empty plural form for ${key}`).toBeGreaterThan(0);
    }
  });

  it('a {var} placeholder used in the en template also appears in the ru one (same variable names)', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(ru[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('pluralIndex', () => {
  it('english: singular only at exactly 1', () => {
    expect(pluralIndex('en', 1)).toBe(0);
    expect(pluralIndex('en', 0)).toBe(2);
    expect(pluralIndex('en', 2)).toBe(2);
    expect(pluralIndex('en', 21)).toBe(2);
  });

  it('russian: one/few/many with the standard 11-14 exception', () => {
    expect(pluralIndex('ru', 1)).toBe(0); // слово
    expect(pluralIndex('ru', 21)).toBe(0); // слово (21 -> ends in 1, not 11)
    expect(pluralIndex('ru', 2)).toBe(1); // слова
    expect(pluralIndex('ru', 3)).toBe(1);
    expect(pluralIndex('ru', 4)).toBe(1);
    expect(pluralIndex('ru', 22)).toBe(1); // слова
    expect(pluralIndex('ru', 5)).toBe(2); // слов
    expect(pluralIndex('ru', 0)).toBe(2); // слов
    expect(pluralIndex('ru', 11)).toBe(2); // слов (the -11 exception)
    expect(pluralIndex('ru', 12)).toBe(2);
    expect(pluralIndex('ru', 14)).toBe(2);
    expect(pluralIndex('ru', 111)).toBe(2); // slов (111 ends in 11)
  });
});

describe('detectDefaultLocale', () => {
  it('never throws even without a navigator', () => {
    expect(() => detectDefaultLocale()).not.toThrow();
  });
});
