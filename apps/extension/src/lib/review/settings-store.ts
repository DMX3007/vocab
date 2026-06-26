import { defaultSettings, type OverlaySettings } from './overlay-policy';

// Persists overlay settings in chrome.storage and notifies on change.
// Because chrome.storage.local is shared across every extension context,
// the subscribe() hook is what makes a pause set on one tab calm all tabs:
// each tab's content script subscribes and reacts to the change event.

const KEY = 'vocabflow_settings';

/** The slice of the chrome.storage.local API we depend on (injected for tests). */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged: {
    addListener(cb: (changes: Record<string, { newValue?: unknown }>) => void): void;
  };
}

export class SettingsStore {
  constructor(private readonly storage: StorageArea) {}

  /** Loads settings, filling any missing field from defaults (forward-compatible). */
  async load(): Promise<OverlaySettings> {
    const result = await this.storage.get(KEY);
    const stored = (result[KEY] ?? {}) as Partial<OverlaySettings>;
    return { ...defaultSettings(), ...stored };
  }

  async save(settings: OverlaySettings): Promise<void> {
    await this.storage.set({ [KEY]: settings });
  }

  /** Loads, applies a pure change, saves the result, returns it. */
  async update(change: (current: OverlaySettings) => OverlaySettings): Promise<OverlaySettings> {
    const next = change(await this.load());
    await this.save(next);
    return next;
  }

  /** Calls back with the new settings whenever they change (in any tab). */
  subscribe(callback: (settings: OverlaySettings) => void): void {
    this.storage.onChanged.addListener((changes) => {
      const change = changes[KEY];
      if (!change) return; // ignore unrelated keys
      const stored = (change.newValue ?? {}) as Partial<OverlaySettings>;
      callback({ ...defaultSettings(), ...stored });
    });
  }
}
