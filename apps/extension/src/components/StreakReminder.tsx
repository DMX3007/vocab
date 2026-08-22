import React from 'react';
import { Icon } from './icons';

interface Props {
  streak: number;
  todayCount: number;
  dailyGoal: number;
  onReviewNow: () => void;
  onDismiss: () => void;
}

// A small, non-modal corner nudge — unlike the review overlay, it never
// blocks the page underneath (see content.ts's mount(): the 'streak' kind
// disables pointer-events on its full-viewport host, this card re-enables
// them on just itself). Shown at most once a day, only once it's genuinely
// getting late and today's goal is still short — see
// overlay-policy.ts's shouldShowStreakReminder.
export function StreakReminder({ streak, todayCount, dailyGoal, onReviewNow, onDismiss }: Props) {
  const remaining = Math.max(0, dailyGoal - todayCount);
  return (
    <div className="vf-streak-card">
      <button className="vf-streak-close" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="close" size={11} />
      </button>
      <div className="vf-streak-top">
        <Icon name="flame" size={28} className="vf-streak-flame" />
        <div>
          <div className="vf-streak-title">{streak}-day streak at risk</div>
          <div className="vf-streak-sub">
            {remaining} more review{remaining === 1 ? '' : 's'} to keep it today.
          </div>
        </div>
      </div>
      <button className="vf-streak-btn" onClick={onReviewNow}>Review now {'→'}</button>
    </div>
  );
}
