import { canInterrupt, type InterruptionSettings } from '../interruption';
import { DEFAULT_TARGET_LANG } from '../languages';
import { localDateKey } from './progress';
import type { AlgoId, Pace } from '@vocably/core';

// Decides whether the review overlay may pop on the active tab right now.
// Pure and synchronous: the caller gathers the page context and the stored
// settings, this only decides. Settings live in chrome.storage (shared
// across all tabs), so a pause set on one tab silently calms every tab.

export type PausePreset = '15m' | '1h' | 'tomorrow' | 'indefinite';

export interface OverlaySettings {
  /** ISO string or null. Temporary "remind me later". */
  snoozedUntil: string | null;
  /** ISO string or null. Global "do not disturb" until this time. */
  pausedUntil: string | null;
  /** Global "do not disturb" with no end time — only resume() clears it.
   *  Kept separate from pausedUntil (rather than a sentinel value in it) so
   *  isActive()'s date parsing never has to special-case "forever". */
  pausedIndefinitely: boolean;
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
  /** the language currently being learned (an ISO code from SUPPORTED_LANGUAGES) */
  targetLang: string;
  /** the scheduler NEW words are saved with; existing words keep whatever they were saved/moved onto */
  defaultAlgo: AlgoId;
  /** how hard NEW sm2 words get drilled before graduating; existing words
   *  keep whatever pace they were saved/moved onto (see word-repository.ts) */
  defaultPace: Pace;
  /** reviews per day the Progress tab's goal bar targets; user-editable */
  dailyGoal: number;
  /** new words per day the Progress tab's second goal bar targets; user-editable */
  dailyAddGoal: number;
  /** banked "cover one missed day" credits, Duolingo-style — see applyStreakMaintenance */
  streakFreezes: number;
  /** date-keys (progress.ts's localDateKey) of days a freeze covered, so a
   *  missed day still counts as active for streak purposes */
  frozenDates: string[];
  /** highest streak milestone a freeze has already been awarded for, so
   *  crossing it again (e.g. after a freeze bridges a gap) doesn't re-pay it */
  lastMilestoneAwarded: number;
  /** date-key of the last time the streak-at-risk reminder was shown, so it
   *  fires at most once per day */
  lastStreakReminderDate: string | null;
  /** achievement ids (progress.ts's track-tier or one-off ids) already shown
   *  in an "unlocked!" toast — see Popup.tsx's refresh(). Diffing the live
   *  unlocked set against this is what tells a *new* unlock apart from one
   *  the user's already seen. */
  seenAchievements: string[];
  /** Hands-free review: when on, every card auto-starts listening (no mic
   *  button press needed), a transcript auto-submits for grading, and a
   *  correct verdict auto-advances to the next card after a beat — a wrong
   *  one stops and waits for Next/Finish like normal, so the mistake stays
   *  on screen instead of flashing past. Toggleable from the Review tab
   *  (Popup) or the mic button on the card itself; either one flips this
   *  same stored value, shared via chrome.storage across every context. */
  voiceReviewEnabled: boolean;
}

export function defaultSettings(): OverlaySettings {
  return {
    snoozedUntil: null,
    pausedUntil: null,
    pausedIndefinitely: false,
    blacklist: [],
    lastShownAt: null,
    throttleMinutes: 10,
    maxPerHour: 4,
    shownInLastHour: 0,
    targetLang: DEFAULT_TARGET_LANG,
    defaultAlgo: 'sm2',
    defaultPace: 'aggressive',
    dailyGoal: 10,
    dailyAddGoal: 3,
    streakFreezes: 1,
    frozenDates: [],
    lastMilestoneAwarded: 0,
    lastStreakReminderDate: null,
    seenAchievements: [],
    voiceReviewEnabled: false,
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

/** True while either an explicit pause or a snooze is still in effect. */
export function isPausedOrSnoozed(settings: OverlaySettings, now: Date): boolean {
  return settings.pausedIndefinitely || isActive(settings.pausedUntil, now) || isActive(settings.snoozedUntil, now);
}

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
  if (settings.pausedIndefinitely) return { action: 'wait', reason: 'paused' };
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
  if (preset === 'indefinite') return { ...settings, pausedIndefinitely: true, pausedUntil: null };

  let until: Date;
  if (preset === '15m') until = new Date(now.getTime() + 15 * MS_PER_MIN);
  else if (preset === '1h') until = new Date(now.getTime() + 60 * MS_PER_MIN);
  else {
    // 'tomorrow' = next local midnight
    until = new Date(now);
    until.setHours(24, 0, 0, 0);
  }
  return { ...settings, pausedUntil: until.toISOString(), pausedIndefinitely: false };
}

/** Manual override: cancel pause AND snooze right now, even if not expired. */
export function resume(settings: OverlaySettings): OverlaySettings {
  return { ...settings, pausedUntil: null, snoozedUntil: null, pausedIndefinitely: false };
}

export function addToBlacklist(settings: OverlaySettings, host: string): OverlaySettings {
  if (settings.blacklist.includes(host)) return settings;
  return { ...settings, blacklist: [...settings.blacklist, host] };
}

export function removeFromBlacklist(settings: OverlaySettings, host: string): OverlaySettings {
  return { ...settings, blacklist: settings.blacklist.filter((h) => h !== host) };
}

// ── streak-at-risk reminder ──────────────────────────────────────
/** Local hour after which "still haven't hit today's goal" starts to mean
 *  the streak is genuinely on the line, not just "there's still time". */
export const STREAK_RISK_HOUR = 19;

/** Whether to nudge that today's goal isn't met and an existing streak is
 *  about to break. Distinct from decideOverlay: this ignores the ambient
 *  due-word throttle/cap entirely (it isn't about due words at all) and
 *  fires at most once a day, gated only by pause/snooze/blacklist plus
 *  "is it actually late, and is there a streak worth protecting". */
export function shouldShowStreakReminder(
  params: { todayCount: number; dailyGoal: number; streak: number },
  settings: OverlaySettings,
  page: { host: string; userIsTyping: boolean; isFullscreen: boolean },
  now: Date,
): boolean {
  if (params.todayCount >= params.dailyGoal) return false;
  if (params.streak <= 0) return false;
  if (now.getHours() < STREAK_RISK_HOUR) return false;
  if (settings.lastStreakReminderDate === localDateKey(now)) return false;
  if (isPausedOrSnoozed(settings, now)) return false;
  if (isBlacklisted(settings, page.host)) return false;
  if (page.userIsTyping || page.isFullscreen) return false;
  return true;
}

/** Records that the reminder fired today, so shouldShowStreakReminder
 *  won't fire again until tomorrow. */
export function markStreakReminderShown(settings: OverlaySettings, now: Date): OverlaySettings {
  return { ...settings, lastStreakReminderDate: localDateKey(now) };
}
