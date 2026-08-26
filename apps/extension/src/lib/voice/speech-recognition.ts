import { toSpeechLang } from '../tts';

// Thin wrapper over the Web Speech API's SpeechRecognition — turns a spoken
// answer into text for the review card's input, so answering by voice
// (Ctrl/Cmd+Shift+V) feeds the exact same typed-answer flow as the
// keyboard, just with the box pre-filled instead of auto-submitted: a
// misheard word is still editable before it's graded.
//
// Only ever runs from the on-page review overlay (a content script), so the
// mic permission prompt is attributed to whatever SITE the overlay happens
// to be showing on top of, not to the extension itself — Chrome has no
// stable "ask once, works everywhere" option for a content script. That's
// a real rough edge (first use on each new site re-prompts), not a bug.

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const g = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof globalThis !== 'undefined' && !!getRecognitionCtor();
}

export interface VoiceListenHandle {
  /** Stops listening early. A no-op if it already ended on its own
   *  (silence/result/error) — onEnd always fires exactly once either way. */
  stop(): void;
}

export interface VoiceListenCallbacks {
  /** The best-guess transcript of what was said. Fired at most once per
   *  listen() call — this app takes only the top alternative, on the
   *  theory that a wrong guess is easier to notice and fix by hand than a
   *  list of alternatives is to pick from mid-review. */
  onResult: (transcript: string) => void;
  /** A raw SpeechRecognitionErrorEvent['error'] code (e.g. 'not-allowed',
   *  'no-speech', 'network') — the caller maps these to user-facing copy. */
  onError: (code: string) => void;
  /** Always fires exactly once, whether listening ended via a result, an
   *  error, silence timeout, or an explicit stop() — the one place to reset
   *  "listening" UI state without duplicating that reset at every call site. */
  onEnd: () => void;
}

/** Starts one listening turn in `langCode` (this app's 2-letter code,
 *  mapped to a BCP-47 tag the same way speak() does). Returns null (and
 *  fires onError synchronously) if the browser doesn't support speech
 *  recognition at all, so callers can skip rendering a handle to stop. */
export function listen(langCode: string, callbacks: VoiceListenCallbacks): VoiceListenHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    callbacks.onError('not-supported');
    return null;
  }

  const recognition = new Ctor();
  recognition.lang = toSpeechLang(langCode);
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let ended = false;
  const endOnce = () => {
    if (ended) return;
    ended = true;
    callbacks.onEnd();
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript ?? '';
    callbacks.onResult(transcript.trim());
  };
  recognition.onerror = (event) => {
    callbacks.onError(event.error);
  };
  recognition.onend = endOnce;

  recognition.start();
  return { stop: () => recognition.stop() };
}
