// The AUTO button's translation provider. MyMemory is a free translation
// API with no API key required for light use — good enough for "translate
// one selected word", which is all the tooltip ever asks for.
// https://mymemory.translated.net/doc/spec.php

const ENDPOINT = 'https://api.mymemory.translated.net/get';

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
}

/** Translates one term. Throws on any non-success response — callers (the
 *  tooltip's TRANSLATE_FAILED path) fall back to manual entry. */
export async function translateWord(
  term: string,
  langFrom: string,
  langTo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', term);
  url.searchParams.set('langpair', `${langFrom}|${langTo}`);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`Translate request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as MyMemoryResponse;
  if (String(data.responseStatus) !== '200') {
    throw new Error(data.responseDetails ?? 'Translate request failed');
  }

  const translated = data.responseData?.translatedText?.trim();
  if (!translated) {
    throw new Error('Translate response had no text');
  }
  return translated;
}
