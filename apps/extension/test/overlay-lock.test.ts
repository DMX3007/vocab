import { describe, it, expect, vi, afterEach } from 'vitest';
import { OverlayLockStore } from '../src/lib/review/overlay-lock';
import type { StorageArea } from '../src/lib/review/settings-store';

// Same fake as draft-store.test.ts / settings-store.test.ts.
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

afterEach(() => {
  vi.useRealTimers();
});

describe('OverlayLockStore', () => {
  it('get returns null when nothing is held', async () => {
    const store = new OverlayLockStore(fakeStorage());
    expect(await store.get()).toBeNull();
  });

  it('set then get round-trips the holding tab id', async () => {
    const store = new OverlayLockStore(fakeStorage());
    await store.set(42);
    const lock = await store.get();
    expect(lock?.tabId).toBe(42);
  });

  it('clearIfHeldBy releases the lock when the tab id matches', async () => {
    const store = new OverlayLockStore(fakeStorage());
    await store.set(42);
    await store.clearIfHeldBy(42);
    expect(await store.get()).toBeNull();
  });

  it('clearIfHeldBy is a no-op when a different tab asks — never steals someone else\'s lock', async () => {
    const store = new OverlayLockStore(fakeStorage());
    await store.set(42);
    await store.clearIfHeldBy(99);
    expect((await store.get())?.tabId).toBe(42);
  });

  it('a lock older than the TTL is treated as free', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    const store = new OverlayLockStore(fakeStorage());
    await store.set(42);
    expect((await store.get())?.tabId).toBe(42); // fresh — still held

    vi.setSystemTime(new Date('2026-06-13T12:06:00Z')); // +6 minutes, past the 5-minute TTL
    expect(await store.get()).toBeNull();
  });

  it('a lock just under the TTL is still held', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    const store = new OverlayLockStore(fakeStorage());
    await store.set(42);

    vi.setSystemTime(new Date('2026-06-13T12:04:59Z')); // +4:59, just under 5 minutes
    expect((await store.get())?.tabId).toBe(42);
  });
});
