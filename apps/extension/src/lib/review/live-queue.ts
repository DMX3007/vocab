import type { Word } from '../storage/types';

// Instead of loading the whole library and re-sorting it every tick, we
// only ever track the soonest MAX_TRACKED_WORDS words. That cap is what
// keeps a live, ticking due list cheap even once a library grows into the
// thousands — everything past the cap simply isn't due soon enough to be
// worth watching yet, and naturally enters the tracked pool once it is.

export const MAX_TRACKED_WORDS = 100;

/** The N soonest-due words (already due or not), ascending by dueAt. */
export function trackedWords(words: Word[], limit = MAX_TRACKED_WORDS): Word[] {
  return [...words]
    .sort((a, b) => a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime())
    .slice(0, limit);
}

/** Milliseconds until a word is due; negative once it's overdue. */
export function msUntilDue(word: Word, now: Date): number {
  return word.srsState.dueAt.getTime() - now.getTime();
}

/** A compact "time remaining" label — whichever unit reads most naturally.
 *  Callers only show this for words that aren't due yet, so it never needs
 *  to represent a negative duration. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const remMinutes = totalMinutes % 60;
    return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d`;
}

/** The overdue counterpart to formatCountdown — "how long has this word
 *  been waiting", for words whose due time has already passed. Every due
 *  word gets one of these; it isn't just a static "Due" label. */
export function formatOverdue(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 5000) return 'just now';
  return `${formatCountdown(clamped)} overdue`;
}
