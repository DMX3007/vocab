import React, { useReducer, useRef, useEffect } from 'react';
import {
  tooltipReducer,
  initialTooltipState,
  type SavePayload,
} from '../lib/tooltip-machine';
import { Icon } from './icons';
import { speak } from '../lib/tts';
import { useI18n } from '../lib/i18n';

interface TooltipProps {
  term: string;
  contextSentence: string;
  sourceUrl: string;
  langFrom: string;
  langTo: string;
  /** called when the user saves; the host wires this to the repository */
  onSave: (payload: SavePayload, langFrom: string, langTo: string) => void;
  onDismiss: () => void;
  /** fetches a translation for AUTO; the host wires this to the translate
   *  provider so this component stays network-free and easy to test */
  onAutoTranslate: (term: string, langFrom: string, langTo: string) => Promise<string>;
}

// A "dumb" view over the tooltip state machine: it renders state and
// dispatches events. The actual translate fetch is injected via
// onAutoTranslate rather than called from here, so this stays testable
// without mocking messaging/network.
export function Tooltip({
  term,
  contextSentence,
  sourceUrl,
  langFrom,
  langTo,
  onSave,
  onDismiss,
  onAutoTranslate,
}: TooltipProps) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(tooltipReducer, undefined, () => {
    const initial = initialTooltipState();
    return tooltipReducer(initial, { type: 'SELECT', term, contextSentence, sourceUrl });
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Save once the machine reaches the 'saved' state.
  useEffect(() => {
    if (state.status === 'saved' && state.payload) {
      onSave(state.payload, langFrom, langTo);
    }
    if (state.status === 'dismissed') onDismiss();
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs the actual translate request while the machine is in 'translating'.
  useEffect(() => {
    if (state.status !== 'translating') return;
    let cancelled = false;
    onAutoTranslate(state.term, langFrom, langTo)
      .then((translation) => {
        if (!cancelled) dispatch({ type: 'TRANSLATE_DONE', translation });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'TRANSLATE_FAILED' });
      });
    return () => { cancelled = true; };
  }, [state.status, state.term, langFrom, langTo, onAutoTranslate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && state.canSave) dispatch({ type: 'SAVE' });
    if (e.key === 'Escape') dispatch({ type: 'DISMISS' });
  };

  return (
    <div className="vf-tooltip" onKeyDown={onKeyDown}>
      <div className="vf-row vf-head">
        <div className="vf-row" style={{ gap: 6 }}>
          <span className="vf-term">{term}</span>
          <button
            type="button"
            className="vf-speak-btn vf-speak-btn-sm"
            onClick={() => speak(term, langFrom)}
            title={t('library.pronounce')}
            aria-label={t('library.pronounce')}
          >
            <Icon name="volume" size={12} />
          </button>
        </div>
        <span className="vf-langs">
          {langFrom.toUpperCase()} {'\u2192'} <b>{langTo.toUpperCase()}</b>
        </span>
      </div>

      <div className="vf-row">
        <input
          ref={inputRef}
          className="vf-input"
          placeholder={t('tooltip.translationPlaceholder')}
          value={state.translation}
          onChange={(e) => dispatch({ type: 'EDIT', translation: e.target.value })}
        />
        <button
          className="vf-auto"
          disabled={state.status === 'translating'}
          title={t('tooltip.autoTitle')}
          onClick={() => dispatch({ type: 'TRANSLATE_AUTO' })}
        >
          {state.status === 'translating' ? '…' : t('tooltip.auto')}
        </button>
      </div>

      {state.autoFailed && (
        <div className="vf-row vf-hint">{t('tooltip.autoFailed')}</div>
      )}

      <div className="vf-row vf-foot">
        <button className="vf-x" onClick={() => dispatch({ type: 'DISMISS' })} aria-label={t('tooltip.close')}>
          {"\u00d7"}
        </button>
        <button
          className="vf-save"
          disabled={!state.canSave}
          onClick={() => dispatch({ type: 'SAVE' })}
        >
          {t('tooltip.save')}
        </button>
      </div>
    </div>
  );
}
