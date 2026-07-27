import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from './icons';

export interface AddWordInput {
  term: string;
  translation: string;
  contextSentence?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (inputs: AddWordInput[]) => void;
}

// Add-to-library sheet: single word (term + translation + optional example),
// or a bulk paste mode that parses one "term — translation" pair per line.
// There's no auto-translate here — the tooltip's own AUTO button is disabled
// pending a translate endpoint, so this modal doesn't pretend to have one.
export function AddWordModal({ open, onClose, onAdd }: Props) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [term, setTerm] = useState('');
  const [translation, setTranslation] = useState('');
  const [context, setContext] = useState('');
  const [bulkText, setBulkText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => (mode === 'single' ? inputRef.current : areaRef.current)?.focus(), 200);
    } else {
      setTimeout(() => {
        setTerm('');
        setTranslation('');
        setContext('');
        setBulkText('');
        setMode('single');
      }, 250);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    onClose();
  }

  function submitBulk() {
    if (!parsedBulk.length) return;
    onAdd(parsedBulk.map((r) => ({ term: r.term, translation: r.translation })));
    onClose();
  }

  return (
    <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Add to library</div>
        <div className="sheet-sub">Save words you want to remember. We&rsquo;ll schedule reviews.</div>

        <div className="mode-switch">
          <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
            <Icon name="plus" size={12} /> Single
          </button>
          <button className={mode === 'bulk' ? 'on' : ''} onClick={() => setMode('bulk')}>
            <Icon name="paste" size={12} /> Paste a list
          </button>
        </div>

        {mode === 'single' ? (
          <>
            <div className="field">
              <label className="field-label">Word</label>
              <input
                ref={inputRef}
                className="field-input"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="e.g. fortitude"
              />
            </div>
            <div className="field">
              <label className="field-label">Translation</label>
              <input
                className="field-input"
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                placeholder="e.g. стойкость"
              />
            </div>
            <div className="field">
              <label className="field-label">Example sentence (optional)</label>
              <input
                className="field-input"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="A sentence beats a single word"
              />
            </div>
            <button className="btn-primary" onClick={submitSingle} disabled={!term.trim() || !translation.trim()}>
              <Icon name="plus" size={14} /> Add to library
            </button>
          </>
        ) : (
          <>
            <div className="bulk-help">
              One pair per line — separated by <span className="kbd">—</span>, <span className="kbd">:</span>, or tab.
            </div>
            <div className="field">
              <label className="field-label">Paste your list</label>
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
                  Preview {'·'} {parsedBulk.length} word{parsedBulk.length === 1 ? '' : 's'}
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
                      <span className="pt">… and {parsedBulk.length - 6} more</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <button className="btn-primary" onClick={submitBulk} disabled={!parsedBulk.length}>
              <Icon name="download" size={14} /> Import {parsedBulk.length || ''} word{parsedBulk.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
