import { DEFAULT_LEITNER_CONFIG } from '@vocably/core';
import type { Word, ReviewLog } from '../storage/types';
import type { OverlaySettings } from './overlay-policy';

// Turns the raw word + review-log history into the numbers the Progress tab
// shows. Pure and synchronous — the popup fetches words/logs via wordClient,
// this only computes. Kept separate from the repository so the derivation
// (what counts as "mastered", how XP/streak are defined) is unit-testable
// without touching IndexedDB.

/** Grades below this are a miss; matches the core scheduler's pass/fail split. */
const PASS_GRADE = 3;
const XP_PER_PASS = 10;
const XP_PER_LEVEL = 100;
/** A word is "mastered" once its SRS interval has grown past three weeks. */
export const MASTERED_INTERVAL_DAYS = 21;
/** Used only as a fallback when a caller doesn't pass its own goal —
 *  overlay-policy.ts's defaultSettings() owns the real default. */
const FALLBACK_DAILY_GOAL = 10;
const FALLBACK_DAILY_ADD_GOAL = 3;

/** Algo-aware "mastered": Leitner's box ladder tops out at 16 days, which
 *  never crosses MASTERED_INTERVAL_DAYS — so for Leitner, "mastered" means
 *  "reached the last box" instead of a fixed day count. */
export function isMastered(word: Word): boolean {
  if (word.srsState.algo === 'leitner') {
    return word.srsState.stepIndex >= DEFAULT_LEITNER_CONFIG.boxIntervalDays.length - 1;
  }
  return word.srsState.intervalDays >= MASTERED_INTERVAL_DAYS;
}

export const LEVEL_TITLES = [
  '', 'Beginner', 'Explorer', 'Learner', 'Student', 'Scholar',
  'Expert', 'Master', 'Polyglot', 'Linguist', 'Legend',
];

export interface ProgressStats {
  totalReviews: number;
  correctReviews: number;
  /** 0-100, rounded */
  accuracy: number;
  xp: number;
  level: number;
  /** xp earned within the current level, 0-99 */
  xpInLevel: number;
  levelTitle: string;
  /** consecutive days (today counts once it has a review; otherwise counted through yesterday) */
  streak: number;
  /** review count per weekday for the last 7 days, keyed 0=Sun..6=Sat */
  dailyReviews: Record<number, number>;
  todayIdx: number;
  todayCount: number;
  goal: number;
  mastered: number;
  /** longest run of consecutive review-days ever recorded (may exceed the current streak) */
  longestStreak: number;
  /** smallest streak milestone still ahead */
  nextMilestone: number;
  /** consecutive days with at least one word captured via the in-page
   *  tooltip (sourceUrl set) — separate from the review streak above, since
   *  reviewing and reading/collecting are different habits. */
  readingStreak: number;
  /** words (any source) created on today's local date */
  todayAddedCount: number;
  addGoal: number;
}

const MS_PER_DAY = 86_400_000;
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Exported so the streak-freeze maintenance below (and its tests) key
 *  dates the exact same way the streak computation itself does. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfLocalDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Consecutive-day streak ending today, or ending yesterday if today has no review yet
 *  (a streak isn't broken by a day that hasn't finished). A date in `frozenDates`
 *  (a missed day auto-covered by a banked streak freeze — see applyStreakMaintenance)
 *  counts exactly like a day with a real review. */
function computeStreak(logs: ReviewLog[], now: Date, frozenDates: ReadonlySet<string> = EMPTY_SET): number {
  const daysWithReviews = new Set(logs.map((l) => localDateKey(l.reviewedAt)));
  const isActiveDay = (d: Date) => daysWithReviews.has(localDateKey(d)) || frozenDates.has(localDateKey(d));
  const cursor = new Date(now);
  if (!isActiveDay(cursor)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (isActiveDay(cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Same shape as computeStreak, but keyed off words captured via the
 *  in-page tooltip (sourceUrl set) rather than review logs — a separate
 *  habit (reading/collecting) from reviewing, so it gets its own streak
 *  with no freeze mechanic of its own. */
function computeReadingStreak(words: Word[], now: Date): number {
  const daysWithCapture = new Set(
    words.filter((w) => w.sourceUrl).map((w) => localDateKey(w.createdAt)),
  );
  const isActiveDay = (d: Date) => daysWithCapture.has(localDateKey(d));
  const cursor = new Date(now);
  if (!isActiveDay(cursor)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (isActiveDay(cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Distinct domains words have been captured from — only counts
 *  in-page (sourceUrl-bearing) words; a malformed/legacy URL is skipped
 *  rather than thrown on. */
function countDistinctDomains(words: Word[]): number {
  const domains = new Set<string>();
  for (const w of words) {
    if (!w.sourceUrl) continue;
    try { domains.add(new URL(w.sourceUrl).hostname); } catch { /* ignore malformed sourceUrl */ }
  }
  return domains.size;
}

/** Longest-ever run of consecutive review-days, scanning the full history once. */
function computeLongestStreak(logs: ReviewLog[], frozenDates: ReadonlySet<string> = EMPTY_SET): number {
  const dayKeys = new Set(logs.map((l) => localDateKey(l.reviewedAt)));
  for (const key of frozenDates) dayKeys.add(key);
  if (dayKeys.size === 0) return 0;
  const dayTimes = Array.from(dayKeys)
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y!, m!, d!).getTime();
    })
    .sort((a, b) => a - b);

  let longest = 1;
  let current = 1;
  for (let i = 1; i < dayTimes.length; i++) {
    const gap = Math.round((dayTimes[i]! - dayTimes[i - 1]!) / MS_PER_DAY);
    current = gap === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** The smallest streak milestone still ahead of the current streak. */
function computeNextMilestone(streak: number): number {
  return STREAK_MILESTONES.find((m) => m > streak) ?? STREAK_MILESTONES[STREAK_MILESTONES.length - 1]! + 100;
}

/** Review counts per weekday, restricted to the trailing 7-day window ending now. */
function computeDailyReviews(logs: ReviewLog[], now: Date): Record<number, number> {
  const dailyReviews: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const windowStart = startOfLocalDay(new Date(now.getTime() - 6 * MS_PER_DAY)).getTime();
  for (const log of logs) {
    const t = log.reviewedAt.getTime();
    if (t < windowStart || t > now.getTime()) continue;
    const day = log.reviewedAt.getDay();
    dailyReviews[day] = (dailyReviews[day] ?? 0) + 1;
  }
  return dailyReviews;
}

export function computeProgressStats(
  words: Word[],
  logs: ReviewLog[],
  now: Date,
  dailyGoal: number = FALLBACK_DAILY_GOAL,
  frozenDates: ReadonlySet<string> = EMPTY_SET,
  dailyAddGoal: number = FALLBACK_DAILY_ADD_GOAL,
): ProgressStats {
  const totalReviews = logs.length;
  const correctReviews = logs.filter((l) => l.grade >= PASS_GRADE).length;
  const accuracy = totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : 0;

  const xp = correctReviews * XP_PER_PASS;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpInLevel = xp % XP_PER_LEVEL;
  const levelTitle = LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)] ?? 'Legend';

  const dailyReviews = computeDailyReviews(logs, now);
  const todayIdx = now.getDay();
  const todayCount = dailyReviews[todayIdx] ?? 0;

  const mastered = words.filter(isMastered).length;
  const streak = computeStreak(logs, now, frozenDates);
  const todayAddedCount = words.filter((w) => localDateKey(w.createdAt) === localDateKey(now)).length;

  return {
    totalReviews,
    correctReviews,
    accuracy,
    xp,
    level,
    xpInLevel,
    levelTitle,
    streak,
    dailyReviews,
    todayIdx,
    todayCount,
    goal: dailyGoal,
    mastered,
    longestStreak: Math.max(streak, computeLongestStreak(logs, frozenDates)),
    nextMilestone: computeNextMilestone(streak),
    readingStreak: computeReadingStreak(words, now),
    todayAddedCount,
    addGoal: dailyAddGoal,
  };
}

export interface StreakMaintenanceResult {
  settings: OverlaySettings;
  /** Whether anything actually changed — the caller only needs to persist
   *  settings back to storage when this is true. */
  changed: boolean;
}

/**
 * Runs once per popup load, before stats are computed, to keep the streak-
 * freeze bookkeeping current:
 *
 * 1. Consumes a banked freeze if YESTERDAY has no review log, is not
 *    already frozen, and a streak was actually in progress going into it
 *    (the day before yesterday was reviewed or itself frozen) — otherwise
 *    there'd be nothing to protect. Only ever looks at yesterday: if the
 *    extension goes unopened for several days, only the most recent gap
 *    gets a chance at rescue, older gaps stay broken. Today is never
 *    touched — the day isn't over, so there's nothing to rescue yet.
 * 2. Awards one new freeze the first time the (freeze-adjusted) streak
 *    crosses a milestone it hasn't been credited for yet.
 *
 * Pure: returns a new settings object rather than mutating, same as every
 * other overlay-policy.ts settings function.
 */
export function applyStreakMaintenance(
  logs: ReviewLog[],
  settings: OverlaySettings,
  now: Date,
): StreakMaintenanceResult {
  let next = settings;
  let changed = false;

  const daysWithReviews = new Set(logs.map((l) => localDateKey(l.reviewedAt)));
  const frozen = new Set(next.frozenDates);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);

  const dayBefore = new Date(now);
  dayBefore.setDate(dayBefore.getDate() - 2);
  const dayBeforeKey = localDateKey(dayBefore);

  const yesterdayMissed = !daysWithReviews.has(yesterdayKey) && !frozen.has(yesterdayKey);
  const streakWasActive = daysWithReviews.has(dayBeforeKey) || frozen.has(dayBeforeKey);

  if (yesterdayMissed && streakWasActive && next.streakFreezes > 0) {
    frozen.add(yesterdayKey);
    next = { ...next, frozenDates: [...frozen], streakFreezes: next.streakFreezes - 1 };
    changed = true;
  }

  const streak = computeStreak(logs, now, frozen);
  const milestoneHit = [...STREAK_MILESTONES].reverse().find((m) => streak >= m) ?? 0;
  if (milestoneHit > next.lastMilestoneAwarded) {
    next = { ...next, streakFreezes: next.streakFreezes + 1, lastMilestoneAwarded: milestoneHit };
    changed = true;
  }

  return { settings: next, changed };
}

// ── Achievements ──────────────────────────────────────────────────
// Two shapes: a handful of tiered TRACKS (Bronze/Silver/Gold/Platinum on a
// growing metric — reviews done, words collected, etc.) that keep offering
// a next target indefinitely, plus one one-shot achievement ("First word")
// for the very first moment of using the extension at all, which a tier
// system would otherwise make wait for an arbitrary threshold.
//
// Icons: each unlocked/locked tier looks for a PNG at
// /achievements/{trackId}-{tier}.png (or /achievements/first-word.png for
// the one-off) — see AchievementBadge.tsx, which falls back to `glyph`
// below until that file exists. Dropping a PNG into
// apps/extension/public/achievements/ is the entire integration; nothing
// else needs to change.

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export const ACHIEVEMENT_TIERS: readonly AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum'];

export interface AchievementTrack {
  id: string;
  /** Fallback glyph, used until a real icon lands — see AchievementBadge.tsx. */
  glyph: string;
  thresholds: Record<AchievementTier, number>;
  metric: (words: Word[], stats: ProgressStats) => number;
}

export const ACHIEVEMENT_TRACKS: readonly AchievementTrack[] = [
  {
    id: 'consistency',
    glyph: '✦',
    thresholds: { bronze: 3, silver: 14, gold: 60, platinum: 100 },
    metric: (_words, stats) => stats.streak,
  },
  {
    id: 'scholar',
    glyph: 'ℵ',
    thresholds: { bronze: 50, silver: 250, gold: 1000, platinum: 5000 },
    metric: (_words, stats) => stats.totalReviews,
  },
  {
    id: 'mastery',
    glyph: '★',
    thresholds: { bronze: 5, silver: 25, gold: 100, platinum: 300 },
    metric: (_words, stats) => stats.mastered,
  },
  {
    id: 'vocabulary',
    glyph: '∞',
    thresholds: { bronze: 10, silver: 50, gold: 200, platinum: 1000 },
    metric: (words) => words.length,
  },
  {
    id: 'reading',
    glyph: '❧',
    thresholds: { bronze: 10, silver: 50, gold: 200, platinum: 500 },
    // Only words captured via the in-page tooltip (a real sourceUrl) count —
    // deliberately excludes the Add Word modal's manual/paste/sheet paths,
    // so this specifically rewards reading, not just typing words in.
    metric: (words) => words.filter((w) => !!w.sourceUrl).length,
  },
  {
    id: 'explorer',
    glyph: '⁂',
    thresholds: { bronze: 5, silver: 15, gold: 30, platinum: 75 },
    metric: (words) => countDistinctDomains(words),
  },
  {
    id: 'readingStreak',
    glyph: '☙',
    thresholds: { bronze: 3, silver: 7, gold: 30, platinum: 100 },
    metric: (_words, stats) => stats.readingStreak,
  },
];

export interface OneOffAchievement {
  id: string;
  glyph: string;
  unlocked: (words: Word[], stats: ProgressStats) => boolean;
}

export const ONE_OFF_ACHIEVEMENTS: readonly OneOffAchievement[] = [
  { id: 'first-word', glyph: '\u{1D4E5}', unlocked: (words) => words.length >= 1 },
];

export interface AchievementTierProgress {
  tier: AchievementTier;
  threshold: number;
  unlocked: boolean;
}

export interface AchievementTrackProgress {
  id: string;
  glyph: string;
  value: number;
  tiers: readonly AchievementTierProgress[];
  /** Highest unlocked tier, or null if not even Bronze yet. */
  currentTier: AchievementTier | null;
  /** The next locked tier and how close it is, or null once every tier is unlocked. */
  nextTier: { tier: AchievementTier; threshold: number; remaining: number; progressPct: number } | null;
}

export function computeAchievementTracks(words: Word[], stats: ProgressStats): AchievementTrackProgress[] {
  return ACHIEVEMENT_TRACKS.map((track) => {
    const value = track.metric(words, stats);
    let currentTier: AchievementTier | null = null;
    const tiers: AchievementTierProgress[] = ACHIEVEMENT_TIERS.map((tier) => {
      const threshold = track.thresholds[tier];
      const unlocked = value >= threshold;
      if (unlocked) currentTier = tier;
      return { tier, threshold, unlocked };
    });
    const next = tiers.find((tr) => !tr.unlocked) ?? null;
    const nextTier = next
      ? {
          tier: next.tier,
          threshold: next.threshold,
          remaining: Math.max(0, next.threshold - value),
          progressPct: Math.min(100, Math.round((value / next.threshold) * 100)),
        }
      : null;
    return { id: track.id, glyph: track.glyph, value, tiers, currentTier, nextTier };
  });
}

/** The single locked tier (across every track) closest to unlocking — the
 *  Progress tab's "next up" callout, so there's always one concrete,
 *  visible next target instead of a grid the user has to scan themselves. */
export function computeNextUpAchievement(
  tracks: readonly AchievementTrackProgress[],
): { trackId: string; tier: AchievementTier; remaining: number; progressPct: number } | null {
  let best: { trackId: string; tier: AchievementTier; remaining: number; progressPct: number } | null = null;
  for (const track of tracks) {
    if (!track.nextTier) continue;
    if (!best || track.nextTier.progressPct > best.progressPct) {
      best = { trackId: track.id, tier: track.nextTier.tier, remaining: track.nextTier.remaining, progressPct: track.nextTier.progressPct };
    }
  }
  return best;
}

/** Every achievement id currently unlocked — `{trackId}-{tier}` for tiers,
 *  the bare id for one-offs. Popup.tsx diffs this against the persisted
 *  seenAchievements list to know which ones are newly unlocked since the
 *  last time it checked, for the unlock toast. */
export function computeUnlockedAchievementIds(words: Word[], stats: ProgressStats): string[] {
  const ids: string[] = [];
  for (const oneOff of ONE_OFF_ACHIEVEMENTS) {
    if (oneOff.unlocked(words, stats)) ids.push(oneOff.id);
  }
  for (const track of computeAchievementTracks(words, stats)) {
    for (const tier of track.tiers) {
      if (tier.unlocked) ids.push(`${track.id}-${tier.tier}`);
    }
  }
  return ids;
}

export interface ResolvedAchievement {
  /** Filename stem for AchievementBadge — {track.id}-{tier}, or the bare id for a one-off. */
  iconKey: string;
  glyph: string;
  isOneOff: boolean;
  trackId?: string;
  tier?: AchievementTier;
}

/** Looks an achievement id (from computeUnlockedAchievementIds) back up to
 *  what a notification needs to display it — just the id string travels
 *  over messaging (background -> popup / background -> content script),
 *  so both ends resolve the same static id here rather than needing the
 *  full words/stats/tracks recomputed or serialized. */
export function resolveUnlockedAchievement(id: string): ResolvedAchievement | null {
  const oneOff = ONE_OFF_ACHIEVEMENTS.find((a) => a.id === id);
  if (oneOff) return { iconKey: id, glyph: oneOff.glyph, isOneOff: true };
  for (const track of ACHIEVEMENT_TRACKS) {
    for (const tier of ACHIEVEMENT_TIERS) {
      if (`${track.id}-${tier}` === id) {
        return { iconKey: id, glyph: track.glyph, isOneOff: false, trackId: track.id, tier };
      }
    }
  }
  return null;
}
