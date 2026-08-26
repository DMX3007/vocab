// Minimal ambient types for the Web Speech API's SpeechRecognition — not
// part of TypeScript's DOM lib. Scoped to exactly what speech-recognition.ts
// actually uses, not a full vendor of the spec.

interface SpeechRecognitionResultLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare var SpeechRecognition: { new (): SpeechRecognition } | undefined;
declare var webkitSpeechRecognition: { new (): SpeechRecognition } | undefined;
