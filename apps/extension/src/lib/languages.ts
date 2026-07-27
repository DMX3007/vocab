// The set of target languages selectable from the popup. Kept as a small
// static list (not user-editable) so the tooltip/review UI can show a
// human label without a lookup service.

export interface Language {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: ReadonlyArray<Language> = [
  { code: 'ru', label: 'Russian' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
];

export const DEFAULT_TARGET_LANG = 'ru';

export function isSupportedLanguage(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function languageLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
