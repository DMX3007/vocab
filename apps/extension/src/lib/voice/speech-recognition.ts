import { toSpeechLang } from '../tts';

// Thin wrapper over the Web Speech API's SpeechRecognition — turns a spoken
// answer into text for the review card's input, so answering by voice
// (Ctrl/Cmd+Shift+V) feeds the exact same typed-answer flow as the
// keyboard, just with the box pre-filled instead of auto-submitted: a
// misheard word is still editable before it's graded.
//
// Runs from two very different surfaces, and the mic permission behaves
// differently in each — see mic-permission.ts for the full story:
//   • the on-page review overlay (a content script): the prompt is attributed
//     to whatever SITE the overlay is drawn on, so first use on each new site
//     re-prompts. A rough edge, not a bug.
//   • the popup's demo pane (an extension page): Chrome will NOT prompt there
//     at all, and reports 'not-allowed' until the permission has been granted
//     once from an extension page opened in a real tab.

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
    // onEnd fires here too, per its contract below: callers flip their
    // "listening" flag on BEFORE calling listen(), and only onEnd flips it
    // back — skipping it would leave the mic button lit forever.
    callbacks.onEnd();
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

  // start() throws synchronously (InvalidStateError) if a turn is somehow
  // already running. Reported through the SAME callbacks as any other
  // failure rather than propagating: a throw out of here would escape a
  // click handler and strand the caller's "listening" flag on forever, with
  // the mic button stuck lit and unclickable.
  try {
    recognition.start();
  } catch {
    callbacks.onError('start-failed');
    endOnce();
    return null;
  }
  return { stop: () => recognition.stop() };
}
