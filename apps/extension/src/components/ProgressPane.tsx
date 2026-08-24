import React, { useState, useEffect } from 'react';
import {
  computeProgressStats,
  computeAchievementTracks,
  computeNextUpAchievement,
  ONE_OFF_ACHIEVEMENTS,
  type AchievementTrackProgress,
} from '../lib/review/progress';
import { ACHIEVEMENT_TIER_KEY as TIER_KEY, ACHIEVEMENT_TRACK_KEY as TRACK_KEY } from '../lib/review/achievement-copy';
import { AchievementBadge } from './AchievementBadge';
import { Icon } from './icons';
import { useI18n } from '../lib/i18n';
import type { Word, ReviewLog } from '../lib/storage/types';

interface Props {
  words: Word[];
  logs: ReviewLog[];
  dailyGoal: number;
  dailyAddGoal: number;
  frozenDates: string[];
  streakFreezes: number;
  onDailyGoalChange: (goal: number) => void;
  onDailyAddGoalChange: (goal: number) => void;
}

const GOAL_PRESETS = [5, 10, 15, 20, 30, 50];
const ADD_GOAL_PRESETS = [1, 2, 3, 5, 10, 20];

/** Reviewing vs. collecting are different habits — grouped into two
 *  sections so "why am I looking at this" is obvious at a glance. */
const REVIEW_TRACK_IDS = ['consistency', 'scholar', 'mastery'];
const GROWTH_TRACK_IDS = ['vocabulary', 'reading', 'explorer', 'readingStreak'];

export function ProgressPane({ words, logs, dailyGoal, dailyAddGoal, frozenDates, streakFreezes, onDailyGoalChange, onDailyAddGoalChange }: Props) {
  const { t, tp } = useI18n();
  const dayLabels = t('progress.dayLabels').split(',');
  const stats = computeProgressStats(words, logs, new Date(), dailyGoal, new Set(frozenDates), dailyAddGoal);
  const maxDay = Math.max(1, ...Object.values(stats.dailyReviews));
  const goalPct = Math.min(100, (stats.todayCount / stats.goal) * 100);
  const goalMet = stats.todayCount >= stats.goal;
  const addGoalPct = Math.min(100, (stats.todayAddedCount / stats.addGoal) * 100);
  const addGoalMet = stats.todayAddedCount >= stats.addGoal;

  // Animate the fills in on mount, like the approved design.
  const [animGoal, setAnimGoal] = useState(0);
  const [animAddGoal, setAnimAddGoal] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setAnimGoal(goalPct), 100);
    return () => clearTimeout(timer);
  }, [goalPct]);
  useEffect(() => {
    const timer = setTimeout(() => setAnimAddGoal(addGoalPct), 100);
    return () => clearTimeout(timer);
  }, [addGoalPct]);

  const tracks = computeAchievementTracks(words, stats);
  const trackById = new Map(tracks.map((tr) => [tr.id, tr]));
  const nextUp = computeNextUpAchievement(tracks);
  const firstWord = ONE_OFF_ACHIEVEMENTS[0]!;
  const firstWordUnlocked = firstWord.unlocked(words, stats);

  function renderTrackCard(track: AchievementTrackProgress) {
    const meta = TRACK_KEY[track.id]!;
    const displayTier = track.currentTier ?? 'bronze';
    return (
      <div className={`ach-track-card ${track.currentTier ? 'unlocked' : ''}`} key={track.id}>
        <AchievementBadge iconKey={`${track.id}-${displayTier}`} glyph={track.glyph} locked={!track.currentTier} size={34} />
        <div className="ach-track-body">
          <div className="ach-track-head">
            <span className="ach-track-name">{t(meta.name)}</span>
            {track.currentTier && <span className={`ach-track-tier-badge ${track.currentTier}`}>{t(TIER_KEY[track.currentTier])}</span>}
          </div>
          <div className="ach-track-desc">{t(meta.desc)}</div>
          <div className="ach-tier-pips">
            {track.tiers.map((tr) => (
              <span
                key={tr.tier}
                className={`ach-tier-pip ${tr.tier} ${tr.unlocked ? 'on' : ''}`}
                title={`${t(TIER_KEY[tr.tier])} · ${tr.threshold}`}
              />
            ))}
          </div>
          <div className="ach-track-progress-row">
            <div className="ach-track-track">
              <div className="ach-track-fill" style={{ width: `${track.nextTier?.progressPct ?? 100}%` }} />
            </div>
            <span className="ach-track-value">
              {track.nextTier ? `${track.value} / ${track.nextTier.threshold}` : t('achievement.tier.platinum')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="prog-hero" style={{ background: 'linear-gradient(135deg, oklch(0.30 0.12 35), oklch(0.20 0.08 25))' }}>
        <div className="prog-title-eyebrow">{t('progress.currentStreak')}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
          <div className="streak-num">{stats.streak}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#ffffff90', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {t('progress.daysInARow')}
          </div>
          <div className="flame-wrap" style={{ marginLeft: 'auto', width: 48, height: 60 }}>
            <svg className="flame" viewBox="0 0 56 64" width="48" height="60">
              <path
                d="M28 60c-12 0-20-8-20-20 0-8 6-14 8-20 1 4 3 6 6 6 0-4 0-12-4-22 12 6 24 16 24 30 0 14-6 22-14 26z"
                fill="oklch(0.75 0.18 50)"
              />
              <path
                d="M28 56c-7 0-12-5-12-12 0-5 3-8 5-12 1 3 2 4 4 4 0-2 0-7-2-13 7 4 14 9 14 17 0 9-3 14-9 16z"
                fill="oklch(0.85 0.18 80)"
              />
            </svg>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #ffffff20', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: '#ffffffa0' }}>
          <span>{tp('progress.personalBest', stats.longestStreak)}</span>
          <span title={t('progress.freezeHint')}>
            <Icon name="snowflake" size={10} /> {streakFreezes}
          </span>
          <span>{t('progress.nextMilestone', { n: stats.nextMilestone })}</span>
        </div>
      </div>

      <div className={`daily-card ${goalMet ? 'met' : ''}`}>
        <div className="daily-head">
          <div className="daily-title">
            {goalMet ? <><Icon name="check" size={12} /> {t('progress.goalComplete')}</> : t('progress.todaysGoal')}
          </div>
          <div className="daily-count">
            {stats.todayCount} / {' '}
            <select
              className="daily-goal-select"
              value={stats.goal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onDailyGoalChange(Number(e.target.value))}
            >
              {(GOAL_PRESETS.includes(stats.goal) ? GOAL_PRESETS : [...GOAL_PRESETS, stats.goal].sort((a, b) => a - b)).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>{' '}
            <span className="muted">{t('progress.reviewsLabel')}</span>
          </div>
        </div>
        <div className="daily-track">
          <div className="daily-fill" style={{ width: `${animGoal}%` }} />
        </div>
      </div>

      <div className={`daily-card add-goal ${addGoalMet ? 'met' : ''}`}>
        <div className="daily-head">
          <div className="daily-title">
            {addGoalMet ? <><Icon name="check" size={12} /> {t('progress.goalComplete')}</> : t('progress.addGoalTitle')}
          </div>
          <div className="daily-count">
            {stats.todayAddedCount} / {' '}
            <select
              className="daily-goal-select"
              value={stats.addGoal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onDailyAddGoalChange(Number(e.target.value))}
            >
              {(ADD_GOAL_PRESETS.includes(stats.addGoal) ? ADD_GOAL_PRESETS : [...ADD_GOAL_PRESETS, stats.addGoal].sort((a, b) => a - b)).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>{' '}
            <span className="muted">{t('progress.wordsLabel')}</span>
          </div>
        </div>
        <div className="daily-track">
          <div className="daily-fill" style={{ width: `${animAddGoal}%` }} />
        </div>
      </div>

      <div className="stat-trio">
        <div className="stat-card leaf">
          <div className="n">{stats.mastered}</div>
          <div className="l">{t('progress.mastered')}</div>
        </div>
        <div className="stat-card">
          <div className="n">{stats.totalReviews}</div>
          <div className="l">{t('progress.reviews')}</div>
        </div>
        <div className="stat-card heat">
          <div className="n">{stats.accuracy}<span style={{ fontSize: 14 }}>%</span></div>
          <div className="l">{t('progress.accuracy')}</div>
        </div>
      </div>

      <div className="week">
        <div className="week-head">
          <div className="week-title">{t('progress.thisWeek')}</div>
        </div>
        <div className="week-bars">
          {dayLabels.map((d, i) => {
            const v = stats.dailyReviews[i] ?? 0;
            const h = Math.max(6, (v / maxDay) * 100);
            const cls = i === stats.todayIdx ? 'today' : v > 0 ? 'has' : '';
            return (
              <div className="wb-col" key={i}>
                <div className={`wb-bar ${cls}`} style={{ height: `${h}%` }}>
                  {v > 0 && <span className="v">{v}</span>}
                </div>
                <div className="wb-day">{d}</div>
              </div>
            );
          })}
        </div>
      </div>

      {nextUp ? (
        <div className="next-up-card">
          <AchievementBadge iconKey={`${nextUp.trackId}-${nextUp.tier}`} glyph={trackById.get(nextUp.trackId)?.glyph ?? ''} size={40} />
          <div className="next-up-body">
            <div className="next-up-label">{t('achievement.nextUp')}</div>
            <div className="next-up-detail">
              {t('achievement.nextUpDetail', {
                remaining: nextUp.remaining,
                track: t(TRACK_KEY[nextUp.trackId]!.name),
                tier: t(TIER_KEY[nextUp.tier]),
              })}
            </div>
            <div className="next-up-track">
              <div className="next-up-fill" style={{ width: `${nextUp.progressPct}%` }} />
            </div>
          </div>
        </div>
      ) : (
        <div className="next-up-card done">{t('achievement.allUnlocked')}</div>
      )}

      <div className={`ach-oneoff-row ${firstWordUnlocked ? 'unlocked' : ''}`}>
        <AchievementBadge iconKey="first-word" glyph={firstWord.glyph} locked={!firstWordUnlocked} size={28} />
        <span className={`ach-oneoff-name ${firstWordUnlocked ? 'unlocked' : ''}`}>{t('achievement.oneOff.firstWord')}</span>
        {firstWordUnlocked && <Icon name="check" size={14} className="ach-oneoff-check" />}
      </div>

      <div className="ach-section-title">{t('achievement.sectionReview')}</div>
      <div className="ach-track-list">
        {REVIEW_TRACK_IDS.map((id) => renderTrackCard(trackById.get(id)!))}
      </div>

      <div className="ach-section-title">{t('achievement.sectionGrowth')}</div>
      <div className="ach-track-list">
        {GROWTH_TRACK_IDS.map((id) => renderTrackCard(trackById.get(id)!))}
      </div>
    </div>
  );
}
