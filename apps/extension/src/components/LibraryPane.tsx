import React, { useMemo } from 'react';
import { Icon } from './icons';
import { wordStatus, sortWords, filterWords, type LibrarySort } from '../lib/review/library';
import { MASTERED_INTERVAL_DAYS } from '../lib/review/progress';
import type { Word } from '../lib/storage/types';

interface Props {
  words: Word[];
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
  search: string;
  setSearch: (search: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_LABEL: Record<string, string> = { due: 'Due', mastered: 'Mastered', learning: 'Learning', fresh: 'New' };

export function LibraryPane({ words, sort, setSort, search, setSearch, onDelete }: Props) {
  const now = new Date();
  const filtered = useMemo(() => sortWords(filterWords(words, search), sort), [words, search, sort]);

  if (words.length === 0) {
    return (
      <div className="empty">
        <div className="empty-mark">+</div>
        <div className="empty-title">Your library is empty</div>
        <div className="empty-hint">Tap <em>Add word</em> below, or select text on any page.</div>
      </div>
    );
  }

  const mastered = words.filter((w) => w.srsState.intervalDays >= MASTERED_INTERVAL_DAYS).length;
  const learning = words.filter((w) => w.srsState.intervalDays > 0 && w.srsState.intervalDays < MASTERED_INTERVAL_DAYS).length;
  const fresh = words.filter((w) => w.srsState.intervalDays === 0).length;

  return (
    <div className="library-view">
      <div className="lib-banner">
        <div className="lib-banner-row">
          <div className="lib-banner-title"><span className="serif-italic">Library</span></div>
          <div className="lib-banner-count">{words.length} <span className="muted">words</span></div>
        </div>
        <div className="lib-bucket-row">
          <div className="lib-bucket leaf"><span className="dot" /><strong>{mastered}</strong> mastered</div>
          <div className="lib-bucket cool"><span className="dot" /><strong>{learning}</strong> learning</div>
          <div className="lib-bucket heat"><span className="dot" /><strong>{fresh}</strong> fresh</div>
        </div>
      </div>

      <div className="lib-toolbar">
        <div className="lib-search">
          <Icon name="search" />
          <input placeholder="Search words…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="lib-sort" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          <option value="added">Recent</option>
          <option value="due">Due soon</option>
          <option value="alpha">A → Z</option>
          <option value="mastered">Mastered</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty" style={{ padding: '32px 24px' }}>
          <div className="empty-hint">No words match &ldquo;{search}&rdquo;</div>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((w) => {
            const status = wordStatus(w, now);
            let source = '';
            try {
              source = w.sourceUrl ? new URL(w.sourceUrl).hostname : 'manual';
            } catch {
              source = 'manual';
            }
            return (
              <div className={`lib-card status-${status}`} key={w.id}>
                <div className="lib-card-strip" />
                <div className="lib-card-body">
                  <div className="lib-card-head">
                    <div className="lib-card-word">{w.term}</div>
                    <button className="lib-card-del" onClick={() => onDelete(w.id)} title="Remove">
                      <Icon name="trash" />
                    </button>
                  </div>
                  <div className="lib-card-tr">{w.translations.join(', ')}</div>
                  <div className="lib-card-foot">
                    <span className="lib-card-source">{source}</span>
                    <span className={`lib-card-status ${status}`}>{STATUS_LABEL[status]}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
