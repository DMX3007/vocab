import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import {
  wordStatus,
  sortWords,
  filterWords,
  filterByAlgo,
  type LibrarySort,
  type AlgoFilter,
} from '../lib/review/library';
import { isMastered } from '../lib/review/progress';
import { ALGO_LABELS } from '../lib/review/algo';
import { trackedWords, msUntilDue, formatCountdown, formatOverdue } from '../lib/review/live-queue';
import { speak } from '../lib/tts';
import { EditWordModal } from './EditWordModal';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import type { Word } from '../lib/storage/types';
import type { AlgoId } from '@vocably/core';

interface Props {
  words: Word[];
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
  search: string;
  setSearch: (search: string) => void;
  onDelete: (id: string) => void;
  onMoveAlgo: (ids: string[], algo: AlgoId) => void;
  onShelve: (id: string) => void;
  onUnshelve: (id: string) => void;
  onEdit: (id: string, changes: { term: string; translations: string[]; contextSentence: string }) => void;
  /** Downloads every word, every language, as JSON — a full backup. */
  onExport: () => void;
  /** Soft-deletes every word CURRENTLY shown here (this language only) —
   *  confirmed inline first, see the sheet below. */
  onClearLibrary: () => void;
  /** Popup renders the "Add word" FAB as a sibling, so it needs to know
   *  when select mode is active to hide it (the bulk-move bar covers the
   *  same corner of the screen). */
  onSelectModeChange?: (active: boolean) => void;
}

const STATUS_KEY: Record<string, TranslationKey> = {
  due: 'status.due',
  mastered: 'status.mastered',
  learning: 'status.learning',
  fresh: 'status.fresh',
  shelved: 'status.shelved',
};

export function LibraryPane({ words, sort, setSort, search, setSearch, onDelete, onMoveAlgo, onShelve, onUnshelve, onEdit, onExport, onClearLibrary, onSelectModeChange }: Props) {
  const { t, tp } = useI18n();
  const [algoFilter, setAlgoFilter] = useState<AlgoFilter>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const now = new Date(nowMs);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(
    () => sortWords(filterByAlgo(filterWords(words, search), algoFilter), sort),
    [words, search, algoFilter, sort],
  );
  // Every card gets a live timer, not just a static status label: a due
  // word shows how long it's been waiting, a not-yet-due one shows how
  // long until it's due. Computing "how overdue" is cheap for any number
  // of due words, so that part is unbounded — only the not-yet-due side
  // uses the MAX_TRACKED_WORDS pool, since formatting a countdown is the
  // one part with a real per-tick cost.
  const trackedIds = new Set(trackedWords(words.filter((w) => w.srsState.dueAt.getTime() > nowMs)).map((w) => w.id));

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

  function handleConfirmClear() {
    onClearLibrary();
    setConfirmClearOpen(false);
  }

  if (words.length === 0) {
    return (
      <div className="empty">
        <div className="empty-mark">+</div>
        <div className="empty-title">{t('library.emptyTitle')}</div>
        <div className="empty-hint">{t('library.emptyHint', { addWord: t('library.addWordEm') })}</div>
      </div>
    );
  }

  // Shelved words sit outside all three buckets — they're deliberately set
  // aside, not "fresh" or "learning" in the sense those labels imply.
  const active = words.filter((w) => !w.shelvedAt);
  const mastered = active.filter(isMastered).length;
  const learning = active.filter((w) => w.srsState.intervalDays > 0 && !isMastered(w)).length;
  const fresh = active.filter((w) => w.srsState.intervalDays === 0).length;

  return (
    <div className="library-view">
      <div className="lib-banner">
        <div className="lib-banner-row">
          <div className="lib-banner-title"><span className="serif-italic">{t('library.title')}</span></div>
          <div className="lib-banner-right">
            <button className="icon-btn" onClick={onExport} title={t('library.exportTitle')}>
              <Icon name="download" size={14} />
            </button>
            <button className="icon-btn danger" onClick={() => setConfirmClearOpen(true)} title={t('library.clearTitle')}>
              <Icon name="trash" size={14} />
            </button>
            <div className="lib-banner-count">{words.length} <span className="muted">{t('ribbon.words').toLowerCase()}</span></div>
          </div>
        </div>
        <div className="lib-bucket-row">
          <div className="lib-bucket leaf"><span className="dot" /><strong>{mastered}</strong> {t('library.bucketMastered')}</div>
          <div className="lib-bucket cool"><span className="dot" /><strong>{learning}</strong> {t('library.bucketLearning')}</div>
          <div className="lib-bucket heat"><span className="dot" /><strong>{fresh}</strong> {t('library.bucketFresh')}</div>
        </div>
      </div>

      <div className="lib-toolbar">
        <div className="lib-search">
          <Icon name="search" />
          <input placeholder={t('library.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="lib-sort" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
          <option value="added">{t('sort.recent')}</option>
          <option value="due">{t('sort.due')}</option>
          <option value="alpha">{t('sort.alpha')}</option>
          <option value="mastered">{t('sort.mastered')}</option>
        </select>
      </div>

      <div className="lib-toolbar2">
        <select className="lib-sort" value={algoFilter} onChange={(e) => setAlgoFilter(e.target.value as AlgoFilter)}>
          <option value="all">{t('algoFilter.all')}</option>
          <option value="sm2">{t('algoFilter.sm2')}</option>
          <option value="leitner">{t('algoFilter.leitner')}</option>
        </select>
        <button className={`lib-sort ${selectMode ? 'on' : ''}`} onClick={toggleSelectMode}>
          {selectMode ? t('library.cancel') : t('library.selectMove')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty" style={{ padding: '32px 24px' }}>
          <div className="empty-hint">{t('library.noMatch', { search })}</div>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((w) => {
            const status = wordStatus(w, now);
            const showCountdown = status !== 'due' && trackedIds.has(w.id);
            const pillLabel = status === 'due'
              ? formatOverdue(-msUntilDue(w, now))
              : showCountdown
                ? formatCountdown(msUntilDue(w, now))
                : t(STATUS_KEY[status]!);
            const selected = selectedIds.has(w.id);
            let source = '';
            try {
              source = w.sourceUrl ? new URL(w.sourceUrl).hostname : t('library.sourceManual');
            } catch {
              source = t('library.sourceManual');
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
                      {!selectMode && (
                        <button
                          className="lib-card-speak"
                          onClick={(e) => { e.stopPropagation(); speak(w.term, w.langFrom); }}
                          title={t('library.pronounce')}
                          aria-label={t('library.pronounce')}
                        >
                          <Icon name="volume" />
                        </button>
                      )}
                    </div>
                    {!selectMode && (
                      <div className="lib-card-actions">
                        <button
                          className="lib-card-shelve"
                          onClick={() => setEditingWord(w)}
                          title={t('library.editTitle')}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          className="lib-card-shelve"
                          onClick={() => (w.shelvedAt ? onUnshelve(w.id) : onShelve(w.id))}
                          title={w.shelvedAt ? t('library.unshelveTitle') : t('library.shelveTitle')}
                        >
                          <Icon name="archive" />
                        </button>
                        <button className="lib-card-del" onClick={() => onDelete(w.id)} title={t('library.removeTitle')}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="lib-card-tr">{w.translations.join(', ')}</div>
                  <div className="lib-card-foot">
                    <div className="lib-card-foot-main">
                      <span className="lib-card-source">{source}</span>
                      <span className="lib-card-algo">{ALGO_LABELS[w.srsState.algo]}</span>
                    </div>
                    <span className={`lib-card-status ${status}`} title={showCountdown ? t('library.dueIn', { pill: pillLabel }) : undefined}>{pillLabel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectMode && (
        <div className="lib-select-bar">
          <span className="lib-select-count">{t('library.selectedCount', { n: selectedIds.size })}</span>
          <div className="lib-select-actions">
            <button className="lib-select-move" disabled={!selectedIds.size} onClick={() => handleMove('sm2')}>
              {t('library.moveToSm2')}
            </button>
            <button className="lib-select-move" disabled={!selectedIds.size} onClick={() => handleMove('leitner')}>
              {t('library.moveToLeitner')}
            </button>
          </div>
          <button className="lib-select-cancel" onClick={toggleSelectMode} title={t('library.cancel')}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {confirmClearOpen && (
        <div className="scrim open" onClick={() => setConfirmClearOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{t('library.clearTitleConfirm')}</div>
            <div className="sheet-sub">
              {tp('library.clearSub', words.length)}
            </div>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => setConfirmClearOpen(false)}>{t('library.cancel')}</button>
              <button className="btn-danger" onClick={handleConfirmClear}>{t('library.deleteAll')}</button>
            </div>
          </div>
        </div>
      )}

      <EditWordModal
        word={editingWord}
        onClose={() => setEditingWord(null)}
        onSave={(id, changes) => { onEdit(id, changes); setEditingWord(null); }}
      />
    </div>
  );
}
