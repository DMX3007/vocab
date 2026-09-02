import { useI18n } from '../lib/i18n';
import { isMastered } from '../lib/review/progress';
import { estimateReviewsToMastery, masteryProgress } from '../lib/review/word-stats';
import type { Word } from '../lib/storage/types';

// How close a word is to "mastered", as a bar. Shared by the Review tab's
// due/upcoming rows and the Library tab's cards so the same word can never
// read as two different amounts of progress in two places.
//
// Measured in reviews rather than days on purpose — see masteryProgress.
// The number beside the bar is the same estimate the Review tab already
// showed as text ("n reviews to go"), so the bar is a picture of a figure
// the user was already being given, not a second opinion on it.

interface Props {
  word: Word;
  /** Shows the "n to go" / "mastered" caption next to the bar. Off in the
   *  Library, where the row already carries a status pill and the bar is
   *  there to be scanned down a long list rather than read one at a time. */
  showCaption?: boolean;
}

export function MasteryBar({ word, showCaption = false }: Props) {
  const { t } = useI18n();
  const done = isMastered(word);
  const pct = Math.round(masteryProgress(word) * 100);
  const remaining = estimateReviewsToMastery(word);

  const title = done
    ? t('mastery.tooltipMastered')
    : t('mastery.tooltip', { pct, n: remaining });

  return (
    <div className="mastery" title={title}>
      <div
        className={`mastery-track ${done ? 'done' : ''}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('mastery.label')}
      >
        {/* Width is the only channel carrying the value — no colour ramp, so
            the bar never competes with the status pills, which DO use colour
            semantically (due / mastered / shelved). */}
        <div className="mastery-fill" style={{ width: `${pct}%` }} />
      </div>
      {showCaption && (
        <span className="mastery-caption">
          {done ? t('review.mastered') : t('review.repsToGo', { n: remaining })}
        </span>
      )}
    </div>
  );
}
