import { describe, it, expect } from 'vitest';
import { planTick } from '../src/lib/review/scheduler';
import { defaultSettings, type OverlaySettings, type PageContext } from '../src/lib/review/overlay-policy';

// planTick is the pure brain of the alarm handler. On each alarm the
// background gathers settings + the active tab's page context, calls this,
// and gets back: whether to show the overlay, and the settings to persist
// (e.g. recording that a card was just shown, for throttle + hourly cap).
// The actual chrome.alarms wiring and message-sending live outside, untested.

const NOW = new Date('2026-06-10T14:00:00Z');
const minAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const page: PageContext = {
  host: 'example.com',
  dueCount: 5,
  userIsTyping: false,
  isFullscreen: false,
};
const settings = (over: Partial<OverlaySettings> = {}): OverlaySettings => ({
  ...defaultSettings(),
  ...over,
});

describe('planTick', () => {
  it('says show when due and clear, and records the show in the returned settings', () => {
    const r = planTick(settings(), page, NOW);
    expect(r.show).toBe(true);
    expect(r.settings).not.toBeNull();
    expect(r.settings!.lastShownAt).toBe(NOW.toISOString()); // stamped now
    expect(r.settings!.shownInLastHour).toBe(1); // counted
  });

  it('does not show and writes nothing back when paused', () => {
    const r = planTick(settings({ pausedUntil: new Date(NOW.getTime() + 3.6e6).toISOString() }), page, NOW);
    expect(r.show).toBe(false);
    expect(r.settings).toBeNull(); // no state change needed
  });

  it('does not show when nothing is due', () => {
    const r = planTick(settings(), { ...page, dueCount: 0 }, NOW);
    expect(r.show).toBe(false);
    expect(r.settings).toBeNull();
  });

  it('increments the hourly counter from its previous value', () => {
    const r = planTick(settings({ shownInLastHour: 2, lastShownAt: minAgo(20) }), page, NOW);
    expect(r.show).toBe(true);
    expect(r.settings!.shownInLastHour).toBe(3);
  });

  it('resets the hourly counter when the last show was more than an hour ago', () => {
    const r = planTick(settings({ shownInLastHour: 4, lastShownAt: minAgo(90) }), page, NOW);
    // a fresh hour window -> count restarts at 1, and it shows
    expect(r.show).toBe(true);
    expect(r.settings!.shownInLastHour).toBe(1);
  });

  it('respects the hourly cap within the same hour window', () => {
    const r = planTick(settings({ shownInLastHour: 4, lastShownAt: minAgo(10) }), page, NOW);
    expect(r.show).toBe(false);
    expect(r.settings).toBeNull();
  });
});
