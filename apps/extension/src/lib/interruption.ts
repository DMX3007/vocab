export interface QuietHours {
  /** hour the quiet period starts, 0-23, inclusive */
  fromHour: number;
  /** hour the quiet period ends, 0-23, exclusive; may be smaller than fromHour (the range crosses midnight) */
  toHour: number;
}

export interface InterruptionSettings {
  /** minimum minutes between two review cards */
  throttleMinutes: number;
  /** hard ceiling of cards per hour */
  maxPerHour: number;
  /** how many cards were already shown in the last hour */
  shownInLastHour: number;
  quietHours: QuietHours | null;
}

/** Everything the service worker gathers before asking "may I show a card?" */
export interface InterruptionContext {
  now: Date;
  dueCount: number;
  userIsTyping: boolean;
  isFullscreen: boolean;
  hostBlocklisted: boolean;
  lastShownAt: Date | null;
  snoozedUntil: Date | null;
  settings: InterruptionSettings;
}

// Every denial carries a machine-readable reason — these go straight
// into analytics so we can see WHY cards are not being shown.
export type DenialReason =
  | 'nothing_due'
  | 'user_typing'
  | 'fullscreen'
  | 'host_blocklisted'
  | 'throttled'
  | 'snoozed'
  | 'hourly_cap'
  | 'quiet_hours';

export type InterruptionDecision =
  | { allowed: true }
  | { allowed: false; reason: DenialReason };

const deny = (reason: DenialReason): InterruptionDecision => ({ allowed: false, reason });

const MS_PER_MINUTE = 60_000;

function minutesBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_MINUTE;
}

function isInsideQuietHours(now: Date, quiet: QuietHours): boolean {
  // NOTE: uses UTC for now; switching to the user's local time zone
  // is in the loop-6 backlog.
  const hour = now.getUTCHours();

  const rangeCrossesMidnight = quiet.fromHour > quiet.toHour;
  if (rangeCrossesMidnight) {
    // e.g. from 22 to 8 → quiet at 22, 23, 0, 1, ... 7
    return hour >= quiet.fromHour || hour < quiet.toHour;
  }
  // e.g. from 13 to 15 → quiet at 13 and 14
  return hour >= quiet.fromHour && hour < quiet.toHour;
}

/**
 * The politeness layer between "a card is due" and "we draw an overlay
 * on the user's active tab".
 *
 * Pure and synchronous on purpose: the service worker GATHERS the
 * context (queries the DOM state, storage, settings), this function
 * only DECIDES. That split is what makes the rules testable.
 *
 * Checks run roughly from "pointless" to "impolite" — the first
 * matching rule wins and becomes the reported reason.
 */
export function canInterrupt(context: InterruptionContext): InterruptionDecision {
  // Nothing to show — no reason to even consider interrupting.
  if (context.dueCount <= 0) return deny('nothing_due');

  // Never steal focus from someone who is typing.
  if (context.userIsTyping) return deny('user_typing');

  // Never draw over fullscreen video, presentations, games.
  if (context.isFullscreen) return deny('fullscreen');

  // The user explicitly banned this site (e.g. their banking page).
  if (context.hostBlocklisted) return deny('host_blocklisted');

  // The user pressed "snooze" — respect it until it expires.
  const snoozeIsActive =
    context.snoozedUntil !== null && context.now < context.snoozedUntil;
  if (snoozeIsActive) return deny('snoozed');

  // Hard ceiling per hour, regardless of how many cards are due.
  if (context.settings.shownInLastHour >= context.settings.maxPerHour) {
    return deny('hourly_cap');
  }

  // Do-not-disturb window (may cross midnight, e.g. 22:00 → 08:00).
  if (
    context.settings.quietHours !== null &&
    isInsideQuietHours(context.now, context.settings.quietHours)
  ) {
    return deny('quiet_hours');
  }

  // Not sooner than throttleMinutes after the previous card
  // (the "EVERY 10 min" setting from the popup lives here).
  if (context.lastShownAt !== null) {
    const minutesSinceLastCard = minutesBetween(context.lastShownAt, context.now);
    if (minutesSinceLastCard < context.settings.throttleMinutes) {
      return deny('throttled');
    }
  }

  return { allowed: true };
}
