import React, { useReducer, useRef, useEffect } from 'react';
import {
  tooltipReducer,
  initialTooltipState,
  type SavePayload,
} from '../lib/tooltip-machine';

interface TooltipProps {
  term: string;
  contextSentence: string;
  sourceUrl: string;
  langFrom: string;
  langTo: string;
  /** called when the user saves; the host wires this to the repository */
  onSave: (payload: SavePayload, langFrom: string, langTo: string) => void;
  onDismiss: () => void;
}

// A "dumb" view over the tooltip state machine: it renders state and
// dispatches events. No storage, no network here. AUTO is shown but
// disabled until the translate endpoint exists (see backlog).
export function Tooltip({
  term,
  contextSentence,
  sourceUrl,
  langFrom,
  langTo,
  onSave,
  onDismiss,
}: TooltipProps) {
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && state.canSave) dispatch({ type: 'SAVE' });
    if (e.key === 'Escape') dispatch({ type: 'DISMISS' });
  };

  return (
    <div className="vf-tooltip" onKeyDown={onKeyDown}>
      <div className="vf-row vf-head">
        <span className="vf-term">{term}</span>
        <span className="vf-langs">
          {langFrom.toUpperCase()} {'\u2192'} <b>{langTo.toUpperCase()}</b>
        </span>
      </div>

      <div className="vf-row">
        <input
          ref={inputRef}
          className="vf-input"
          placeholder="Translation..."
          value={state.translation}
          onChange={(e) => dispatch({ type: 'EDIT', translation: e.target.value })}
        />
        <button className="vf-auto" disabled title="Auto-translate - coming soon">
          AUTO
        </button>
      </div>

      <div className="vf-row vf-foot">
        <button className="vf-x" onClick={() => dispatch({ type: 'DISMISS' })} aria-label="Close">
          {"\u00d7"}
        </button>
        <button
          className="vf-save"
          disabled={!state.canSave}
          onClick={() => dispatch({ type: 'SAVE' })}
        >
          Save
        </button>
      </div>
    </div>
  );
}
