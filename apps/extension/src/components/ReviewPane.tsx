import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import type { Word, ReviewLog } from '../lib/storage/types';
import { SUPPORTED_LANGUAGES } from '../lib/languages';
import { algoChoiceOptions, algoChoiceOf, parseAlgoChoice, algoBadgeLabel, type AlgoChoice } from '../lib/review/algo';
import { sortForReview, type AlgoFilter } from '../lib/review/library';
import { computeWordStatsById, algoProgress, type LadderProgress } from '../lib/review/word-stats';
import { MasteryBar } from './MasteryBar';
import { trackedWords, msUntilDue, formatCountdown, formatOverdue } from '../lib/review/live-queue';
import { useI18n } from '../lib/i18n';
import type { AlgoId, Pace } from '@vocably/core';

interface Props {
  words: Word[];
  logs: ReviewLog[];
  dueCount: number;
  targetLang: string;
  onLangChange: (lang: string) => void;
  algo: AlgoId;
  pace: Pace;
  onAlgoChange: (algo: AlgoId, pace: Pace) => void;
  /** Hands-free review — see OverlaySettings.voiceReviewEnabled's doc
   *  comment for exactly what this turns on. Toggling here or from the mic
   *  button on an open card flips the same stored value either way. */
  voiceReviewEnabled: boolean;
  onVoiceReviewEnabledChange: (enabled: boolean) => void;
  /** PRACTICE MODE (see src/lib/practice/). Removable. */
  onStartPractice: () => void;
  onStartReview: (algoFilter: AlgoFilter) => void;
  /** Unshelves the single oldest-shelved word and starts a review on it —
   *  offered only once nothing else is due (see the empty state below). */
  onReviveShelved: () => void;
  ready: boolean;
  /** Keeps the header ribbon's due count in sync with the live tick below —
   *  without this, a word rising into Due here would leave the ribbon
   *  showing a stale, lower number until the next full popup refresh. */
  onDueCountChange?: (count: number) => void;
}

const ALGO_FILTER_KEY = { all: 'algoFilter.all', sm2: 'algoFilter.sm2', leitner: 'algoFilter.leitner' } as const;
/** How many rows actually get rendered per section — keeps the DOM light
 *  with a big backlog. The due COUNT elsewhere (button, header, ribbon) is
 *  never capped by this: checking "is this due" is cheap for any number of
 *  words, so there's no reason to under-report it just to bound the list. */
const ROW_DISPLAY_LIMIT = 20;

// Review tab: the target-language + default-algorithm tray, a "which algo
// to review right now" filter, a start-review button, and the due list
// itself — each row showing what will actually happen with that word next
// (its algorithm, ladder position, track record, and an estimate of how
// many more reviews stand between it and "mastered").
//
// EVERY row carries a live timer, not just the upcoming ones: a due word
// shows how long it's been waiting (formatOverdue), an upcoming one shows
// how long until it's due (formatCountdown) — both tick on the same shared
// clock, so a word visibly rises from "Up next" into "Due now" the moment
// its own time comes, with no need to reopen or refresh the popup. Being
// "due" is cheap to check regardless of library size, so the due list/count
// are never capped — only the UPCOMING (not-yet-due) words get a bounded
// MAX_TRACKED_WORDS pool, since formatting a live countdown for each of
// them is the one thing that actually costs something every tick. Both
// sections additionally cap how many ROWS render (ROW_DISPLAY_LIMIT) to
// keep the DOM light with a big backlog — the counts stay accurate either
// way. The real review session still pulls a fresh list from storage when
// you actually start one.
function formatLadder(p: LadderProgress, t: ReturnType<typeof useI18n>['t']): string {
  switch (p.kind) {
    case 'box': return t('ladder.box', { n: p.step, total: p.total });
    case 'learning': return t('ladder.learning', { n: p.step, total: p.total });
    case 'relearning': return t('ladder.relearning', { n: p.step, total: p.total });
    case 'review': return t('ladder.review', { n: p.ease });
  }
}

export function ReviewPane({
  words, logs, dueCount, targetLang, onLangChange, algo, pace, onAlgoChange,
  voiceReviewEnabled, onVoiceReviewEnabledChange, onStartPractice, onStartReview, onReviveShelved, ready, onDueCountChange,
}: Props) {
  const { t, tp } = useI18n();
  const [reviewFilter, setReviewFilter] = useState<AlgoFilter>('all');
  const [now, setNow] = useState(() => Date.now());
  const statsById = useMemo(() => computeWordStatsById(logs), [logs]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const matchesFilter = (w: Word) => reviewFilter === 'all' || w.srsState.algo === reviewFilter;
  // Shelved words keep whatever dueAt they had the moment they were set
  // aside, which can easily read as "due" here even though getDueWords (the
  // repository, and so the real review session) already excludes them —
  // filter them out client-side too so this list never disagrees with it.
  const liveWords = words.filter((w) => !w.shelvedAt);
  const allDue = sortForReview(liveWords.filter((w) => w.srsState.dueAt.getTime() <= now));
  const due = allDue.filter(matchesFilter);

  useEffect(() => {
    onDueCountChange?.(allDue.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDue.length]);

  const allUpcoming = trackedWords(liveWords.filter((w) => w.srsState.dueAt.getTime() > now)).filter(matchesFilter);
  const upcoming = allUpcoming.slice(0, ROW_DISPLAY_LIMIT);

  const shelvedWords = useMemo(
    () => [...words.filter((w) => w.shelvedAt)].sort((a, b) => a.shelvedAt!.getTime() - b.shelvedAt!.getTime()),
    [words],
  );

  function renderRow(w: Word, pill: React.ReactNode, pillClassName: string) {
    const stats = statsById.get(w.id);
    const accuracyText = stats
      ? `${stats.successRate}% (${stats.passed}/${stats.total})`
      : t('review.noReviewsYet');
    const detail = stats
      ? `${t('review.rowDetail', { passed: stats.passed, total: stats.total, pct: stats.successRate! })}, ${tp('review.missCount', stats.failed)}`
      : t('review.rowDetailNone');
    return (
      <div className="word-row" key={w.id}>
        <div className="word-text">
          <div className="word-en">{w.term}</div>
          <div className="word-tr">{w.translations[0]}</div>
          <div className="word-stats-row" title={detail}>
            <span className="lib-card-algo">{algoBadgeLabel(w.srsState.algo, w.srsState.pace ?? 'aggressive', t)}</span>
            <span className="word-stat-text">{formatLadder(algoProgress(w), t)} · {accuracyText}</span>
          </div>
          {/* The "n reviews to go" figure moved out of the text line above and
              onto the bar's caption — same number, now with a picture of it. */}
          <MasteryBar word={w} showCaption />
        </div>
        <div className="row-meta">
          <span className={pillClassName}>{pill}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="tray">
        <div className="tray-row full">
          <span className="tray-label">{t('tray.targetLanguage')}</span>
          <span className="select-caret">
            <select className="tray-value" value={targetLang} onChange={(e) => onLangChange(e.target.value)} disabled={!ready}>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
              ))}
            </select>
          </span>
        </div>
        <div className="tray-row full">
          <span className="tray-label">{t('tray.newWordsUse')}</span>
          <span className="select-caret">
            <select
              className="tray-value"
              value={algoChoiceOf(algo, pace)}
              onChange={(e) => {
                const { algo: nextAlgo, pace: nextPace } = parseAlgoChoice(e.target.value as AlgoChoice);
                onAlgoChange(nextAlgo, nextPace);
              }}
              disabled={!ready}
            >
              {algoChoiceOptions(t).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </span>
        </div>
        <div className="tray-row full">
          <span className="tray-label">{t('review.voiceMode')}</span>
          <label className="toggle-switch" title={t('review.voiceModeHint')}>
            <input
              type="checkbox"
              checked={voiceReviewEnabled}
              onChange={(e) => onVoiceReviewEnabledChange(e.target.checked)}
              disabled={!ready}
            />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
          </label>
        </div>
      </div>

      {/* PRACTICE MODE entry (see src/lib/practice/). Removable. */}
      <button className="practice-enter" onClick={onStartPractice} disabled={!ready} title={t('practice.enterHint')}>
        <Icon name="sparkle" size={12} /> {t('practice.enter')}
      </button>

      {dueCount > 0 && (
        <div className="review-filter-row">
          <span className="tray-label">{t('review.filterLabel')}</span>
          <select className="lib-sort" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as AlgoFilter)} disabled={!ready}>
            <option value="all">{t('algoFilter.all')}</option>
            <option value="sm2">{t('algoFilter.sm2')}</option>
            <option value="leitner">{t('algoFilter.leitner')}</option>
          </select>
        </div>
      )}

      {due.length > 0 && (
        <div style={{ padding: '0 14px 12px' }}>
          <button className="btn-primary" onClick={() => onStartReview(reviewFilter)} disabled={!ready}>
            <Icon name="sparkle" size={13} /> {t('review.startBtn')}
          </button>
        </div>
      )}

      {due.length === 0 ? (
        <div className="empty">
          <div className="empty-mark">{'✓'}</div>
          <div className="empty-title">{t('review.allCaughtUp')}</div>
          <div className="empty-hint">
            {dueCount > 0 && reviewFilter !== 'all'
              ? t('review.nothingDueFilter', { filter: t(ALGO_FILTER_KEY[reviewFilter]) })
              : t('review.nothingDue')}
          </div>
          {shelvedWords.length > 0 && (
            <div className="revive-shelved">
              <div className="revive-shelved-text">
                {tp('review.shelvedCount', shelvedWords.length)}
              </div>
              <button className="btn-secondary" onClick={onReviveShelved} disabled={!ready}>
                <Icon name="archive" size={13} /> {t('review.reviveBringBack', { term: shelvedWords[0]!.term })}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="section-divider">{t('review.sectionDueNow')} {'·'} {due.length}</div>
          {due.slice(0, ROW_DISPLAY_LIMIT).map((w) => renderRow(w, formatOverdue(-msUntilDue(w, new Date(now))), 'due-pill'))}
          {due.length > ROW_DISPLAY_LIMIT && (
            <div className="empty-hint" style={{ padding: '4px 18px 16px' }}>
              {t('review.moreDue', { n: due.length - ROW_DISPLAY_LIMIT })}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="section-divider">{t('review.sectionUpNext')} {allUpcoming.length > 0 ? `· ${allUpcoming.length}` : ''}</div>
        {upcoming.length > 0 ? (
          <>
            {upcoming.map((w) => renderRow(w, formatCountdown(msUntilDue(w, new Date(now))), 'countdown-pill'))}
            {allUpcoming.length > ROW_DISPLAY_LIMIT && (
              <div className="empty-hint" style={{ padding: '4px 18px 16px' }}>
                {t('review.moreUpcoming', { n: allUpcoming.length - ROW_DISPLAY_LIMIT })}
              </div>
            )}
          </>
        ) : (
          <div className="empty-hint" style={{ padding: '4px 18px 16px' }}>
            {t('review.nothingScheduledSoon')}
          </div>
        )}
      </div>
    </div>
  );
}
