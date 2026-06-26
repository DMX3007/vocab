import {
  decideOverlay,
  type OverlaySettings,
  type PageContext,
} from './overlay-policy';

// The pure brain of the alarm handler. The background gathers settings and
// the active tab's page context, calls this, and acts on the result:
//   - show: render the overlay on the active tab
//   - settings: persist these (records the show for throttle + hourly cap)
// chrome.alarms wiring and message-sending stay outside this file.

const ONE_HOUR_MS = 3_600_000;

export interface TickResult {
  show: boolean;
  /** settings to persist, or null when nothing changed */
  settings: OverlaySettings | null;
}

export function planTick(
  settings: OverlaySettings,
  page: PageContext,
  now: Date,
): TickResult {
  // Roll the hourly window first: if the last card was over an hour ago,
  // the counter is stale and must restart before we check the cap.
  const lastShown = settings.lastShownAt ? new Date(settings.lastShownAt) : null;
  const windowExpired = lastShown === null || now.getTime() - lastShown.getTime() >= ONE_HOUR_MS;
  const effective: OverlaySettings = windowExpired
    ? { ...settings, shownInLastHour: 0 }
    : settings;

  const decision = decideOverlay(effective, page, now);
  if (decision.action !== 'show') {
    return { show: false, settings: null };
  }

  // We're showing a card — stamp the time and bump the hourly counter.
  return {
    show: true,
    settings: {
      ...effective,
      lastShownAt: now.toISOString(),
      shownInLastHour: effective.shownInLastHour + 1,
    },
  };
}
