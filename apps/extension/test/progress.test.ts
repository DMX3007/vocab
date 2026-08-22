import { describe, it, expect } from 'vitest';
import { computeProgressStats, isMastered, ACHIEVEMENTS, applyStreakMaintenance } from '../src/lib/review/progress';
import { defaultSettings } from '../src/lib/review/overlay-policy';
import type { Word, ReviewLog } from '../src/lib/storage/types';

const NOW = new Date('2026-06-13T12:00:00'); // a Saturday, local time

function word(overrides: Partial<Word> = {}): Word {
  return {
    id: overrides.id ?? `w${Math.random()}`,
    term: 'fortitude',
    translations: ['стойкость'],
    langFrom: 'en',
    langTo: 'ru',
    contextSentence: '',
    sourceUrl: '',
    srsState: {
      algo: 'sm2',
      phase: 'review',
      stepIndex: 0,
      dueAt: NOW,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
      ...(overrides.srsState ?? {}),
    },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function log(wordId: string, grade: number, daysAgo: number): ReviewLog {
  const reviewedAt = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return { id: `l${Math.random()}`, wordId, grade, mode: 'typing', reviewedAt };
}

describe('computeProgressStats', () => {
  it('all zero with no history', () => {
    const stats = computeProgressStats([], [], NOW);
    expect(stats).toMatchObject({
      totalReviews: 0, correctReviews: 0, accuracy: 0, xp: 0, level: 1, xpInLevel: 0,
      streak: 0, todayCount: 0, mastered: 0,
    });
  });

  it('accuracy counts grades >= 3 as correct, others as wrong', () => {
    const logs = [log('w1', 5, 0), log('w1', 1, 0), log('w1', 3, 0), log('w1', 0, 0)];
    const stats = computeProgressStats([], logs, NOW);
    expect(stats.totalReviews).toBe(4);
    expect(stats.correctReviews).toBe(2); // grade 5 and grade 3
    expect(stats.accuracy).toBe(50);
  });

  it('xp accrues 10 per correct review; level and xpInLevel roll over every 100xp', () => {
    const logs = Array.from({ length: 12 }, () => log('w1', 5, 0)); // 12 * 10 = 120 xp
    const stats = computeProgressStats([], logs, NOW);
    expect(stats.xp).toBe(120);
    expect(stats.level).toBe(2); // floor(120/100) + 1
    expect(stats.xpInLevel).toBe(20);
    expect(stats.levelTitle).toBe('Explorer');
  });

  it('mastered counts words with intervalDays >= 21', () => {
    const words = [
      word({ srsState: { intervalDays: 30 } as Word['srsState'] }),
      word({ srsState: { intervalDays: 21 } as Word['srsState'] }),
      word({ srsState: { intervalDays: 20 } as Word['srsState'] }),
    ];
    expect(computeProgressStats(words, [], NOW).mastered).toBe(2);
  });

  it('mastered counts Leitner words that reached the last box, regardless of interval days', () => {
    const words = [
      word({ srsState: { algo: 'leitner', stepIndex: 4, intervalDays: 16 } as Word['srsState'] }), // last box, mastered
      word({ srsState: { algo: 'leitner', stepIndex: 3, intervalDays: 8 } as Word['srsState'] }), // box 4, not yet
    ];
    expect(computeProgressStats(words, [], NOW).mastered).toBe(1);
  });

  it('dailyReviews buckets by weekday within the trailing 7-day window only', () => {
    const logs = [
      log('w1', 5, 0), // today
      log('w1', 5, 1), // yesterday
      log('w1', 5, 10), // outside the window — ignored
    ];
    const stats = computeProgressStats([], logs, NOW);
    expect(stats.todayCount).toBe(1);
    expect(stats.todayIdx).toBe(NOW.getDay());
    const totalInWindow = Object.values(stats.dailyReviews).reduce((a, b) => a + b, 0);
    expect(totalInWindow).toBe(2);
  });

  it('streak counts consecutive days ending today when today has a review', () => {
    const logs = [log('w1', 5, 0), log('w1', 5, 1), log('w1', 5, 2), log('w1', 5, 5)];
    expect(computeProgressStats([], logs, NOW).streak).toBe(3); // today, yesterday, day-before — then a gap
  });

  it('streak still counts through yesterday when today has no review yet (not yet broken)', () => {
    const logs = [log('w1', 5, 1), log('w1', 5, 2)];
    expect(computeProgressStats([], logs, NOW).streak).toBe(2);
  });

  it('streak is 0 after a real gap (neither today nor yesterday reviewed)', () => {
    const logs = [log('w1', 5, 3), log('w1', 5, 4)];
    expect(computeProgressStats([], logs, NOW).streak).toBe(0);
  });

  it('longestStreak remembers a past run even after it has been broken', () => {
    // a 4-day run 10 days ago, then a lone review yesterday (current streak 1)
    const logs = [log('w1', 5, 10), log('w1', 5, 11), log('w1', 5, 12), log('w1', 5, 13), log('w1', 5, 1)];
    const stats = computeProgressStats([], logs, NOW);
    expect(stats.streak).toBe(1);
    expect(stats.longestStreak).toBe(4);
  });

  it('nextMilestone picks the smallest milestone still ahead', () => {
    const logs = Array.from({ length: 3 }, (_, i) => log('w1', 5, i));
    expect(computeProgressStats([], logs, NOW).nextMilestone).toBe(7); // streak is 3
  });

  it('goal defaults to 10 but uses whatever dailyGoal the caller passes', () => {
    expect(computeProgressStats([], [], NOW).goal).toBe(10);
    expect(computeProgressStats([], [], NOW, 25).goal).toBe(25);
  });

  it('a frozen date counts as active for both streak and longestStreak', () => {
    // reviewed today and 2 days ago, but NOT yesterday — a real gap without freezing
    const logs = [log('w1', 5, 0), log('w1', 5, 2)];
    expect(computeProgressStats([], logs, NOW).streak).toBe(1); // just today; yesterday's gap breaks it

    const yesterday = new Date(NOW.getTime() - 1 * 86_400_000);
    const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
    const frozen = new Set([yesterdayKey]);
    const stats = computeProgressStats([], logs, NOW, 10, frozen);
    expect(stats.streak).toBe(3); // today + frozen yesterday + 2-days-ago, now unbroken
    expect(stats.longestStreak).toBe(3);
  });
});

describe('applyStreakMaintenance', () => {
  const settings = (over: Partial<ReturnType<typeof defaultSettings>> = {}) => ({
    ...defaultSettings(),
    ...over,
  });

  it('consumes a freeze to cover a missed yesterday when a streak was active going into it', () => {
    // reviewed 2 days ago (streak was active), nothing yesterday, nothing today yet
    const logs = [log('w1', 5, 2)];
    const s = settings({ streakFreezes: 1 });
    const result = applyStreakMaintenance(logs, s, NOW);
    expect(result.changed).toBe(true);
    expect(result.settings.streakFreezes).toBe(0);
    expect(result.settings.frozenDates).toHaveLength(1);
  });

  it('does not consume a freeze with none banked', () => {
    const logs = [log('w1', 5, 2)];
    const s = settings({ streakFreezes: 0 });
    const result = applyStreakMaintenance(logs, s, NOW);
    expect(result.settings.frozenDates).toEqual([]);
  });

  it('does not consume a freeze across a real two-day gap (nothing to protect)', () => {
    // neither yesterday NOR the day before has a review — no streak was active to protect
    const logs = [log('w1', 5, 3)];
    const s = settings({ streakFreezes: 1 });
    const result = applyStreakMaintenance(logs, s, NOW);
    expect(result.settings.streakFreezes).toBe(1); // untouched
    expect(result.settings.frozenDates).toEqual([]);
  });

  it('does not double-consume once yesterday is already frozen', () => {
    const logs = [log('w1', 5, 2)];
    const once = applyStreakMaintenance(logs, settings({ streakFreezes: 2 }), NOW);
    const twice = applyStreakMaintenance(logs, once.settings, NOW);
    expect(twice.changed).toBe(false);
    expect(twice.settings.streakFreezes).toBe(1); // still just the one freeze spent
  });

  it('awards a freeze the first time a streak milestone is crossed', () => {
    const logs = Array.from({ length: 3 }, (_, i) => log('w1', 5, i)); // streak of 3
    const result = applyStreakMaintenance(logs, settings({ streakFreezes: 0 }), NOW);
    expect(result.changed).toBe(true);
    expect(result.settings.streakFreezes).toBe(1);
    expect(result.settings.lastMilestoneAwarded).toBe(3);
  });

  it('does not re-award the same milestone twice', () => {
    const logs = Array.from({ length: 3 }, (_, i) => log('w1', 5, i));
    const first = applyStreakMaintenance(logs, settings({ streakFreezes: 0 }), NOW);
    const second = applyStreakMaintenance(logs, first.settings, NOW);
    expect(second.changed).toBe(false);
    expect(second.settings.streakFreezes).toBe(1);
  });

  it('reports changed: false when there is nothing to do', () => {
    const result = applyStreakMaintenance([], settings(), NOW);
    expect(result.changed).toBe(false);
    expect(result.settings).toEqual(settings());
  });
});

describe('isMastered', () => {
  it('SM-2: mastered once the interval reaches 21 days', () => {
    expect(isMastered(word({ srsState: { intervalDays: 21 } as Word['srsState'] }))).toBe(true);
    expect(isMastered(word({ srsState: { intervalDays: 20 } as Word['srsState'] }))).toBe(false);
  });
  it('Leitner: mastered once it reaches the last box, even though its 16-day interval never hits 21', () => {
    expect(isMastered(word({ srsState: { algo: 'leitner', stepIndex: 4, intervalDays: 16 } as Word['srsState'] }))).toBe(true);
    expect(isMastered(word({ srsState: { algo: 'leitner', stepIndex: 3, intervalDays: 8 } as Word['srsState'] }))).toBe(false);
  });
});

describe('ACHIEVEMENTS', () => {
  it('First word unlocks with one word, stays locked with zero', () => {
    const first = ACHIEVEMENTS.find((a) => a.id === 'first')!;
    const stats = computeProgressStats([], [], NOW);
    expect(first.unlocked([], stats)).toBe(false);
    expect(first.unlocked([word()], stats)).toBe(true);
  });

  it('On fire unlocks once the streak reaches 7', () => {
    const onFire = ACHIEVEMENTS.find((a) => a.id === 'fire')!;
    const logs = Array.from({ length: 7 }, (_, i) => log('w1', 5, i));
    const stats = computeProgressStats([], logs, NOW);
    expect(stats.streak).toBe(7);
    expect(onFire.unlocked([], stats)).toBe(true);
  });

  it('Master unlocks once any word interval reaches 30 days', () => {
    const master = ACHIEVEMENTS.find((a) => a.id === 'master')!;
    const stats = computeProgressStats([], [], NOW);
    expect(master.unlocked([word({ srsState: { intervalDays: 29 } as Word['srsState'] })], stats)).toBe(false);
    expect(master.unlocked([word({ srsState: { intervalDays: 30 } as Word['srsState'] })], stats)).toBe(true);
  });
});
