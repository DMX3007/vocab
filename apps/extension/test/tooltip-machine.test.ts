import { describe, it, expect } from 'vitest';
import { tooltipReducer, initialTooltipState, type TooltipState } from '../src/lib/tooltip-machine';

// The tooltip's brain is a pure reducer: (state, event) -> state.
// The React component only renders state.status and dispatches events;
// the network call lives in the component, which dispatches TRANSLATE_DONE
// or TRANSLATE_FAILED back. That keeps this reducer testable without mocks.

const selected = (): TooltipState =>
  tooltipReducer(initialTooltipState(), {
    type: 'SELECT',
    term: 'fortitude',
    contextSentence: 'He showed great fortitude during the crisis.',
    sourceUrl: 'https://evolveinc.io/post',
  });

describe('tooltipReducer', () => {
  it('starts idle with nothing selected', () => {
    const s = initialTooltipState();
    expect(s.status).toBe('idle');
    expect(s.canSave).toBe(false);
  });

  it('SELECT -> selected, keeps term/context/url, translation empty, cannot save yet', () => {
    const s = selected();
    expect(s.status).toBe('selected');
    expect(s.term).toBe('fortitude');
    expect(s.contextSentence).toBe('He showed great fortitude during the crisis.');
    expect(s.translation).toBe('');
    expect(s.canSave).toBe(false);
  });

  it('EDIT fills the translation by hand and enables save; clearing it disables save again', () => {
    let s = selected();
    s = tooltipReducer(s, { type: 'EDIT', translation: 'стойкость' });
    expect(s.translation).toBe('стойкость');
    expect(s.canSave).toBe(true);
    s = tooltipReducer(s, { type: 'EDIT', translation: '   ' });
    expect(s.canSave).toBe(false);
  });

  it('TRANSLATE_AUTO -> translating; TRANSLATE_DONE -> ready with the auto translation, still editable', () => {
    let s = selected();
    s = tooltipReducer(s, { type: 'TRANSLATE_AUTO' });
    expect(s.status).toBe('translating');
    s = tooltipReducer(s, { type: 'TRANSLATE_DONE', translation: 'стойкость' });
    expect(s.status).toBe('ready');
    expect(s.translation).toBe('стойкость');
    expect(s.canSave).toBe(true);
    // auto result is a draft, not final — the user can still overwrite it
    s = tooltipReducer(s, { type: 'EDIT', translation: 'твёрдость духа' });
    expect(s.translation).toBe('твёрдость духа');
  });

  it('TRANSLATE_FAILED -> back to selected, manual entry remains the fallback', () => {
    let s = selected();
    s = tooltipReducer(s, { type: 'TRANSLATE_AUTO' });
    s = tooltipReducer(s, { type: 'TRANSLATE_FAILED' });
    expect(s.status).toBe('selected');
    expect(s.autoFailed).toBe(true);
    expect(s.canSave).toBe(false);
  });

  it('SAVE with a translation -> saved, exposes the full payload to persist', () => {
    let s = selected();
    s = tooltipReducer(s, { type: 'EDIT', translation: 'стойкость' });
    s = tooltipReducer(s, { type: 'SAVE' });
    expect(s.status).toBe('saved');
    expect(s.payload).toEqual({
      term: 'fortitude',
      translation: 'стойкость',
      contextSentence: 'He showed great fortitude during the crisis.',
      sourceUrl: 'https://evolveinc.io/post',
    });
  });

  it('SAVE without a translation is ignored (no crash, stays put)', () => {
    const s = selected();
    const after = tooltipReducer(s, { type: 'SAVE' });
    expect(after.status).toBe('selected');
    expect(after.payload).toBeUndefined();
  });

  it('DISMISS from any state -> dismissed', () => {
    expect(tooltipReducer(selected(), { type: 'DISMISS' }).status).toBe('dismissed');
    const translating = tooltipReducer(selected(), { type: 'TRANSLATE_AUTO' });
    expect(tooltipReducer(translating, { type: 'DISMISS' }).status).toBe('dismissed');
  });

  it('is pure: does not mutate the input state', () => {
    const s = selected();
    const frozen = JSON.stringify(s);
    tooltipReducer(s, { type: 'EDIT', translation: 'x' });
    expect(JSON.stringify(s)).toBe(frozen);
  });
});
