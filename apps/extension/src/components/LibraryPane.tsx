import React, { useMemo, useState } from 'react';
import { Icon } from './icons';
import {
  wordStatus,
  sortWords,
  filterWords,
  filterByAlgo,
  type LibrarySort,
  type AlgoFilter,
} from '../lib/review/library';
import { MASTERED_INTERVAL_DAYS } from '../lib/review/progress';
import { ALGO_LABELS } from '../lib/review/algo';
import type { Word } from '../lib/storage/types';
import type { AlgoId } from '@vocabflow/core';

interface Props {
  words: Word[];
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
  search: string;
  setSearch: (search: string) => void;
  onDelete: (id: string) => void;
  onMoveAlgo: (ids: string[], algo: AlgoId) => void;
  /** Popup renders the "Add word" FAB as a sibling, so it needs to know
   *  when select mode is active to hide it (the bulk-move bar covers the
   *  same corner of the screen). */
  onSelectModeChange?: (active: boolean) => void;
}

const STATUS_LABEL: Record<string, string> = { due: 'Due', mastered: 'Mastered', learning: 'Learning', fresh: 'New' };

export function LibraryPane({ words, sort, setSort, search, setSearch, onDelete, onMoveAlgo, onSelectModeChange }: Props) {
  const now = new Date();
  const [algoFilter, setAlgoFilter] = useState<AlgoFilter>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => sortWords(filterByAlgo(filterWords(words, search), algoFilter), sort),
    [words, search, algoFilter, sort],
  );

  function toggleSelectMode() {
    const next = !selectMode;
    setSelectMode(next);
    setSelectedIds(new Set());
    onSelectModeChange?.(next);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMove(algo: AlgoId) {
    if (!selectedIds.size) return;
    onMoveAlgo([...selectedIds], algo);
    setSelectMode(false);
    setSelectedIds(new Set());
    onSelectModeChange?.(false);
  }

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

      <div className="lib-toolbar2">
        <select className="lib-sort" value={algoFilter} onChange={(e) => setAlgoFilter(e.target.value as AlgoFilter)}>
          <option value="all">All algorithms</option>
          <option value="sm2">SM-2 only</option>
          <option value="leitner">Leitner only</option>
        </select>
        <button className={`lib-sort ${selectMode ? 'on' : ''}`} onClick={toggleSelectMode}>
          {selectMode ? 'Cancel' : 'Select · move'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty" style={{ padding: '32px 24px' }}>
          <div className="empty-hint">No words match &ldquo;{search}&rdquo;</div>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((w) => {
            const status = wordStatus(w, now);
            const selected = selectedIds.has(w.id);
            let source = '';
            try {
              source = w.sourceUrl ? new URL(w.sourceUrl).hostname : 'manual';
            } catch {
              source = 'manual';
            }
            return (
              <div
                className={`lib-card status-${status} ${selectMode ? 'selectable' : ''} ${selected ? 'selected' : ''}`}
                key={w.id}
                onClick={selectMode ? () => toggleSelected(w.id) : undefined}
              >
                <div className="lib-card-strip" />
                <div className="lib-card-body">
                  <div className="lib-card-head">
                    <div className="lib-card-head-main">
                      {selectMode && (
                        <input
                          type="checkbox"
                          className="lib-card-checkbox"
                          checked={selected}
                          onChange={() => toggleSelected(w.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <div className="lib-card-word">{w.term}</div>
                    </div>
                    {!selectMode && (
                      <button className="lib-card-del" onClick={() => onDelete(w.id)} title="Remove">
                        <Icon name="trash" />
                      </button>
                    )}
                  </div>
                  <div className="lib-card-tr">{w.translations.join(', ')}</div>
                  <div className="lib-card-foot">
                    <div className="lib-card-foot-main">
                      <span className="lib-card-source">{source}</span>
                      <span className="lib-card-algo">{ALGO_LABELS[w.srsState.algo]}</span>
                    </div>
                    <span className={`lib-card-status ${status}`}>{STATUS_LABEL[status]}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectMode && (
        <div className="lib-select-bar">
          <span className="lib-select-count">{selectedIds.size} selected</span>
          <div className="lib-select-actions">
            <button className="lib-select-move" disabled={!selectedIds.size} onClick={() => handleMove('sm2')}>
              Move to SM-2
            </button>
            <button className="lib-select-move" disabled={!selectedIds.size} onClick={() => handleMove('leitner')}>
              Move to Leitner
            </button>
          </div>
          <button className="lib-select-cancel" onClick={toggleSelectMode} title="Cancel">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
