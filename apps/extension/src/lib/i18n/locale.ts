export type Locale = 'en' | 'ru';

export const LOCALE_STORAGE_KEY = 'vocably_locale';

/** Russian has three plural forms (1 / 2-4 / 5+, with the usual "teens"
 *  exception); English only ever needs two. Both dictionaries store THREE
 *  template slots per pluralized key so one picker works for either — an
 *  English entry just repeats its "many" string in slots 1 and 2. */
export type PluralForms = readonly [one: string, few: string, many: string];

function pluralIndexRu(n: number): 0 | 1 | 2 {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

function pluralIndexEn(n: number): 0 | 1 | 2 {
  return n === 1 ? 0 : 2;
}

export function pluralIndex(locale: Locale, n: number): 0 | 1 | 2 {
  return locale === 'ru' ? pluralIndexRu(n) : pluralIndexEn(n);
}

/** Detects a sensible default from the browser/OS locale — never throws,
 *  falls back to English for anything that isn't Russian. */
export function detectDefaultLocale(): Locale {
  try {
    const lang = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
    return lang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}
