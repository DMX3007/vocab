import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from './icons';
import { fetchWordsFromGoogleSheet, type WordInput } from '../lib/import/google-sheet';
import { DraftStore } from '../lib/storage/draft-store';
import { useI18n } from '../lib/i18n';

export type AddWordInput = WordInput;

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (inputs: AddWordInput[]) => void;
  /** Where the in-progress draft is persisted — see draft-store.ts. */
  draftStore: DraftStore;
  /** Pops this same form out into a persistent browser window. Omitted
   *  when we're already running inside one, so there's nothing to pop out
   *  of further. See draft-store.ts for why this exists. */
  onPopout?: () => void;
}

type Mode = 'single' | 'bulk' | 'sheet';

// Add-to-library sheet: a single word (term + translation + optional
// example), a bulk paste mode that parses one "term — translation" pair per
// line, or a Google Sheet import (public CSV export, no OAuth). No
// auto-translate here — that's the tooltip's AUTO button; this modal is for
// words typed or pasted in directly, translation included.
export function AddWordModal({ open, onClose, onAdd, draftStore, onPopout }: Props) {
  const { t, tp } = useI18n();
  const [mode, setMode] = useState<Mode>('single');
  const [term, setTerm] = useState('');
  const [translation, setTranslation] = useState('');
  const [context, setContext] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetWords, setSheetWords] = useState<WordInput[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      void (async () => {
        const draft = await draftStore.load();
        let focusMode: Mode = mode;
        if (draft) {
          setMode(draft.mode);
          setTerm(draft.term);
          setTranslation(draft.translation);
          setContext(draft.context);
          setBulkText(draft.bulkText);
          setSheetUrl(draft.sheetUrl);
          focusMode = draft.mode;
        }
        setTimeout(() => (focusMode === 'single' ? inputRef.current : areaRef.current)?.focus(), 200);
      })();
    } else {
      setTimeout(() => {
        setTerm('');
        setTranslation('');
        setContext('');
        setBulkText('');
        setSheetUrl('');
        setSheetWords([]);
        setSheetLoading(false);
        setSheetError(null);
        setMode('single');
      }, 250);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Safety net for a popup that closes mid-type (see draft-store.ts):
  // debounced so normal typing doesn't hammer storage, but short enough
  // that a sudden focus-loss close still has something recent to restore.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      void draftStore.save({ mode, term, translation, context, bulkText, sheetUrl });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, term, translation, context, bulkText, sheetUrl]);

  const parsedBulk = useMemo(() => {
    return bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(/\s*[—–\-:|\t]\s*/);
        return { term: parts[0] ?? '', translation: parts.slice(1).join(' — ') };
      })
      .filter((r) => r.term && r.translation);
  }, [bulkText]);

  function submitSingle() {
    if (!term.trim() || !translation.trim()) return;
    onAdd([{ term: term.trim(), translation: translation.trim(), contextSentence: context.trim() }]);
    void draftStore.clear();
    onClose();
  }

  function submitBulk() {
    if (!parsedBulk.length) return;
    onAdd(parsedBulk.map((r) => ({ term: r.term, translation: r.translation })));
    void draftStore.clear();
    onClose();
  }

  async function handleFetchSheet() {
    if (!sheetUrl.trim()) return;
    setSheetLoading(true);
    setSheetError(null);
    setSheetWords([]);
    try {
      setSheetWords(await fetchWordsFromGoogleSheet(sheetUrl.trim()));
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : t('add.sheetError'));
    } finally {
      setSheetLoading(false);
    }
  }

  function submitSheet() {
    if (!sheetWords.length) return;
    onAdd(sheetWords);
    void draftStore.clear();
    onClose();
  }

  return (
    <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header-row">
          <div>
            <div className="sheet-title">{t('add.title')}</div>
            <div className="sheet-sub">{t('add.subtitle')}</div>
          </div>
          {onPopout && (
            <button
              type="button"
              className="icon-btn"
              title={t('add.popoutTitle')}
              aria-label={t('add.popoutTitle')}
              onClick={() => {
                // Flush the draft before handing off — the debounced autosave
                // above may not have fired yet, and the toolbar popup this
                // closes right behind us won't get another chance to.
                void draftStore.save({ mode, term, translation, context, bulkText, sheetUrl }).then(onPopout);
              }}
            >
              <Icon name="popout" size={15} />
            </button>
          )}
        </div>

        <div className="mode-switch">
          <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
            <Icon name="plus" size={12} /> {t('add.modeSingle')}
          </button>
          <button className={mode === 'bulk' ? 'on' : ''} onClick={() => setMode('bulk')}>
            <Icon name="paste" size={12} /> {t('add.modePaste')}
          </button>
          <button className={mode === 'sheet' ? 'on' : ''} onClick={() => setMode('sheet')}>
            <Icon name="sheet" size={12} /> {t('add.modeSheet')}
          </button>
        </div>

        {mode === 'single' ? (
          <>
            <div className="field">
              <label className="field-label">{t('add.wordLabel')}</label>
              <input
                ref={inputRef}
                className="field-input"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t('add.wordPlaceholder')}
              />
            </div>
            <div className="field">
              <label className="field-label">{t('add.translationLabel')}</label>
              <input
                className="field-input"
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                placeholder={t('add.translationPlaceholder')}
              />
            </div>
            <div className="field">
              <label className="field-label">{t('add.exampleLabel')}</label>
              <input
                className="field-input"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder={t('add.examplePlaceholder')}
              />
            </div>
            <button className="btn-primary" onClick={submitSingle} disabled={!term.trim() || !translation.trim()}>
              <Icon name="plus" size={14} /> {t('add.submitSingle')}
            </button>
          </>
        ) : mode === 'bulk' ? (
          <>
            <div className="bulk-help">
              {t('add.bulkHelp', { dash: '—', colon: ':' })}
            </div>
            <div className="field">
              <label className="field-label">{t('add.pasteYourList')}</label>
              <textarea
                ref={areaRef}
                className="field-area"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'fortitude — стойкость\nresilience: устойчивость'}
              />
            </div>

            {parsedBulk.length > 0 && (
              <>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  {t('add.preview')} {'·'} {parsedBulk.length}
                </div>
                <div className="bulk-preview">
                  {parsedBulk.slice(0, 6).map((r, i) => (
                    <div className="bulk-preview-row" key={i}>
                      <span className="pw">{r.term}</span>
                      <span className="pt">{r.translation}</span>
                    </div>
                  ))}
                  {parsedBulk.length > 6 && (
                    <div className="bulk-preview-row">
                      <span className="pt">{t('add.andMore', { n: parsedBulk.length - 6 })}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <button className="btn-primary" onClick={submitBulk} disabled={!parsedBulk.length}>
              <Icon name="download" size={14} /> {tp('add.importBtn', parsedBulk.length)}
            </button>
          </>
        ) : (
          <>
            <div className="bulk-help">
              {t('add.sheetHelp', { anyone: t('add.sheetHelpAnyone') })}
            </div>
            <div className="field">
              <label className="field-label">{t('add.sheetUrlLabel')}</label>
              <input
                className="field-input"
                value={sheetUrl}
                onChange={(e) => {
                  setSheetUrl(e.target.value);
                  setSheetError(null);
                  setSheetWords([]);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/…"
              />
            </div>

            <button
              className="btn-secondary"
              onClick={handleFetchSheet}
              disabled={!sheetUrl.trim() || sheetLoading}
              style={{ marginBottom: 12 }}
            >
              {sheetLoading ? t('add.fetching') : (<><Icon name="sheet" size={13} /> {t('add.fetchWords')}</>)}
            </button>

            {sheetError && (
              <div className="license-msg err" style={{ marginBottom: 12 }}>{sheetError}</div>
            )}

            {sheetWords.length > 0 && (
              <>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  {t('add.preview')} {'·'} {sheetWords.length}
                </div>
                <div className="bulk-preview">
                  {sheetWords.slice(0, 6).map((r, i) => (
                    <div className="bulk-preview-row" key={i}>
                      <span className="pw">{r.term}</span>
                      <span className="pt">{r.translation}</span>
                    </div>
                  ))}
                  {sheetWords.length > 6 && (
                    <div className="bulk-preview-row">
                      <span className="pt">{t('add.andMore', { n: sheetWords.length - 6 })}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <button className="btn-primary" onClick={submitSheet} disabled={!sheetWords.length}>
              <Icon name="download" size={14} /> {tp('add.importBtn', sheetWords.length)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
