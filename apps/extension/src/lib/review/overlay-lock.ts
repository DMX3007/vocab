import type { StorageArea } from './settings-store';

// Coordinates which tab (if any) is allowed to show the review overlay
// right now — see background.ts's requestShowOverlay, which every trigger
// (the 1-minute alarm tick, and burst-drill polling running independently
// in every visible tab) goes through before mounting anything. Without
// this, two tabs — even two different browser WINDOWS, each with its own
// visible front tab — could each decide to show the same due word at once,
// or the alarm could reset an already-open, in-progress card.
//
// Popup.tsx also reads this (read-only, via get()) for the "review open
// elsewhere" banner — it's the same lock, not a separate signal, so the
// banner can never disagree with what's actually happening.
//
// Takes a StorageArea by injection (see settings-store.ts / draft-store.ts)
// for the same reason those do: testable under Node/vitest, where the real
// chrome.storage.local isn't available.

const KEY = 'vocably_overlay_lock';
// Bounds staleness if a release message never arrives (the tab navigated
// hard, crashed, or the extension reloaded mid-session) — well past any
// real review session, short enough not to matter in practice.
const TTL_MS = 5 * 60_000;

export interface OverlayLock {
  tabId: number;
  acquiredAt: string;
}

export class OverlayLockStore {
  constructor(private readonly storage: StorageArea) {}

  /** Null both when nothing's held and when what's stored has gone stale
   *  (past TTL_MS) — a stale lock is treated exactly like no lock at all. */
  async get(): Promise<OverlayLock | null> {
    const result = await this.storage.get(KEY);
    const lock = result[KEY] as OverlayLock | null | undefined;
    if (!lock) return null;
    if (Date.now() - new Date(lock.acquiredAt).getTime() > TTL_MS) return null;
    return lock;
  }

  async set(tabId: number): Promise<void> {
    const lock: OverlayLock = { tabId, acquiredAt: new Date().toISOString() };
    await this.storage.set({ [KEY]: lock });
  }

  /** No-ops if the lock belongs to a different tab — a stale release
   *  request (e.g. from a tab that's already lost the race) must never
   *  clear someone else's active lock. */
  async clearIfHeldBy(tabId: number): Promise<void> {
    const result = await this.storage.get(KEY);
    const lock = result[KEY] as OverlayLock | null | undefined;
    if (lock?.tabId === tabId) await this.storage.set({ [KEY]: null });
  }
}
