import { canInterrupt, type InterruptionSettings } from '../interruption';

// Decides whether the review overlay may pop on the active tab right now.
// Pure and synchronous: the caller gathers the page context and the stored
// settings, this only decides. Settings live in chrome.storage (shared
// across all tabs), so a pause set on one tab silently calms every tab.

export type PausePreset = '15m' | '1h' | 'tomorrow';

export interface OverlaySettings {
  /** ISO string or null. Temporary "remind me later". */
  snoozedUntil: string | null;
  /** ISO string or null. Global "do not disturb" until this time. */
  pausedUntil: string | null;
  /** domains where the overlay never appears (matches subdomains too) */
  blacklist: string[];
  /** when the last card was shown, ISO string or null */
  lastShownAt: string | null;
  /** minimum minutes between two cards */
  throttleMinutes: number;
  /** hard ceiling of cards per hour */
  maxPerHour: number;
  /** cards already shown in the last hour */
  shownInLastHour: number;
}

export function defaultSettings(): OverlaySettings {
  return {
    snoozedUntil: null,
    pausedUntil: null,
    blacklist: [],
    lastShownAt: null,
    throttleMinutes: 10,
    maxPerHour: 4,
    shownInLastHour: 0,
  };
}

export interface PageContext {
  host: string;
  dueCount: number;
  userIsTyping: boolean;
  isFullscreen: boolean;
}

export type OverlayAction = 'show' | 'wait' | 'idle';

export type OverlayReason =
  | 'snoozed'
  | 'paused'
  | 'blacklisted'
  | 'throttled'
  | 'interruption' // typing / fullscreen / quiet hours, decided by canInterrupt
  | 'nothing_due';

export type OverlayDecision =
  | { action: 'show' }
  | { action: 'idle'; reason: 'nothing_due' }
  | { action: 'wait'; reason: OverlayReason };

const isActive = (until: string | null, now: Date): boolean =>
  until !== null && now.getTime() < new Date(until).getTime();

/** A host is blacklisted if it equals, or is a subdomain of, a listed domain. */
export function isBlacklisted(settings: OverlaySettings, host: string): boolean {
  return settings.blacklist.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function decideOverlay(
  settings: OverlaySettings,
  page: PageContext,
  now: Date,
): OverlayDecision {
  if (page.dueCount <= 0) return { action: 'idle', reason: 'nothing_due' };

  // Our own overrides first — the user's explicit choices win.
  if (isActive(settings.pausedUntil, now)) return { action: 'wait', reason: 'paused' };
  if (isActive(settings.snoozedUntil, now)) return { action: 'wait', reason: 'snoozed' };
  if (isBlacklisted(settings, page.host)) return { action: 'wait', reason: 'blacklisted' };

  // Then the shared politeness layer (typing, fullscreen, quiet hours, throttle, cap).
  const interruption: InterruptionSettings = {
    throttleMinutes: settings.throttleMinutes,
    maxPerHour: settings.maxPerHour,
    shownInLastHour: settings.shownInLastHour,
    quietHours: null,
  };
  const verdict = canInterrupt({
    now,
    dueCount: page.dueCount,
    userIsTyping: page.userIsTyping,
    isFullscreen: page.isFullscreen,
    hostBlocklisted: false, // handled above with subdomain matching
    lastShownAt: settings.lastShownAt === null ? null : new Date(settings.lastShownAt),
    snoozedUntil: null, // handled above
    settings: interruption,
  });

  if (!verdict.allowed) {
    const reason: OverlayReason = verdict.reason === 'throttled' ? 'throttled' : 'interruption';
    return { action: 'wait', reason };
  }

  return { action: 'show' };
}

// ── settings mutations (pure: return a new settings object) ────────
const MS_PER_MIN = 60_000;
const SNOOZE_MINUTES = 15;

export function snooze(settings: OverlaySettings, now: Date): OverlaySettings {
  return { ...settings, snoozedUntil: new Date(now.getTime() + SNOOZE_MINUTES * MS_PER_MIN).toISOString() };
}

export function pauseFor(settings: OverlaySettings, now: Date, preset: PausePreset): OverlaySettings {
  let until: Date;
  if (preset === '15m') until = new Date(now.getTime() + 15 * MS_PER_MIN);
  else if (preset === '1h') until = new Date(now.getTime() + 60 * MS_PER_MIN);
  else {
    // 'tomorrow' = next local midnight
    until = new Date(now);
    until.setHours(24, 0, 0, 0);
  }
  return { ...settings, pausedUntil: until.toISOString() };
}

/** Manual override: cancel pause AND snooze right now, even if not expired. */
export function resume(settings: OverlaySettings): OverlaySettings {
  return { ...settings, pausedUntil: null, snoozedUntil: null };
}

export function addToBlacklist(settings: OverlaySettings, host: string): OverlaySettings {
  if (settings.blacklist.includes(host)) return settings;
  return { ...settings, blacklist: [...settings.blacklist, host] };
}

export function removeFromBlacklist(settings: OverlaySettings, host: string): OverlaySettings {
  return { ...settings, blacklist: settings.blacklist.filter((h) => h !== host) };
}
