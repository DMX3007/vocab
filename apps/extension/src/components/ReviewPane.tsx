import React, { useMemo, useState } from 'react';
import { Icon } from './icons';
import type { Word, ReviewLog } from '../lib/storage/types';
import { SUPPORTED_LANGUAGES } from '../lib/languages';
import { ALGO_OPTIONS, ALGO_LABELS } from '../lib/review/algo';
import type { AlgoFilter } from '../lib/review/library';
import { isMastered } from '../lib/review/progress';
import { computeWordStatsById, algoProgressLabel, estimateReviewsToMastery } from '../lib/review/word-stats';
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
}

const ALGO_FILTER_LABEL: Record<AlgoFilter, string> = { all: 'All algorithms', sm2: 'SM-2 only', leitner: 'Leitner only' };

// Review tab: the target-language + default-algorithm tray, a "which algo
// to review right now" filter, a start-review button, and the due list
// itself — each row showing what will actually happen with that word next
// (its algorithm, ladder position, track record, and an estimate of how
// many more reviews stand between it and "mastered").
export function ReviewPane({ words, logs, dueCount, targetLang, onLangChange, algo, onAlgoChange, onStartReview, ready }: Props) {
  const [reviewFilter, setReviewFilter] = useState<AlgoFilter>('all');
  const statsById = useMemo(() => computeWordStatsById(logs), [logs]);

  const now = Date.now();
  const allDue = words
    .filter((w) => w.srsState.dueAt.getTime() <= now)
    .sort((a, b) => a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime());
  const due = allDue.filter((w) => reviewFilter === 'all' || w.srsState.algo === reviewFilter);

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
            <Icon name="sparkle" size={13} /> Review {due.length} {due.length === 1 ? 'word' : 'words'}
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
          {due.map((w) => {
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
                  <span className="due-pill">Due</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
