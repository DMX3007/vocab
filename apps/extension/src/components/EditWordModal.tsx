import React, { useState, useEffect, useRef } from 'react';
import { Icon } from './icons';
import type { Word } from '../lib/storage/types';

interface Props {
  /** The word being edited, or null when the sheet is closed — doubles as
   *  both the open flag and the data source, so there's no separate stale
   *  "which word" state to keep in sync. */
  word: Word | null;
  onClose: () => void;
  onSave: (id: string, changes: { term: string; translations: string[]; contextSentence: string }) => void;
}

// Edit sheet for a Library word: term, accepted translations (comma-
// separated — a word can have more than one right answer), and the
// example sentence. SRS progress is never touched here — that's the whole
// point, this fixes a typo without resetting how well you know the word.
export function EditWordModal({ word, onClose, onSave }: Props) {
  const [term, setTerm] = useState('');
  const [translations, setTranslations] = useState('');
  const [context, setContext] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!word) return;
    setTerm(word.term);
    setTranslations(word.translations.join(', '));
    setContext(word.contextSentence);
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [word]);

  if (!word) return null;

  const parsedTranslations = translations.split(',').map((t) => t.trim()).filter(Boolean);
  const canSave = term.trim().length > 0 && parsedTranslations.length > 0;

  function submit() {
    if (!canSave || !word) return;
    onSave(word.id, { term: term.trim(), translations: parsedTranslations, contextSentence: context.trim() });
  }

  return (
    <div className="scrim open" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Edit word</div>
        <div className="sheet-sub">Fixes here don&rsquo;t touch progress — same review schedule either way.</div>

        <div className="field">
          <label className="field-label">Word</label>
          <input ref={inputRef} className="field-input" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Translations (comma-separated)</label>
          <input className="field-input" value={translations} onChange={(e) => setTranslations(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Example sentence (optional)</label>
          <input className="field-input" value={context} onChange={(e) => setContext(e.target.value)} />
        </div>

        <div className="confirm-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ width: 'auto', flex: 1 }} onClick={submit} disabled={!canSave}>
            <Icon name="check" size={13} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
