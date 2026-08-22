import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import type { Word, ReviewLog } from '../lib/storage/types';
import { SUPPORTED_LANGUAGES } from '../lib/languages';
import { ALGO_OPTIONS, ALGO_LABELS } from '../lib/review/algo';
import { sortForReview, type AlgoFilter } from '../lib/review/library';
import { isMastered } from '../lib/review/progress';
import { computeWordStatsById, algoProgressLabel, estimateReviewsToMastery } from '../lib/review/word-stats';
import { trackedWords, msUntilDue, formatCountdown } from '../lib/review/live-queue';
import type { AlgoId } from '@vocabflow/core';

interface Props {
  words: Word[];
  logs: ReviewLog[];
  dueCount: number;
  targetLang: string;
  onLangChange: (lang: string) => void;
  algo: AlgoId;
  onAlgoChange: (algo: AlgoId) => void;
  onStartReview: (algoFilter: AlgoFilter) => void;
  ready: boolean;
  /** Keeps the header ribbon's due count in sync with the live tick below —
   *  without this, a word rising into Due here would leave the ribbon
   *  showing a stale, lower number until the next full popup refresh. */
  onDueCountChange?: (count: number) => void;
}

const ALGO_FILTER_LABEL: Record<AlgoFilter, string> = { all: 'All algorithms', sm2: 'SM-2 only', leitner: 'Leitner only' };
/** How many not-yet-due words get a visible countdown row. The underlying
 *  tracked pool is capped much higher (see live-queue.ts) — this is just
 *  how many of those are worth showing before the list gets noisy. */
const UPCOMING_DISPLAY_LIMIT = 5;
/** How many due rows actually get rendered — keeps the DOM light with a
 *  big backlog. The due COUNT everywhere else (button, header, ribbon) is
 *  never capped: checking "is this due" is cheap for any number of words,
 *  so there's no reason to under-report it just to bound the list length. */
const DUE_DISPLAY_LIMIT = 20;

// Review tab: the target-language + default-algorithm tray, a "which algo
// to review right now" filter, a start-review button, and the due list
// itself — each row showing what will actually happen with that word next
// (its algorithm, ladder position, track record, and an estimate of how
// many more reviews stand between it and "mastered").
//
// The due list is LIVE: a shared clock ticks every second so a word rises
// straight from "Up next" into "Due now" the moment its own time comes,
// with no need to reopen or refresh the popup. Being "due" is cheap to
// check regardless of library size, so that part is never capped — only
// the UPCOMING (not-yet-due) words get a bounded MAX_TRACKED_WORDS pool,
// since formatting a live countdown for each of them is the one thing
// that actually costs something every tick. The real review session still
// pulls a fresh list from storage when you actually start one.
export function ReviewPane({ words, logs, dueCount, targetLang, onLangChange, algo, onAlgoChange, onStartReview, ready, onDueCountChange }: Props) {
  const [reviewFilter, setReviewFilter] = useState<AlgoFilter>('all');
  const [now, setNow] = useState(() => Date.now());
  const statsById = useMemo(() => computeWordStatsById(logs), [logs]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const matchesFilter = (w: Word) => reviewFilter === 'all' || w.srsState.algo === reviewFilter;
  const allDue = sortForReview(words.filter((w) => w.srsState.dueAt.getTime() <= now));
  const due = allDue.filter(matchesFilter);

  useEffect(() => {
    onDueCountChange?.(allDue.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDue.length]);

  const upcoming = trackedWords(words.filter((w) => w.srsState.dueAt.getTime() > now))
    .filter(matchesFilter)
    .slice(0, UPCOMING_DISPLAY_LIMIT);

  function renderRow(w: Word, pill: React.ReactNode, pillClassName: string) {
    const stats = statsById.get(w.id);
    const accuracyText = stats
      ? `${stats.successRate}% (${stats.passed}/${stats.total})`
      : 'no reviews yet';
    const repsText = isMastered(w) ? 'mastered' : `~${estimateReviewsToMastery(w)} to go`;
    const detail = stats
      ? `${stats.passed} of ${stats.total} correct (${stats.successRate}%), ${stats.failed} miss${stats.failed === 1 ? '' : 'es'}`
      : 'no reviews logged yet';
    return (
      <div className="word-row" key={w.id}>
        <div className="word-text">
          <div className="word-en">{w.term}</div>
          <div className="word-tr">{w.translations[0]}</div>
          <div className="word-stats-row" title={detail}>
            <span className="lib-card-algo">{ALGO_LABELS[w.srsState.algo]}</span>
            <span className="word-stat-text">{algoProgressLabel(w)} · {accuracyText} · {repsText}</span>
          </div>
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
          <span className="tray-label">Target language</span>
          <select className="tray-value" value={targetLang} onChange={(e) => onLangChange(e.target.value)} disabled={!ready}>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
            ))}
          </select>
        </div>
        <div className="tray-row full">
          <span className="tray-label">New words use</span>
          <select className="tray-value" value={algo} onChange={(e) => onAlgoChange(e.target.value as AlgoId)} disabled={!ready}>
            {ALGO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {dueCount > 0 && (
        <div className="review-filter-row">
          <span className="tray-label">Review</span>
          <select className="lib-sort" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as AlgoFilter)} disabled={!ready}>
            <option value="all">All algorithms</option>
            <option value="sm2">SM-2 only</option>
            <option value="leitner">Leitner only</option>
          </select>
        </div>
      )}

      {due.length > 0 && (
        <div style={{ padding: '0 14px 12px' }}>
          <button className="btn-primary" onClick={() => onStartReview(reviewFilter)} disabled={!ready}>
            <Icon name="sparkle" size={13} /> Review &ldquo;{due[0]!.term}&rdquo; {'→'}
          </button>
        </div>
      )}

      {due.length === 0 ? (
        <div className="empty">
          <div className="empty-mark">{'✓'}</div>
          <div className="empty-title">All caught up</div>
          <div className="empty-hint">
            {dueCount > 0 && reviewFilter !== 'all'
              ? `Nothing due in ${ALGO_FILTER_LABEL[reviewFilter]} right now — try All algorithms.`
              : 'Nothing due right now. Come back later — or browse Library.'}
          </div>
        </div>
      ) : (
        <div>
          <div className="section-divider">Due now {'·'} {due.length}</div>
          {due.slice(0, DUE_DISPLAY_LIMIT).map((w) => renderRow(w, 'Due', 'due-pill'))}
          {due.length > DUE_DISPLAY_LIMIT && (
            <div className="empty-hint" style={{ padding: '4px 18px 16px' }}>
              +{due.length - DUE_DISPLAY_LIMIT} more due — start a review to work through the rest.
            </div>
          )}
        </div>
      )}

      <div>
        <div className="section-divider">Up next</div>
        {upcoming.length > 0 ? (
          upcoming.map((w) => renderRow(w, formatCountdown(msUntilDue(w, new Date(now))), 'countdown-pill'))
        ) : (
          <div className="empty-hint" style={{ padding: '4px 18px 16px' }}>
            Nothing scheduled soon — this fills in once a word's next review is a little ways off.
          </div>
        )}
      </div>
    </div>
  );
}
