import { describe, it, expect } from 'vitest';
import { reviveWord, reviveWords } from '../src/lib/messaging/revive';

// Messages cross context boundaries; Dates may arrive as ISO strings.
// reviveWord turns a wire-format word back into real Date objects so the
// rest of the app keeps working with Date, not string.

const wireWord = {
  id: 'w1',
  term: 'fortitude',
  translations: ['стойкость'],
  langFrom: 'en',
  langTo: 'ru',
  contextSentence: 'ctx',
  sourceUrl: 'u',
  srsState: {
    algo: 'sm2',
    phase: 'learning',
    stepIndex: 0,
    dueAt: '2026-06-10T12:00:00.000Z',
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
  },
  createdAt: '2026-06-10T12:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
  deletedAt: null,
};

describe('reviveWord', () => {
  it('turns ISO date strings into Date objects', () => {
    const w = reviveWord(wireWord);
    expect(w.createdAt).toBeInstanceOf(Date);
    expect(w.updatedAt).toBeInstanceOf(Date);
    expect(w.srsState.dueAt).toBeInstanceOf(Date);
    expect(w.createdAt.getTime()).toBe(Date.parse('2026-06-10T12:00:00.000Z'));
  });

  it('keeps deletedAt null as null (not an Invalid Date)', () => {
    const w = reviveWord(wireWord);
    expect(w.deletedAt).toBeNull();
  });

  it('revives deletedAt when present', () => {
    const w = reviveWord({ ...wireWord, deletedAt: '2026-06-11T00:00:00.000Z' });
    expect(w.deletedAt).toBeInstanceOf(Date);
  });

  it('reviveWords maps a whole array', () => {
    const ws = reviveWords([wireWord, { ...wireWord, id: 'w2' }]);
    expect(ws).toHaveLength(2);
    expect(ws[1]!.srsState.dueAt).toBeInstanceOf(Date);
  });
});
