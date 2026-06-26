import { describe, it, expect } from 'vitest';
import { canInterrupt, type InterruptionContext } from '../src/lib/interruption';

const NOW = new Date('2026-06-10T14:00:00Z'); // 14:00 UTC

const base: InterruptionContext = {
  now: NOW,
  dueCount: 3,
  userIsTyping: false,
  isFullscreen: false,
  hostBlocklisted: false,
  lastShownAt: null,
  snoozedUntil: null,
  settings: {
    throttleMinutes: 10,
    maxPerHour: 4,
    shownInLastHour: 0,
    quietHours: null,
  },
};

describe('canInterrupt', () => {
  it('allows when cards are due and nothing objects', () => {
    expect(canInterrupt(base).allowed).toBe(true);
  });

  it('denies when nothing is due', () => {
    expect(canInterrupt({ ...base, dueCount: 0 }).allowed).toBe(false);
  });

  it('never interrupts typing or fullscreen', () => {
    expect(canInterrupt({ ...base, userIsTyping: true }).allowed).toBe(false);
    expect(canInterrupt({ ...base, isFullscreen: true }).allowed).toBe(false);
  });

  it('respects per-site blocklist', () => {
    expect(canInterrupt({ ...base, hostBlocklisted: true }).allowed).toBe(false);
  });

  it('respects the throttle: not sooner than throttleMinutes after last card', () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60_000);
    const fifteenMinAgo = new Date(NOW.getTime() - 15 * 60_000);
    expect(canInterrupt({ ...base, lastShownAt: fiveMinAgo }).allowed).toBe(false);
    expect(canInterrupt({ ...base, lastShownAt: fifteenMinAgo }).allowed).toBe(true);
  });

  it('respects snooze', () => {
    const inTenMin = new Date(NOW.getTime() + 10 * 60_000);
    expect(canInterrupt({ ...base, snoozedUntil: inTenMin }).allowed).toBe(false);
  });

  it('caps interruptions per hour', () => {
    const ctx = { ...base, settings: { ...base.settings, shownInLastHour: 4 } };
    expect(canInterrupt(ctx).allowed).toBe(false);
  });

  it('honors quiet hours, including ranges crossing midnight', () => {
    const quiet = { ...base, settings: { ...base.settings, quietHours: { fromHour: 22, toHour: 8 } } };
    const at23 = new Date('2026-06-10T23:30:00Z');
    const at07 = new Date('2026-06-10T07:30:00Z');
    const at12 = new Date('2026-06-10T12:00:00Z');
    expect(canInterrupt({ ...quiet, now: at23 }).allowed).toBe(false);
    expect(canInterrupt({ ...quiet, now: at07 }).allowed).toBe(false);
    expect(canInterrupt({ ...quiet, now: at12 }).allowed).toBe(true);
  });

  it('returns a machine-readable reason for every denial', () => {
    const denied = canInterrupt({ ...base, dueCount: 0 });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('nothing_due');
  });
});
