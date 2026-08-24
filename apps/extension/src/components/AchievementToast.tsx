import React, { useEffect } from 'react';
import { Icon } from './icons';
import { AchievementBadge } from './AchievementBadge';
import { resolveUnlockedAchievement } from '../lib/review/progress';
import { ACHIEVEMENT_TIER_KEY, ACHIEVEMENT_TRACK_KEY } from '../lib/review/achievement-copy';
import { useI18n } from '../lib/i18n';

interface Props {
  ids: string[];
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4500;

// The on-page counterpart to the popup's unlock toast — shown wherever the
// user actually is (mid-review, mid-tooltip-save) rather than only when
// they happen to open the toolbar popup afterward. See content.ts's
// mountAchievementToast: deliberately its own independent mount, not routed
// through the tooltip/overlay's shared currentSurface, so it can appear
// over the review overlay without unmounting it.
export function AchievementToast({ ids, onDismiss }: Props) {
  const { t, tp } = useI18n();

  useEffect(() => {
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);

  const resolved = ids.map(resolveUnlockedAchievement).filter((r): r is NonNullable<typeof r> => !!r);
  if (resolved.length === 0) return null;
  const single = resolved.length === 1 ? resolved[0]! : null;

  return (
    <div className="vf-ach-toast">
      <button className="vf-ach-toast-close" onClick={onDismiss} aria-label={t('streak.dismiss')}>
        <Icon name="close" size={11} />
      </button>
      {single ? (
        <div className="vf-ach-toast-row">
          <AchievementBadge iconKey={single.iconKey} glyph={single.glyph} size={36} />
          <div className="vf-ach-toast-title">
            {single.isOneOff
              ? t('achievement.oneOff.firstWord')
              : t('achievement.unlockedToastOne', {
                  tier: t(ACHIEVEMENT_TIER_KEY[single.tier!]),
                  track: t(ACHIEVEMENT_TRACK_KEY[single.trackId!]!.name),
                })}
          </div>
        </div>
      ) : (
        <div className="vf-ach-toast-row">
          <Icon name="sparkle" size={28} className="vf-ach-toast-sparkle" />
          <div className="vf-ach-toast-title">{tp('achievement.unlockedToastMany', resolved.length)}</div>
        </div>
      )}
    </div>
  );
}
