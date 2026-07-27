import { describe, it, expect, vi } from 'vitest';
import {
  parseGoogleSheetUrl,
  buildCsvExportUrl,
  parseCsv,
  rowsToWordInputs,
  fetchWordsFromGoogleSheet,
} from '../src/lib/import/google-sheet';

describe('parseGoogleSheetUrl', () => {
  it('extracts the sheet id from a normal edit URL', () => {
    const ref = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEf23-_XyZ/edit#gid=0');
    expect(ref?.sheetId).toBe('1AbCdEf23-_XyZ');
    expect(ref?.gid).toBe('0');
  });

  it('extracts the id with no gid present', () => {
    const ref = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEf23-_XyZ/edit?usp=sharing');
    expect(ref?.sheetId).toBe('1AbCdEf23-_XyZ');
    expect(ref?.gid).toBeUndefined();
  });

  it('reads gid from a query string too', () => {
    const ref = parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456');
    expect(ref?.gid).toBe('456');
  });

  it('returns null for a non-sheets URL', () => {
    expect(parseGoogleSheetUrl('https://example.com/not-a-sheet')).toBeNull();
    expect(parseGoogleSheetUrl('not even a url')).toBeNull();
  });
});

describe('buildCsvExportUrl', () => {
  it('builds the export URL, with gid when present', () => {
    expect(buildCsvExportUrl({ sheetId: 'abc' })).toBe(
      'https://docs.google.com/spreadsheets/d/abc/export?format=csv',
    );
    expect(buildCsvExportUrl({ sheetId: 'abc', gid: '123' })).toBe(
      'https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=123',
    );
  });
});

describe('parseCsv', () => {
  it('parses plain comma-separated rows', () => {
    expect(parseCsv('fortitude,стойкость\nephemeral,недолговечный\n')).toEqual([
      ['fortitude', 'стойкость'],
      ['ephemeral', 'недолговечный'],
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const csv = '"hello, world","she said ""hi"""\n';
    expect(parseCsv(csv)).toEqual([['hello, world', 'she said "hi"']]);
  });

  it('handles a quoted field with an embedded newline', () => {
    const csv = '"line one\nline two",translation\n';
    expect(parseCsv(csv)).toEqual([['line one\nline two', 'translation']]);
  });

  it('drops blank trailing lines', () => {
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
  });
});

describe('rowsToWordInputs', () => {
  it('skips a recognizable header row', () => {
    const rows = [
      ['word', 'translation'],
      ['fortitude', 'стойкость'],
    ];
    expect(rowsToWordInputs(rows)).toEqual([{ term: 'fortitude', translation: 'стойкость', contextSentence: undefined }]);
  });

  it('treats the first row as data when it does not look like a header', () => {
    const rows = [['fortitude', 'стойкость']];
    expect(rowsToWordInputs(rows)).toEqual([{ term: 'fortitude', translation: 'стойкость', contextSentence: undefined }]);
  });

  it('carries an optional third column as context', () => {
    const rows = [['fortitude', 'стойкость', 'Built on a foundation of fortitude.']];
    expect(rowsToWordInputs(rows)[0]?.contextSentence).toBe('Built on a foundation of fortitude.');
  });

  it('drops rows missing a term or translation', () => {
    const rows = [
      ['fortitude', 'стойкость'],
      ['', 'nothing'],
      ['orphan', ''],
    ];
    expect(rowsToWordInputs(rows)).toHaveLength(1);
  });
});

describe('fetchWordsFromGoogleSheet', () => {
  it('rejects a non-sheets URL without fetching', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchWordsFromGoogleSheet('https://example.com', fetchImpl)).rejects.toThrow(/Sheets link/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches the CSV export and returns parsed words', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'word,translation\nfortitude,стойкость\n',
    });
    const words = await fetchWordsFromGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', fetchImpl);
    expect(words).toEqual([{ term: 'fortitude', translation: 'стойкость', contextSentence: undefined }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://docs.google.com/spreadsheets/d/abc123/export?format=csv',
      { credentials: 'include' },
    );
  });

  it('gives a "make it shareable" error on 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(fetchWordsFromGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', fetchImpl))
      .rejects.toThrow(/Anyone with the link/);
  });

  it('gives the same error when Google serves an HTML sign-in page instead of CSV', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><html><body>Sign in</body></html>',
    });
    await expect(fetchWordsFromGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', fetchImpl))
      .rejects.toThrow(/Anyone with the link/);
  });

  it('errors when the sheet has no usable rows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'word,translation\n' });
    await expect(fetchWordsFromGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', fetchImpl))
      .rejects.toThrow(/No word\/translation pairs/);
  });

  it('wraps a network failure in a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(fetchWordsFromGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', fetchImpl))
      .rejects.toThrow(/Could not reach Google Sheets/);
  });
});
