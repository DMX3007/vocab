// Blanks out any accepted-answer term that appears inside a word's saved
// context sentence, so re-reading the sentence during review doesn't just
// hand you the answer — the sentence was captured verbatim from the page
// it was saved on, so it very often contains the word itself.

export interface SpoilerPart {
  text: string;
  spoiler: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function maskSpoilers(sentence: string, spoilerTerms: string[]): SpoilerPart[] {
  const terms = [...new Set(spoilerTerms.map((t) => t.trim()).filter(Boolean))]
    // longest first, so a saved multi-word phrase masks before a shorter
    // term that happens to be one of its words would
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0 || !sentence) return [{ text: sentence, spoiler: false }];

  const pattern = terms.map(escapeRegExp).join('|');
  // Unicode-aware "whole word" boundaries — \b is ASCII-only and misses
  // Cyrillic, so this uses lookaround against \p{L}/\p{N} instead.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'giu');

  const parts: SpoilerPart[] = [];
  let lastIndex = 0;
  for (const match of sentence.matchAll(re)) {
    const start = match.index!;
    if (start > lastIndex) parts.push({ text: sentence.slice(lastIndex, start), spoiler: false });
    parts.push({ text: match[0], spoiler: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < sentence.length) parts.push({ text: sentence.slice(lastIndex), spoiler: false });
  return parts;
}
