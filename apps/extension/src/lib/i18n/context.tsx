import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { StorageArea } from '../review/settings-store';
import { strings as enStrings, plural as enPlural, type TranslationKey, type PluralKey } from './en';
import { strings as ruStrings, plural as ruPlural } from './ru';
import { pluralIndex, detectDefaultLocale, LOCALE_STORAGE_KEY, type Locale } from './locale';

const DICTS: Record<Locale, Record<TranslationKey, string>> = { en: enStrings, ru: ruStrings };
const PLURAL_DICTS: Record<Locale, Record<PluralKey, readonly [string, string, string]>> = {
  en: enPlural,
  ru: ruPlural,
};

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Plain string lookup, with optional {var} interpolation. */
  t: (key: TranslationKey, vars?: Vars) => string;
  /** Count-aware lookup — picks the right plural form for the current
   *  locale, then interpolates {n} plus anything else in `vars`. */
  tp: (key: PluralKey, n: number, vars?: Vars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, storage }: { children: React.ReactNode; storage: StorageArea }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    (async () => {
      const result = await storage.get(LOCALE_STORAGE_KEY);
      const stored = result[LOCALE_STORAGE_KEY];
      setLocaleState(stored === 'en' || stored === 'ru' ? stored : detectDefaultLocale());
    })();
  }, [storage]);

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      void storage.set({ [LOCALE_STORAGE_KEY]: l });
    },
    [storage],
  );

  const t = useCallback(
    (key: TranslationKey, vars?: Vars) => interpolate(DICTS[locale][key] ?? enStrings[key], vars),
    [locale],
  );

  const tp = useCallback(
    (key: PluralKey, n: number, vars?: Vars) => {
      const forms = PLURAL_DICTS[locale][key] ?? enPlural[key];
      return interpolate(forms[pluralIndex(locale, n)], { n, ...vars });
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t, tp }), [locale, setLocale, t, tp]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
