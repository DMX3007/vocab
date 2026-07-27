import React, { useState, useEffect } from 'react';
import { computeProgressStats, ACHIEVEMENTS } from '../lib/review/progress';
import type { Word, ReviewLog } from '../lib/storage/types';

interface Props {
  words: Word[];
  logs: ReviewLog[];
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ProgressPane({ words, logs }: Props) {
  const stats = computeProgressStats(words, logs, new Date());
  const maxDay = Math.max(1, ...Object.values(stats.dailyReviews));
  const goalPct = Math.min(100, (stats.todayCount / stats.goal) * 100);

  // Animate the two fills in on mount, like the approved design.
  const [animGoal, setAnimGoal] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimGoal(goalPct), 100);
    return () => clearTimeout(t);
  }, [goalPct]);

  return (
    <div>
      <div className="prog-hero" style={{ background: 'linear-gradient(135deg, oklch(0.30 0.12 35), oklch(0.20 0.08 25))' }}>
        <div className="prog-title-eyebrow">Current streak</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
          <div className="streak-num">{stats.streak}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#ffffff90', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            days in a row
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
          <span>Personal best {'·'} {stats.longestStreak} {stats.longestStreak === 1 ? 'day' : 'days'}</span>
          <span>Next milestone {'·'} {stats.nextMilestone}</span>
        </div>
      </div>

      <div className="daily-card">
        <div className="daily-head">
          <div className="daily-title">Today&rsquo;s goal</div>
          <div className="daily-count">{stats.todayCount} / {stats.goal} <span className="muted">reviews</span></div>
        </div>
        <div className="daily-track">
          <div className="daily-fill" style={{ width: `${animGoal}%` }} />
        </div>
      </div>

      <div className="stat-trio">
        <div className="stat-card leaf">
          <div className="n">{stats.mastered}</div>
          <div className="l">Mastered</div>
        </div>
        <div className="stat-card">
          <div className="n">{stats.totalReviews}</div>
          <div className="l">Reviews</div>
        </div>
        <div className="stat-card heat">
          <div className="n">{stats.accuracy}<span style={{ fontSize: 14 }}>%</span></div>
          <div className="l">Accuracy</div>
        </div>
      </div>

      <div className="week">
        <div className="week-head">
          <div className="week-title">This week</div>
        </div>
        <div className="week-bars">
          {DAY_LABELS.map((d, i) => {
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

      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => {
          const unlocked = a.unlocked(words, stats);
          return (
            <div className={`ach-card ${unlocked ? 'unlocked' : 'locked'}`} key={a.id}>
              <div className="ach-glyph">{a.glyph}</div>
              <div className="ach-name">{a.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
