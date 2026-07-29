import { DEFAULT_LEITNER_CONFIG } from '@vocabflow/core';
import type { Word, ReviewLog } from '../storage/types';

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
const DAILY_GOAL = 10;

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
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfLocalDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Consecutive-day streak ending today, or ending yesterday if today has no review yet
 *  (a streak isn't broken by a day that hasn't finished). */
function computeStreak(logs: ReviewLog[], now: Date): number {
  const daysWithReviews = new Set(logs.map((l) => localDateKey(l.reviewedAt)));
  const cursor = new Date(now);
  if (!daysWithReviews.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (daysWithReviews.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Longest-ever run of consecutive review-days, scanning the full history once. */
function computeLongestStreak(logs: ReviewLog[]): number {
  if (logs.length === 0) return 0;
  const dayTimes = Array.from(new Set(logs.map((l) => localDateKey(l.reviewedAt))))
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

export function computeProgressStats(words: Word[], logs: ReviewLog[], now: Date): ProgressStats {
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
  const streak = computeStreak(logs, now);

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
    goal: DAILY_GOAL,
    mastered,
    longestStreak: Math.max(streak, computeLongestStreak(logs)),
    nextMilestone: computeNextMilestone(streak),
  };
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
