// The tooltip's brain. A pure reducer: (state, event) -> new state.
// No network, no DOM, no React in here — the component renders `status`
// and dispatches events; the actual fetch lives in the component, which
// dispatches TRANSLATE_DONE / TRANSLATE_FAILED back into this reducer.

export type TooltipStatus =
  | 'idle' //         nothing selected
  | 'selected' //     a word is selected, waiting for a translation
  | 'translating' //  an auto-translation request is in flight
  | 'ready' //        an auto-translation came back (still editable)
  | 'saved' //        the word has been saved
  | 'dismissed'; //   the tooltip was closed

/** What we hand off to be persisted once the user saves. */
export interface SavePayload {
  term: string;
  translation: string;
  contextSentence: string;
  sourceUrl: string;
}

export interface TooltipState {
  status: TooltipStatus;
  term: string;
  contextSentence: string;
  sourceUrl: string;
  translation: string;
  /** true once an auto-translation attempt has failed (manual entry is the fallback) */
  autoFailed: boolean;
  /** true when there is a non-empty translation to save */
  canSave: boolean;
  /** present only in the 'saved' state */
  payload?: SavePayload;
}

export type TooltipEvent =
  | { type: 'SELECT'; term: string; contextSentence: string; sourceUrl: string }
  | { type: 'TRANSLATE_AUTO' }
  | { type: 'TRANSLATE_DONE'; translation: string }
  | { type: 'TRANSLATE_FAILED' }
  | { type: 'EDIT'; translation: string }
  | { type: 'SAVE' }
  | { type: 'DISMISS' };

export function initialTooltipState(): TooltipState {
  return {
    status: 'idle',
    term: '',
    contextSentence: '',
    sourceUrl: '',
    translation: '',
    autoFailed: false,
    canSave: false,
  };
}

/** A translation counts as saveable only if it has non-whitespace content. */
function hasContent(translation: string): boolean {
  return translation.trim().length > 0;
}

export function tooltipReducer(state: TooltipState, event: TooltipEvent): TooltipState {
  switch (event.type) {
    case 'SELECT':
      return {
        ...initialTooltipState(),
        status: 'selected',
        term: event.term,
        contextSentence: event.contextSentence,
        sourceUrl: event.sourceUrl,
      };

    case 'TRANSLATE_AUTO':
      return { ...state, status: 'translating', autoFailed: false };

    case 'TRANSLATE_DONE':
      return {
        ...state,
        status: 'ready',
        translation: event.translation,
        canSave: hasContent(event.translation),
      };

    case 'TRANSLATE_FAILED':
      // Auto-translation didn't work — fall back to the selected state so
      // the user can type a translation by hand.
      return { ...state, status: 'selected', autoFailed: true };

    case 'EDIT':
      return {
        ...state,
        translation: event.translation,
        canSave: hasContent(event.translation),
      };

    case 'SAVE':
      // Ignore saves with nothing to save — no crash, stay where we are.
      if (!state.canSave) return state;
      return {
        ...state,
        status: 'saved',
        payload: {
          term: state.term,
          translation: state.translation.trim(),
          contextSentence: state.contextSentence,
          sourceUrl: state.sourceUrl,
        },
      };

    case 'DISMISS':
      return { ...state, status: 'dismissed' };
  }
}
