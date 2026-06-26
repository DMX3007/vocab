import { describe, it, expect, vi } from 'vitest';
import { SettingsStore, type StorageArea } from '../src/lib/review/settings-store';
import { defaultSettings } from '../src/lib/review/overlay-policy';

// chrome.storage isn't available in Node, so the store takes a StorageArea
// (the small slice of the chrome.storage.local API we use) by injection.
// Tests pass a fake; production passes chrome.storage.local. This keeps the
// load/merge/save logic honestly testable without mocking all of Chrome.

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { _data: Record<string, unknown> } {
  const data = { ...initial };
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>) => void> = [];
  return {
    _data: data,
    async get(key: string) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const k of Object.keys(items)) changes[k] = { newValue: items[k] };
      listeners.forEach((l) => l(changes));
    },
    onChanged: {
      addListener(cb: (changes: Record<string, { newValue?: unknown }>) => void) {
        listeners.push(cb);
      },
    },
  };
}

describe('SettingsStore', () => {
  it('returns defaults when storage is empty', async () => {
    const store = new SettingsStore(fakeStorage());
    expect(await store.load()).toEqual(defaultSettings());
  });

  it('merges stored partial settings over the defaults (forward-compatible)', async () => {
    // an older/newer build might have saved only some fields
    const storage = fakeStorage({ vocabflow_settings: { blacklist: ['youtube.com'] } });
    const store = new SettingsStore(storage);
    const loaded = await store.load();
    expect(loaded.blacklist).toEqual(['youtube.com']); // from storage
    expect(loaded.throttleMinutes).toBe(defaultSettings().throttleMinutes); // from defaults
  });

  it('save writes the whole settings object', async () => {
    const storage = fakeStorage();
    const store = new SettingsStore(storage);
    const next = { ...defaultSettings(), pausedUntil: '2026-06-10T15:00:00.000Z' };
    await store.save(next);
    expect(storage._data['vocabflow_settings']).toEqual(next);
  });

  it('update loads, applies a change function, and saves the result', async () => {
    const storage = fakeStorage();
    const store = new SettingsStore(storage);
    const result = await store.update((s) => ({ ...s, blacklist: [...s.blacklist, 'mail.com'] }));
    expect(result.blacklist).toEqual(['mail.com']);
    expect((storage._data['vocabflow_settings'] as { blacklist: string[] }).blacklist).toEqual(['mail.com']);
  });

  it('subscribe fires when settings change (this is the cross-tab sync hook)', async () => {
    const storage = fakeStorage();
    const store = new SettingsStore(storage);
    const seen = vi.fn();
    store.subscribe(seen);
    await store.save({ ...defaultSettings(), pausedUntil: '2026-06-10T16:00:00.000Z' });
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0]![0].pausedUntil).toBe('2026-06-10T16:00:00.000Z');
  });

  it('subscribe ignores changes to unrelated storage keys', async () => {
    const storage = fakeStorage();
    const store = new SettingsStore(storage);
    const seen = vi.fn();
    store.subscribe(seen);
    await storage.set({ some_other_key: 123 });
    expect(seen).not.toHaveBeenCalled();
  });
});
