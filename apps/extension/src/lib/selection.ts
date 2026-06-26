export interface SelectionResult {
  term: string;
  contextSentence: string;
}

// Sentence terminators we recognise. Naive on purpose (see backlog in the
// test file): abbreviations like "Mr." are not handled yet.
const SENTENCE_END = /[.!?\u2026]/; // . ! ? and the ellipsis character

/** Finds the sentence (start/end indices in `text`) that covers [from, to). */
function sentenceBoundsAround(text: string, from: number, to: number) {
  // Walk left from the selection start until a sentence terminator.
  let start = from;
  while (start > 0 && !SENTENCE_END.test(text[start - 1]!)) start--;

  // Walk right from the selection end until (and including) a terminator.
  let end = to;
  while (end < text.length && !SENTENCE_END.test(text[end - 1]!)) end++;

  return { start, end };
}

/**
 * Decides whether a selection deserves a tooltip and, if so, returns what
 * we will save: the selected term plus the full sentence it lives in.
 *
 * Returns null (no tooltip) when the selection is empty, whitespace-only,
 * or spans more than one sentence.
 *
 * `from`/`to` are character offsets into `text`, mirroring the DOM Range
 * the content script produces.
 */
export function analyzeSelection(
  text: string,
  from: number,
  to: number,
): SelectionResult | null {
  const term = text.slice(from, to).trim();
  if (term.length === 0) return null;

  // Re-anchor to the trimmed term so leading/trailing spaces don't push us
  // into a neighbouring sentence.
  const trimmedStart = text.indexOf(term, from);
  const trimmedEnd = trimmedStart + term.length;

  const { start, end } = sentenceBoundsAround(text, trimmedStart, trimmedEnd);

  // If a terminator appears strictly inside the selection, it crosses a
  // sentence boundary — reject it.
  const inside = text.slice(trimmedStart, trimmedEnd - 1);
  if (SENTENCE_END.test(inside)) return null;

  const contextSentence = text.slice(start, end).trim();
  return { term, contextSentence };
}
