import type { StorageArea } from '../review/settings-store';

// Safety net for the "add word" sheet: a Chrome action popup is a special
// window that closes the instant it loses focus, and some OS input-method/
// language switchers steal focus just long enough to trigger that — killing
// the popup mid-type with no chance for the component to clean up. Rather
// than try to prevent the close, this persists whatever's been typed so it
// can be restored the next time the sheet opens, and is cleared only once
// the words are actually saved.
//
// Takes a StorageArea by injection (see settings-store.ts) rather than
// touching chrome.storage.local directly, for the same reason: that global
// isn't available under Node/vitest, so anything that needs a unit test
// has to accept it as a dependency instead.

const KEY = 'vocably_add_draft';

export type AddWordMode = 'single' | 'bulk' | 'sheet';

export interface AddWordDraft {
  mode: AddWordMode;
  term: string;
  translation: string;
  context: string;
  bulkText: string;
  sheetUrl: string;
}

function isBlankDraft(d: AddWordDraft): boolean {
  return !d.term && !d.translation && !d.context && !d.bulkText && !d.sheetUrl;
}

export class DraftStore {
  constructor(private readonly storage: StorageArea) {}

  /** Returns null for "nothing worth restoring" — both when nothing's been
   *  saved yet and when what's stored is blank (belt-and-suspenders: save()
   *  already avoids writing a blank draft, but this covers a directly-
   *  cleared or otherwise stale empty record too). */
  async load(): Promise<AddWordDraft | null> {
    const result = await this.storage.get(KEY);
    const stored = result[KEY] as AddWordDraft | null | undefined;
    return stored && !isBlankDraft(stored) ? stored : null;
  }

  async save(draft: AddWordDraft): Promise<void> {
    if (isBlankDraft(draft)) {
      await this.clear();
      return;
    }
    await this.storage.set({ [KEY]: draft });
  }

  async clear(): Promise<void> {
    await this.storage.set({ [KEY]: null });
  }
}
