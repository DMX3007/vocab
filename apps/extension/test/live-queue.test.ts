import { describe, it, expect } from 'vitest';
import { trackedWords, msUntilDue, formatCountdown, MAX_TRACKED_WORDS } from '../src/lib/review/live-queue';
import type { Word } from '../src/lib/storage/types';

const NOW = new Date('2026-06-13T12:00:00Z');

function word(id: string, dueAt: Date): Word {
  return {
    id,
    term: id,
    translations: ['x'],
    langFrom: 'en',
    langTo: 'ru',
    contextSentence: '',
    sourceUrl: '',
    srsState: {
      algo: 'sm2', phase: 'review', stepIndex: 0,
      dueAt, intervalDays: 1, easeFactor: 2.5, repetitions: 1, lapses: 0,
    },
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

describe('trackedWords', () => {
  it('sorts ascending by dueAt, soonest first', () => {
    const a = word('a', new Date(NOW.getTime() + 30_000));
    const b = word('b', new Date(NOW.getTime() - 5_000));
    const c = word('c', new Date(NOW.getTime() + 5_000));
    expect(trackedWords([a, b, c]).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('caps at the given limit', () => {
    const words = Array.from({ length: 10 }, (_, i) => word(`w${i}`, new Date(NOW.getTime() + i * 1000)));
    expect(trackedWords(words, 3)).toHaveLength(3);
    expect(trackedWords(words, 3).map((w) => w.id)).toEqual(['w0', 'w1', 'w2']);
  });

  it('defaults to MAX_TRACKED_WORDS when no limit is given', () => {
    const words = Array.from({ length: MAX_TRACKED_WORDS + 20 }, (_, i) => word(`w${i}`, new Date(NOW.getTime() + i)));
    expect(trackedWords(words)).toHaveLength(MAX_TRACKED_WORDS);
  });

  it('does not mutate the input array', () => {
    const a = word('a', new Date(NOW.getTime() + 30_000));
    const b = word('b', new Date(NOW.getTime() - 5_000));
    const words = [a, b];
    trackedWords(words);
    expect(words.map((w) => w.id)).toEqual(['a', 'b']);
  });
});

describe('msUntilDue', () => {
  it('positive for a word due in the future', () => {
    expect(msUntilDue(word('a', new Date(NOW.getTime() + 10_000)), NOW)).toBe(10_000);
  });
  it('negative for an overdue word', () => {
    expect(msUntilDue(word('a', new Date(NOW.getTime() - 10_000)), NOW)).toBe(-10_000);
  });
});

describe('formatCountdown', () => {
  it('shows seconds under a minute', () => {
    expect(formatCountdown(45_000)).toBe('45s');
  });
  it('shows minutes under an hour', () => {
    expect(formatCountdown(5 * 60_000)).toBe('5m');
  });
  it('shows hours and minutes under a day', () => {
    expect(formatCountdown(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });
  it('drops the minutes when they are exactly 0', () => {
    expect(formatCountdown(3 * 3_600_000)).toBe('3h');
  });
  it('shows whole days at 24h and beyond', () => {
    expect(formatCountdown(2 * 86_400_000)).toBe('2d');
  });
  it('never goes negative — clamps to 0s', () => {
    expect(formatCountdown(-5_000)).toBe('0s');
  });
});
