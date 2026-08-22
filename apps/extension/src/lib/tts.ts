// Thin wrapper around the Web Speech API's speechSynthesis — reads a word or
// its translation aloud. Free, no network call, no API key (unlike the
// translate provider): the browser speaks with whatever voices the OS
// already has installed.

const SPEECH_LOCALE: Record<string, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

/** Maps our 2-letter language codes to a BCP-47 tag speechSynthesis voices
 *  match against. An unknown code is passed through as-is — the browser
 *  falls back to its default voice rather than failing outright. */
export function toSpeechLang(code: string): string {
  return SPEECH_LOCALE[code] ?? code;
}

export function isTtsSupported(): boolean {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis;
}

/** Speaks `text` in `langCode`, cancelling anything already queued first —
 *  otherwise clicking through a few review cards fast queues up a backlog
 *  of stale utterances that keep talking after the word's moved on. */
export function speak(text: string, langCode: string): void {
  if (!isTtsSupported() || !text.trim()) return;
  globalThis.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = toSpeechLang(langCode);
  globalThis.speechSynthesis.speak(utterance);
}
