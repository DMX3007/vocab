import { describe, it, expect } from 'vitest';
import { DraftStore, type AddWordDraft } from '../src/lib/storage/draft-store';
import type { StorageArea } from '../src/lib/review/settings-store';

// Same fake as settings-store.test.ts — chrome.storage isn't available in
// Node, so DraftStore takes a StorageArea by injection.
function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { _data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    _data: data,
    async get(key: string) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
    onChanged: { addListener() {} },
  };
}

const fullDraft: AddWordDraft = {
  mode: 'single',
  term: 'resolve',
  translation: 'решить',
  context: 'We need to resolve this.',
  bulkText: '',
  sheetUrl: '',
};

describe('DraftStore', () => {
  it('load returns null when nothing has been saved', async () => {
    const store = new DraftStore(fakeStorage());
    expect(await store.load()).toBeNull();
  });

  it('save then load round-trips a draft', async () => {
    const store = new DraftStore(fakeStorage());
    await store.save(fullDraft);
    expect(await store.load()).toEqual(fullDraft);
  });

  it('save treats an all-blank draft as nothing to persist (does not restore later)', async () => {
    const storage = fakeStorage();
    const store = new DraftStore(storage);
    await store.save({ mode: 'single', term: '', translation: '', context: '', bulkText: '', sheetUrl: '' });
    expect(await store.load()).toBeNull();
  });

  it('clear removes a previously saved draft', async () => {
    const store = new DraftStore(fakeStorage());
    await store.save(fullDraft);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('a bulk-mode draft with only bulkText set round-trips too', async () => {
    const store = new DraftStore(fakeStorage());
    const draft: AddWordDraft = { mode: 'bulk', term: '', translation: '', context: '', bulkText: 'fortitude — стойкость', sheetUrl: '' };
    await store.save(draft);
    expect(await store.load()).toEqual(draft);
  });
});
