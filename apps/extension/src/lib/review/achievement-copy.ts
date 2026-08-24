import type { AchievementTier } from './progress';
import type { TranslationKey } from '../i18n';

// Display copy for the achievement engine in progress.ts — kept separate
// from it (and from any one component) since both ProgressPane.tsx and
// Popup.tsx's unlock toast need the same track-id/tier -> label mapping.

export const ACHIEVEMENT_TIER_KEY: Record<AchievementTier, TranslationKey> = {
  bronze: 'achievement.tier.bronze',
  silver: 'achievement.tier.silver',
  gold: 'achievement.tier.gold',
  platinum: 'achievement.tier.platinum',
};

export const ACHIEVEMENT_TRACK_KEY: Record<string, { name: TranslationKey; desc: TranslationKey }> = {
  consistency: { name: 'achievement.track.consistency.name', desc: 'achievement.track.consistency.desc' },
  scholar: { name: 'achievement.track.scholar.name', desc: 'achievement.track.scholar.desc' },
  mastery: { name: 'achievement.track.mastery.name', desc: 'achievement.track.mastery.desc' },
  vocabulary: { name: 'achievement.track.vocabulary.name', desc: 'achievement.track.vocabulary.desc' },
  reading: { name: 'achievement.track.reading.name', desc: 'achievement.track.reading.desc' },
  explorer: { name: 'achievement.track.explorer.name', desc: 'achievement.track.explorer.desc' },
  readingStreak: { name: 'achievement.track.readingStreak.name', desc: 'achievement.track.readingStreak.desc' },
};
