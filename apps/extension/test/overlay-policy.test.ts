import { describe, it, expect } from 'vitest';
import {
  decideOverlay,
  snooze,
  pauseFor,
  resume,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  defaultSettings,
  type OverlaySettings,
  type PageContext,
} from '../src/lib/review/overlay-policy';

const NOW = new Date('2026-06-10T14:00:00Z');
const inMin = (n: number) => new Date(NOW.getTime() + n * 60_000);

const page: PageContext = {
  host: 'example.com',
  dueCount: 3,
  userIsTyping: false,
  isFullscreen: false,
};

const settings = (over: Partial<OverlaySettings> = {}): OverlaySettings => ({
  ...defaultSettings(),
  ...over,
});

describe('decideOverlay', () => {
  it('shows the overlay when something is due and nothing objects', () => {
    expect(decideOverlay(settings(), page, NOW).action).toBe('show');
  });

  it('stays idle when nothing is due', () => {
    expect(decideOverlay(settings(), { ...page, dueCount: 0 }, NOW).action).toBe('idle');
  });

  it('waits while snoozed, and shows again once snooze passes', () => {
    const s = settings({ snoozedUntil: inMin(15).toISOString() });
    const waiting = decideOverlay(s, page, NOW);
    expect(waiting.action).toBe('wait');
    expect(waiting.reason).toBe('snoozed');
    expect(decideOverlay(s, page, inMin(16)).action).toBe('show');
  });

  it('waits while globally paused, regardless of due count', () => {
    const s = settings({ pausedUntil: inMin(60).toISOString() });
    const d = decideOverlay(s, page, NOW);
    expect(d.action).toBe('wait');
    expect(d.reason).toBe('paused');
  });

  it('waits on a blacklisted host (and its subdomains)', () => {
    const s = settings({ blacklist: ['youtube.com'] });
    expect(decideOverlay(s, { ...page, host: 'youtube.com' }, NOW).reason).toBe('blacklisted');
    expect(decideOverlay(s, { ...page, host: 'www.youtube.com' }, NOW).reason).toBe('blacklisted');
    expect(decideOverlay(s, { ...page, host: 'example.com' }, NOW).action).toBe('show');
  });

  it('defers to the interruption layer: typing and fullscreen wait', () => {
    expect(decideOverlay(settings(), { ...page, userIsTyping: true }, NOW).action).toBe('wait');
    expect(decideOverlay(settings(), { ...page, isFullscreen: true }, NOW).action).toBe('wait');
  });

  it('respects the throttle between consecutive cards', () => {
    const s = settings({ lastShownAt: inMin(-5).toISOString(), throttleMinutes: 10 });
    expect(decideOverlay(s, page, NOW).reason).toBe('throttled');
    const s2 = settings({ lastShownAt: inMin(-15).toISOString(), throttleMinutes: 10 });
    expect(decideOverlay(s2, page, NOW).action).toBe('show');
  });
});

describe('snooze / pause / resume', () => {
  it('snooze sets snoozedUntil 15 minutes ahead by default', () => {
    const s = snooze(settings(), NOW);
    expect(s.snoozedUntil).toBe(inMin(15).toISOString());
  });

  it('pauseFor supports 15m, 1h and until-tomorrow presets', () => {
    expect(pauseFor(settings(), NOW, '15m').pausedUntil).toBe(inMin(15).toISOString());
    expect(pauseFor(settings(), NOW, '1h').pausedUntil).toBe(inMin(60).toISOString());
    const tomorrow = pauseFor(settings(), NOW, 'tomorrow').pausedUntil!;
    expect(new Date(tomorrow).getTime()).toBeGreaterThan(inMin(60).getTime());
  });

  it('resume clears both pause and snooze immediately (manual override)', () => {
    const paused = settings({
      pausedUntil: inMin(600).toISOString(),
      snoozedUntil: inMin(15).toISOString(),
    });
    const r = resume(paused);
    expect(r.pausedUntil).toBeNull();
    expect(r.snoozedUntil).toBeNull();
    expect(decideOverlay(r, page, NOW).action).toBe('show');
  });
});

describe('blacklist helpers', () => {
  it('adds a host once (no duplicates) and detects it', () => {
    let s = addToBlacklist(settings(), 'youtube.com');
    s = addToBlacklist(s, 'youtube.com');
    expect(s.blacklist).toEqual(['youtube.com']);
    expect(isBlacklisted(s, 'www.youtube.com')).toBe(true);
    expect(isBlacklisted(s, 'example.com')).toBe(false);
  });

  it('removes a host', () => {
    const s = removeFromBlacklist(settings({ blacklist: ['youtube.com', 'mail.com'] }), 'youtube.com');
    expect(s.blacklist).toEqual(['mail.com']);
  });
});
