// Import word lists from a public Google Sheet. No OAuth: the user shares
// the sheet as "Anyone with the link -> Viewer" and pastes the URL; we fetch
// Google's built-in CSV export of it. Column A = word, column B =
// translation, optional column C = example sentence.

export interface WordInput {
  term: string;
  translation: string;
  contextSentence?: string;
}

export interface SheetRef {
  sheetId: string;
  gid?: string;
}

const SHEET_URL_RE = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

/** Pulls the spreadsheet id (and sheet/tab id, if present) out of any Google Sheets URL shape. */
export function parseGoogleSheetUrl(url: string): SheetRef | null {
  const match = url.match(SHEET_URL_RE);
  if (!match) return null;
  const sheetId = match[1]!;

  let gid: string | undefined;
  try {
    const u = new URL(url);
    gid = u.searchParams.get('gid') ?? u.hash.match(/gid=(\d+)/)?.[1] ?? undefined;
  } catch {
    // malformed beyond the id itself — gid just stays undefined
  }
  return { sheetId, gid };
}

export function buildCsvExportUrl(ref: SheetRef): string {
  const base = `https://docs.google.com/spreadsheets/d/${ref.sheetId}/export?format=csv`;
  return ref.gid ? `${base}&gid=${ref.gid}` : base;
}

/** Minimal RFC4180 CSV parser: handles quoted fields with embedded commas, quotes, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // skip — \n (handled below) ends the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-blank rows (trailing newline, empty tabs, etc.)
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const HEADER_WORDS = new Set(['word', 'term', 'english', 'front']);
const HEADER_TRANSLATIONS = new Set(['translation', 'перевод', 'back', 'meaning']);

/** Turns parsed CSV rows into word inputs, skipping a header row if one is detected. */
export function rowsToWordInputs(rows: string[][]): WordInput[] {
  if (rows.length === 0) return [];
  const [a, b] = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
  const looksLikeHeader = !!a && HEADER_WORDS.has(a) && (!b || HEADER_TRANSLATIONS.has(b));
  const data = looksLikeHeader ? rows.slice(1) : rows;

  return data
    .map((r) => ({
      term: (r[0] ?? '').trim(),
      translation: (r[1] ?? '').trim(),
      contextSentence: (r[2] ?? '').trim() || undefined,
    }))
    .filter((w) => w.term && w.translation);
}

/** Fetches a public sheet's CSV export and parses it into word inputs. Throws a user-facing message on failure. */
export async function fetchWordsFromGoogleSheet(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WordInput[]> {
  const ref = parseGoogleSheetUrl(url.trim());
  if (!ref) {
    throw new Error("That doesn't look like a Google Sheets link.");
  }

  const NOT_SHARED_MSG =
    'Can’t read this sheet — make sure it’s shared as "Anyone with the link → Viewer".';

  let res: Response;
  try {
    res = await fetchImpl(buildCsvExportUrl(ref), { credentials: 'include' });
  } catch {
    throw new Error('Could not reach Google Sheets. Check your connection and try again.');
  }

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new Error(NOT_SHARED_MSG);
  }
  if (!res.ok) {
    throw new Error(`Couldn't fetch the sheet (HTTP ${res.status}).`);
  }

  const text = await res.text();
  // A private sheet doesn't error — Google serves an HTML sign-in page with a 200.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(NOT_SHARED_MSG);
  }

  const words = rowsToWordInputs(parseCsv(text));
  if (words.length === 0) {
    throw new Error('No word/translation pairs found. Column A should be the word, column B the translation.');
  }
  return words;
}
