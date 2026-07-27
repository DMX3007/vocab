import React from 'react';
import { Icon } from './icons';
import type { Word } from '../lib/storage/types';
import { SUPPORTED_LANGUAGES } from '../lib/languages';

interface Props {
  words: Word[];
  dueCount: number;
  targetLang: string;
  onLangChange: (lang: string) => void;
  onStartReview: () => void;
  ready: boolean;
}

// Review tab: the target-language tray, a start-review button when
// something is due, and the due list itself (soonest-overdue first).
export function ReviewPane({ words, dueCount, targetLang, onLangChange, onStartReview, ready }: Props) {
  const now = Date.now();
  const due = words
    .filter((w) => w.srsState.dueAt.getTime() <= now)
    .sort((a, b) => a.srsState.dueAt.getTime() - b.srsState.dueAt.getTime());

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
      </div>

      {dueCount > 0 && (
        <div style={{ padding: '0 14px 12px' }}>
          <button className="btn-primary" onClick={onStartReview} disabled={!ready}>
            <Icon name="sparkle" size={13} /> Review {dueCount} {dueCount === 1 ? 'word' : 'words'}
          </button>
        </div>
      )}

      {due.length === 0 ? (
        <div className="empty">
          <div className="empty-mark">{'✓'}</div>
          <div className="empty-title">All caught up</div>
          <div className="empty-hint">Nothing due right now. Come back later — or browse Library.</div>
        </div>
      ) : (
        <div>
          <div className="section-divider">Due now {'·'} {due.length}</div>
          {due.map((w) => (
            <div className="word-row" key={w.id}>
              <div className="word-text">
                <div className="word-en">{w.term}</div>
                <div className="word-tr">{w.translations[0]}</div>
              </div>
              <div className="row-meta">
                <span className="due-pill">Due</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
