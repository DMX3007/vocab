import { describe, it, expect } from 'vitest';
import {
  computeProgressStats, isMastered, applyStreakMaintenance,
  computeAchievementTracks, computeNextUpAchievement, computeUnlockedAchievementIds,
  resolveUnlockedAchievement, ACHIEVEMENT_TRACKS,
  ONE_OFF_ACHIEVEMENTS, ACHIEVEMENT_TIERS, type AchievementTrackProgress,
} from '../src/lib/review/progress';
import { defaultSettings } from '../src/lib/review/overlay-policy';
import { wordStatus } from '../src/lib/review/library';
import { createScheduler, PACE_CONFIGS } from '@vocably/core';
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
      pace: 'aggressive',
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
    shelvedAt: null,
    dictionary: null,
    dictionaryFetchedAt: null,
    ...overrides,
  };
}

function log(wordId: string, grade: number, daysAgo: number): ReviewLog {
  const reviewedAt = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return { id: `l${Math.random()}`, wordId, grade, mode: 'typing', direction: 'forward', reviewedAt };
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
      word({ srsState: { algo: 'leitner', stepIndex: 5, intervalDays: 16 } as Word['srsState'] }), // last box, mastered
      word({ srsState: { algo: 'leitner', stepIndex: 4, intervalDays: 8 } as Word['srsState'] }), // box below last, not yet
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
    expect(isMastered(word({ srsState: { algo: 'leitner', stepIndex: 5, intervalDays: 16 } as Word['srsState'] }))).toBe(true);
    expect(isMastered(word({ srsState: { algo: 'leitner', stepIndex: 4, intervalDays: 8 } as Word['srsState'] }))).toBe(false);
  });
});

// "Mastered" is not a badge a word earns and keeps — nothing is ever written
// to say so. It is re-derived from the CURRENT interval on every read, so
// forgetting a word can take it back out again, and the Progress tab's
// mastered count can legitimately go down. These pin that, because it is the
// single most surprising thing about how this app defines "learnt".
describe('mastery is reversible, not a one-way flag', () => {
  const sm2 = createScheduler('sm2', PACE_CONFIGS.aggressive);
  const reviewWord = (intervalDays: number) =>
    word({ srsState: { algo: 'sm2', pace: 'aggressive', phase: 'review', stepIndex: 0, dueAt: NOW, intervalDays, easeFactor: 2.5, repetitions: 5, lapses: 0 } });

  it('forgetting a barely-mastered word drops it back under the threshold', () => {
    const before = reviewWord(29);
    expect(isMastered(before)).toBe(true);

    const after = word({ srsState: sm2.schedule(before.srsState, 1, NOW) });
    expect(after.srsState.phase).toBe('relearning');
    expect(after.srsState.intervalDays).toBe(15); // halved by lapseIntervalFactor
    expect(isMastered(after)).toBe(false); // the count on the Progress tab just went down
  });

  it('forgetting a long-interval word halves it but leaves it mastered', () => {
    // Same single lapse, opposite outcome — mastery depends only on where
    // the halved interval lands, never on how the word got there.
    const after = word({ srsState: sm2.schedule(reviewWord(50).srsState, 1, NOW) });
    expect(after.srsState.intervalDays).toBe(25);
    expect(isMastered(after)).toBe(true);
  });

  it('a mastered word that is due reads as due, not mastered', () => {
    // wordStatus checks due BEFORE mastered on purpose; this pins that the
    // two states genuinely overlap rather than being mutually exclusive.
    const due = reviewWord(50);
    expect(isMastered(due)).toBe(true);
    expect(wordStatus(due, NOW)).toBe('due');
  });
});

describe('readingStreak / todayAddedCount / addGoal', () => {
  it('readingStreak counts consecutive days with an in-page (sourceUrl) capture', () => {
    const words = [
      word({ sourceUrl: 'https://a.com', createdAt: NOW }),
      word({ sourceUrl: 'https://a.com', createdAt: new Date(NOW.getTime() - 86_400_000) }),
      word({ sourceUrl: '', createdAt: new Date(NOW.getTime() - 2 * 86_400_000) }), // manual add — doesn't count
    ];
    expect(computeProgressStats(words, [], NOW).readingStreak).toBe(2);
  });

  it('readingStreak is 0 with no in-page captures at all', () => {
    expect(computeProgressStats([word({ sourceUrl: '' })], [], NOW).readingStreak).toBe(0);
  });

  it('todayAddedCount counts words of any source created today, not just reading captures', () => {
    const words = [
      word({ createdAt: NOW, sourceUrl: '' }),
      word({ createdAt: NOW, sourceUrl: 'https://a.com' }),
      word({ createdAt: new Date(NOW.getTime() - 86_400_000) }),
    ];
    expect(computeProgressStats(words, [], NOW).todayAddedCount).toBe(2);
  });

  it('addGoal falls back to 3, or uses the passed value', () => {
    expect(computeProgressStats([], [], NOW).addGoal).toBe(3);
    expect(computeProgressStats([], [], NOW, 10, undefined, 5).addGoal).toBe(5);
  });
});

describe('computeAchievementTracks', () => {
  it('tiers up the consistency track with the review streak', () => {
    const logs = Array.from({ length: 14 }, (_, i) => log('w1', 5, i));
    const stats = computeProgressStats([], logs, NOW);
    const consistency = computeAchievementTracks([], stats).find((t) => t.id === 'consistency')!;
    expect(consistency.currentTier).toBe('silver'); // streak 14 clears silver (14), not yet gold (60)
    expect(consistency.nextTier).toEqual({ tier: 'gold', threshold: 60, remaining: 46, progressPct: Math.round((14 / 60) * 100) });
  });

  it('currentTier is null and nextTier is bronze below every threshold', () => {
    const stats = computeProgressStats([], [], NOW);
    const vocabulary = computeAchievementTracks([word()], stats).find((t) => t.id === 'vocabulary')!; // 1 word, bronze at 10
    expect(vocabulary.currentTier).toBeNull();
    expect(vocabulary.nextTier).toEqual({ tier: 'bronze', threshold: 10, remaining: 9, progressPct: 10 });
  });

  it('the reading track only counts words captured via the in-page tooltip (sourceUrl set)', () => {
    const words = [
      ...Array.from({ length: 5 }, () => word({ sourceUrl: 'https://a.com' })),
      ...Array.from({ length: 20 }, () => word({ sourceUrl: '' })), // manual/bulk — doesn't count
    ];
    const stats = computeProgressStats(words, [], NOW);
    expect(computeAchievementTracks(words, stats).find((t) => t.id === 'reading')!.value).toBe(5);
  });

  it('the explorer track counts distinct domains, ignoring sourceUrl-less words', () => {
    const words = [
      word({ sourceUrl: 'https://a.com/x' }),
      word({ sourceUrl: 'https://a.com/y' }), // same domain as above — doesn't add a second
      word({ sourceUrl: 'https://b.com' }),
      word({ sourceUrl: '' }),
    ];
    const stats = computeProgressStats(words, [], NOW);
    expect(computeAchievementTracks(words, stats).find((t) => t.id === 'explorer')!.value).toBe(2);
  });
});

describe('computeNextUpAchievement', () => {
  it('picks the locked tier across all tracks closest to unlocking', () => {
    const words = Array.from({ length: 9 }, () => word()); // vocabulary: 9/10 bronze = 90%, everything else 0%
    const stats = computeProgressStats(words, [], NOW);
    expect(computeNextUpAchievement(computeAchievementTracks(words, stats)))
      .toEqual({ trackId: 'vocabulary', tier: 'bronze', remaining: 1, progressPct: 90 });
  });

  it('returns null once every tier of every track is unlocked', () => {
    const maxed: AchievementTrackProgress = {
      id: 'x', glyph: '', value: 999,
      tiers: ACHIEVEMENT_TIERS.map((tier) => ({ tier, threshold: 1, unlocked: true })),
      currentTier: 'platinum', nextTier: null,
    };
    expect(computeNextUpAchievement([maxed])).toBeNull();
  });

  it('returns null with no tracks at all', () => {
    expect(computeNextUpAchievement([])).toBeNull();
  });
});

describe('computeUnlockedAchievementIds', () => {
  it('includes the first-word one-off once a word exists, not before', () => {
    const stats = computeProgressStats([], [], NOW);
    expect(computeUnlockedAchievementIds([], stats)).not.toContain('first-word');
    expect(computeUnlockedAchievementIds([word()], stats)).toContain('first-word');
    expect(ONE_OFF_ACHIEVEMENTS.map((a) => a.id)).toContain('first-word');
  });

  it('includes every unlocked tier as {trackId}-{tier}, and stops at the next locked one', () => {
    const words = Array.from({ length: 60 }, () => word()); // vocabulary: bronze(10) + silver(50) clear, gold(200) doesn't
    const stats = computeProgressStats(words, [], NOW);
    const ids = computeUnlockedAchievementIds(words, stats);
    expect(ids).toContain('vocabulary-bronze');
    expect(ids).toContain('vocabulary-silver');
    expect(ids).not.toContain('vocabulary-gold');
  });
});

describe('resolveUnlockedAchievement', () => {
  it('resolves the first-word one-off id', () => {
    expect(resolveUnlockedAchievement('first-word')).toEqual({
      iconKey: 'first-word', glyph: ONE_OFF_ACHIEVEMENTS[0]!.glyph, isOneOff: true,
    });
  });

  it('resolves a {trackId}-{tier} id back to its track and tier', () => {
    const scholar = ACHIEVEMENT_TRACKS.find((t) => t.id === 'scholar')!;
    expect(resolveUnlockedAchievement('scholar-gold')).toEqual({
      iconKey: 'scholar-gold', glyph: scholar.glyph, isOneOff: false, trackId: 'scholar', tier: 'gold',
    });
  });

  it('returns null for an id that matches nothing', () => {
    expect(resolveUnlockedAchievement('not-a-real-id')).toBeNull();
    expect(resolveUnlockedAchievement('scholar-platinum-extra')).toBeNull();
  });
});
