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

export interface Achievement {
  id: string;
  glyph: string;
  name: string;
  unlocked: (words: Word[], stats: ProgressStats) => boolean;
}

export const ACHIEVEMENTS: ReadonlyArray<Achievement> = [
  { id: 'first', glyph: '\u{1D4E5}', name: 'First word', unlocked: (words) => words.length >= 1 },
  { id: 'ten', glyph: 'X', name: 'Collector', unlocked: (words) => words.length >= 10 },
  { id: 'scholar', glyph: 'ℵ', name: 'Scholar', unlocked: (_words, stats) => stats.totalReviews >= 50 },
  { id: 'fire', glyph: '✦', name: 'On fire', unlocked: (_words, stats) => stats.streak >= 7 },
  { id: 'master', glyph: '★', name: 'Master', unlocked: (words) => words.some((w) => w.srsState.intervalDays >= 30) },
  { id: 'poly', glyph: '∞', name: 'Polyglot', unlocked: (words) => words.length >= 50 },
];
