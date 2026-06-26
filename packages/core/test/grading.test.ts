import { describe, it, expect } from 'vitest';
import { normalizeAnswer, levenshtein, gradeAnswer } from '../src/index';

describe('normalizeAnswer', () => {
  it('trims, lowercases, collapses inner whitespace', () => {
    expect(normalizeAnswer('  СтойКость  ')).toBe('стойкость');
    expect(normalizeAnswer('high   leverage')).toBe('high leverage');
  });

  it('treats ё as е (Russian targets)', () => {
    expect(normalizeAnswer('всё')).toBe(normalizeAnswer('все'));
  });

  it('strips punctuation and diacritics', () => {
    expect(normalizeAnswer('résumé!')).toBe('resume');
    expect(normalizeAnswer('добродетели.')).toBe('добродетели');
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('стойкость', 'стойкость')).toBe(0);
    expect(levenshtein('стойкость', 'стойкост')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('gradeAnswer', () => {
  const accepted = ['стойкость', 'твёрдость духа'];

  it('exact match against any accepted translation -> correct, grade 5 when fast', () => {
    const r = gradeAnswer('стойкость', accepted, { latencyMs: 2_000 });
    expect(r.verdict).toBe('correct');
    expect(r.grade).toBe(5);
  });

  it('exact but slow -> correct, grade 4', () => {
    const r = gradeAnswer('Твердость духа', accepted, { latencyMs: 15_000 });
    expect(r.verdict).toBe('correct');
    expect(r.grade).toBe(4);
  });

  it('one typo (distance 1) -> almost, grade 3', () => {
    const r = gradeAnswer('стойкост', accepted, { latencyMs: 3_000 });
    expect(r.verdict).toBe('almost');
    expect(r.grade).toBe(3);
  });

  it('typo tolerance is off for very short answers (<=3 chars)', () => {
    const r = gradeAnswer('кот', ['кит'], { latencyMs: 1_000 });
    expect(r.verdict).toBe('wrong');
  });

  it('wrong answer -> grade 1, skip/hint -> grade 0', () => {
    expect(gradeAnswer('терпение', accepted, { latencyMs: 3_000 }).grade).toBe(1);
    expect(gradeAnswer('', accepted, { skipped: true }).grade).toBe(0);
    expect(gradeAnswer('стойкость', accepted, { usedHint: true }).grade).toBeLessThanOrEqual(3);
  });
});
