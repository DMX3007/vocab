import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toSpeechLang, isTtsSupported, speak } from '../src/lib/tts';

describe('toSpeechLang', () => {
  it('maps known 2-letter codes to a full BCP-47 tag', () => {
    expect(toSpeechLang('ru')).toBe('ru-RU');
    expect(toSpeechLang('en')).toBe('en-US');
    expect(toSpeechLang('ja')).toBe('ja-JP');
  });

  it('passes an unknown code through unchanged rather than failing', () => {
    expect(toSpeechLang('xx')).toBe('xx');
  });
});

describe('speak', () => {
  const originalSpeechSynthesis = (globalThis as any).speechSynthesis;
  const originalUtterance = (globalThis as any).SpeechSynthesisUtterance;
  let cancel: ReturnType<typeof vi.fn>;
  let speakFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cancel = vi.fn();
    speakFn = vi.fn();
    (globalThis as any).speechSynthesis = { cancel, speak: speakFn };
    (globalThis as any).SpeechSynthesisUtterance = vi.fn().mockImplementation((text: string) => ({ text, lang: '' }));
  });

  afterEach(() => {
    (globalThis as any).speechSynthesis = originalSpeechSynthesis;
    (globalThis as any).SpeechSynthesisUtterance = originalUtterance;
  });

  it('is supported when window.speechSynthesis exists', () => {
    expect(isTtsSupported()).toBe(true);
  });

  it('cancels any in-flight utterance before speaking the new one', () => {
    speak('fortitude', 'en');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speakFn).toHaveBeenCalledTimes(1);
  });

  it('sets the utterance lang from the BCP-47 mapping', () => {
    speak('стойкость', 'ru');
    const utterance = speakFn.mock.calls[0]![0];
    expect(utterance.lang).toBe('ru-RU');
    expect(utterance.text).toBe('стойкость');
  });

  it('does nothing for blank text', () => {
    speak('   ', 'en');
    expect(speakFn).not.toHaveBeenCalled();
  });

  it('does nothing when speechSynthesis is unsupported', () => {
    delete (globalThis as any).speechSynthesis;
    speak('fortitude', 'en');
    expect(speakFn).not.toHaveBeenCalled();
  });
});
