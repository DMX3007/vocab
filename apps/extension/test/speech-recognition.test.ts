import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSpeechRecognitionSupported, listen } from '../src/lib/voice/speech-recognition';

// A minimal fake matching just the surface speech-recognition.ts touches —
// enough to drive onresult/onerror/onend by hand from each test.
class FakeRecognition {
  lang = '';
  interimResults = false;
  maxAlternatives = 1;
  continuous = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
}

describe('isSpeechRecognitionSupported', () => {
  afterEach(() => {
    delete (globalThis as any).SpeechRecognition;
    delete (globalThis as any).webkitSpeechRecognition;
  });

  it('false when neither constructor exists', () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it('true when webkitSpeechRecognition exists (Chrome)', () => {
    (globalThis as any).webkitSpeechRecognition = FakeRecognition;
    expect(isSpeechRecognitionSupported()).toBe(true);
  });
});

describe('listen', () => {
  let instance: FakeRecognition;

  beforeEach(() => {
    (globalThis as any).webkitSpeechRecognition = vi.fn().mockImplementation(() => {
      instance = new FakeRecognition();
      return instance;
    });
  });

  afterEach(() => {
    delete (globalThis as any).SpeechRecognition;
    delete (globalThis as any).webkitSpeechRecognition;
  });

  it('returns null and reports "not-supported" when the browser has no speech API', () => {
    delete (globalThis as any).webkitSpeechRecognition;
    const onError = vi.fn();
    const onEnd = vi.fn();
    const handle = listen('en', { onResult: vi.fn(), onError, onEnd });
    expect(handle).toBeNull();
    expect(onError).toHaveBeenCalledWith('not-supported');
    // onEnd must fire on EVERY exit path: callers set their "listening" flag
    // before calling listen() and only ever clear it in onEnd, so skipping it
    // here strands the mic button lit and unclickable forever.
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reports a throwing start() through the callbacks instead of propagating', () => {
    // start() throws InvalidStateError if a turn is somehow already running.
    // Letting that escape would blow up out of a click handler and, again,
    // strand the caller's "listening" flag with no end event to clear it.
    (globalThis as any).webkitSpeechRecognition = vi.fn().mockImplementation(() => {
      instance = new FakeRecognition();
      instance.start = vi.fn(() => { throw new DOMException('busy', 'InvalidStateError'); });
      return instance;
    });
    const onError = vi.fn();
    const onEnd = vi.fn();
    let handle: ReturnType<typeof listen>;
    expect(() => { handle = listen('en', { onResult: vi.fn(), onError, onEnd }); }).not.toThrow();
    expect(handle!).toBeNull();
    expect(onError).toHaveBeenCalledWith('start-failed');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('maps the language via the same BCP-47 table speak() uses, and starts listening', () => {
    listen('ru', { onResult: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    expect(instance!.lang).toBe('ru-RU');
    expect(instance!.start).toHaveBeenCalledTimes(1);
    expect(instance!.continuous).toBe(false);
    expect(instance!.interimResults).toBe(false);
  });

  it('trims and forwards the top transcript on a result', () => {
    const onResult = vi.fn();
    listen('en', { onResult, onError: vi.fn(), onEnd: vi.fn() });
    instance!.onresult!({ results: [[{ transcript: '  fortitude  ' }]] });
    expect(onResult).toHaveBeenCalledWith('fortitude');
  });

  it('forwards the raw error code', () => {
    const onError = vi.fn();
    listen('en', { onResult: vi.fn(), onError, onEnd: vi.fn() });
    instance!.onerror!({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });

  it('fires onEnd exactly once, even if the underlying API somehow calls onend twice', () => {
    const onEnd = vi.fn();
    listen('en', { onResult: vi.fn(), onError: vi.fn(), onEnd });
    instance!.onend!();
    instance!.onend!();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop() delegates to the underlying recognition', () => {
    const handle = listen('en', { onResult: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    handle!.stop();
    expect(instance!.stop).toHaveBeenCalledTimes(1);
  });
});
