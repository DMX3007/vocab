import { describe, it, expect } from 'vitest';
import {
  decideOverlay,
  snooze,
  pauseFor,
  resume,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  isPausedOrSnoozed,
  defaultSettings,
  shouldShowStreakReminder,
  markStreakReminderShown,
  type OverlayDecision,
  type OverlaySettings,
  type PageContext,
} from '../src/lib/review/overlay-policy';

// OverlayDecision is a discriminated union where only 'wait'/'idle' carry a
// reason; this narrows it for assertions instead of casting.
const reasonOf = (d: OverlayDecision) => ('reason' in d ? d.reason : undefined);

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

describe('pausing suppresses interruptions WITHOUT touching the schedule', () => {
  // The property the popup's pause button is sold on: it stops cards being
  // pushed at you, but every word keeps its own dueAt, so the backlog and
  // the Review tab's countdowns keep advancing in real time while paused.
  it.each(['15m', '1h', 'tomorrow', 'indefinite'] as const)(
    'pauseFor(%s) changes only the two pause fields, nothing else',
    (preset) => {
      const before = settings();
      const after = pauseFor(before, NOW, preset);
      const { pausedUntil: _pu, pausedIndefinitely: _pi, ...restBefore } = before;
      const { pausedUntil: _pu2, pausedIndefinitely: _pi2, ...restAfter } = after;
      expect(restAfter).toEqual(restBefore);
      expect(before).not.toBe(after); // pure: the original is never mutated
    },
  );

  it('a paused overlay reports "waiting", not "nothing due" — the words are still due', () => {
    const decision = decideOverlay(settings({ pausedIndefinitely: true }), page, NOW);
    expect(decision).toEqual({ action: 'wait', reason: 'paused' });
  });
});

describe('decideOverlay', () => {
  it('DEMO MODE suppresses normal review entirely (experimental — see src/lib/demo/)', () => {
    // The whole isolation contract: while the demo is on, the ambient
    // overlay must never fire, no matter how overdue anything is.
    const decision = decideOverlay(settings({ demoModeEnabled: true }), page, NOW);
    // Narrowed rather than reaching for .reason directly — OverlayDecision's
    // 'show' arm has no reason field.
    expect(decision).toEqual({ action: 'wait', reason: 'paused' });
  });

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
    expect(reasonOf(waiting)).toBe('snoozed');
    expect(decideOverlay(s, page, inMin(16)).action).toBe('show');
  });

  it('waits while globally paused, regardless of due count', () => {
    const s = settings({ pausedUntil: inMin(60).toISOString() });
    const d = decideOverlay(s, page, NOW);
    expect(d.action).toBe('wait');
    expect(reasonOf(d)).toBe('paused');
  });

  it('waits while paused indefinitely, with no expiry', () => {
    const s = settings({ pausedIndefinitely: true });
    const d = decideOverlay(s, page, NOW);
    expect(d.action).toBe('wait');
    expect(reasonOf(d)).toBe('paused');
    // still waiting, no matter how far into the future
    const farFuture = new Date(NOW.getTime() + 365 * 24 * 60 * 60_000);
    expect(decideOverlay(s, page, farFuture).action).toBe('wait');
  });

  it('waits on a blacklisted host (and its subdomains)', () => {
    const s = settings({ blacklist: ['youtube.com'] });
    expect(reasonOf(decideOverlay(s, { ...page, host: 'youtube.com' }, NOW))).toBe('blacklisted');
    expect(reasonOf(decideOverlay(s, { ...page, host: 'www.youtube.com' }, NOW))).toBe('blacklisted');
    expect(decideOverlay(s, { ...page, host: 'example.com' }, NOW).action).toBe('show');
  });

  it('defers to the interruption layer: typing and fullscreen wait', () => {
    expect(decideOverlay(settings(), { ...page, userIsTyping: true }, NOW).action).toBe('wait');
    expect(decideOverlay(settings(), { ...page, isFullscreen: true }, NOW).action).toBe('wait');
  });

  it('respects the throttle between consecutive cards', () => {
    const s = settings({ lastShownAt: inMin(-5).toISOString(), throttleMinutes: 10 });
    expect(reasonOf(decideOverlay(s, page, NOW))).toBe('throttled');
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

  it('pauseFor supports an indefinite preset with no expiry timestamp', () => {
    const s = pauseFor(settings(), NOW, 'indefinite');
    expect(s.pausedIndefinitely).toBe(true);
    expect(s.pausedUntil).toBeNull();
    expect(isPausedOrSnoozed(s, new Date(NOW.getTime() + 365 * 24 * 60 * 60_000))).toBe(true);
  });

  it('resume clears pause, snooze, and the indefinite pause immediately (manual override)', () => {
    const paused = settings({
      pausedUntil: inMin(600).toISOString(),
      snoozedUntil: inMin(15).toISOString(),
      pausedIndefinitely: true,
    });
    const r = resume(paused);
    expect(r.pausedUntil).toBeNull();
    expect(r.snoozedUntil).toBeNull();
    expect(r.pausedIndefinitely).toBe(false);
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

describe('isPausedOrSnoozed', () => {
  it('false with neither set', () => {
    expect(isPausedOrSnoozed(settings(), NOW)).toBe(false);
  });
  it('true while paused', () => {
    expect(isPausedOrSnoozed(settings({ pausedUntil: inMin(15).toISOString() }), NOW)).toBe(true);
  });
  it('true while snoozed', () => {
    expect(isPausedOrSnoozed(settings({ snoozedUntil: inMin(5).toISOString() }), NOW)).toBe(true);
  });
  it('false once the pause/snooze has expired', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(isPausedOrSnoozed(settings({ pausedUntil: past, snoozedUntil: past }), NOW)).toBe(false);
  });
});

describe('shouldShowStreakReminder', () => {
  // Local-time literals (no 'Z'): shouldShowStreakReminder reads local hours,
  // so the test needs to control that directly, not UTC.
  const EVENING = new Date('2026-06-10T20:00:00');
  const AFTERNOON = new Date('2026-06-10T14:00:00');
  const stats = { todayCount: 2, dailyGoal: 10, streak: 5 };

  it('fires when the goal is unmet, a streak is on the line, and it is late', () => {
    expect(shouldShowStreakReminder(stats, settings(), page, EVENING)).toBe(true);
  });

  it('does not fire before the risk hour — there is still time today', () => {
    expect(shouldShowStreakReminder(stats, settings(), page, AFTERNOON)).toBe(false);
  });

  it('does not fire once the goal is already met', () => {
    expect(shouldShowStreakReminder({ ...stats, todayCount: 10 }, settings(), page, EVENING)).toBe(false);
  });

  it('does not fire with no streak to protect', () => {
    expect(shouldShowStreakReminder({ ...stats, streak: 0 }, settings(), page, EVENING)).toBe(false);
  });

  it('does not fire twice in the same day', () => {
    const s = markStreakReminderShown(settings(), EVENING);
    expect(shouldShowStreakReminder(stats, s, page, EVENING)).toBe(false);
    // but does again the next day
    const nextDay = new Date(EVENING.getTime() + 24 * 60 * 60_000);
    expect(shouldShowStreakReminder(stats, s, page, nextDay)).toBe(true);
  });

  it('respects pause/snooze/blacklist/typing/fullscreen like the ambient overlay does', () => {
    expect(shouldShowStreakReminder(stats, settings({ pausedUntil: new Date(EVENING.getTime() + 1000).toISOString() }), page, EVENING)).toBe(false);
    expect(shouldShowStreakReminder(stats, settings({ blacklist: ['example.com'] }), page, EVENING)).toBe(false);
    expect(shouldShowStreakReminder(stats, settings(), { ...page, userIsTyping: true }, EVENING)).toBe(false);
    expect(shouldShowStreakReminder(stats, settings(), { ...page, isFullscreen: true }, EVENING)).toBe(false);
  });
});
