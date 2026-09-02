// ─────────────────────────────────────────────────────────────────
// PRACTICE MODE — self-contained, still removable.
//
// Everything under src/lib/practice/ plus components/PracticeCard.tsx and
// PracticeOverlay.tsx. Removing the feature means: delete this folder and
// those two components, drop the PRACTICE_* entries from the messaging
// protocol and their handlers in background.ts, drop showPractice() and the
// SHOW_PRACTICE case in content.ts, and remove the Practice button from
// ReviewPane. Nothing else imports from here.
//
// Two things this mode ADDED but does not own, so leave them in place:
// lib/voice/mic-permission.ts and the entrypoints/mic-permission/ page.
// They fix a real Chrome limitation for any extension-page voice input.
// ─────────────────────────────────────────────────────────────────
//
// Thin wrapper over Chrome's built-in on-device model (Gemini Nano) via
// the Prompt API. Runs entirely on the user's machine: no API key, no
// network call, no cost, and nothing typed here ever leaves the device.
//
// WHERE THIS RUNS: the background service worker, and only there. The
// Prompt API is exposed to EXTENSION contexts (service worker, extension
// pages) — a content script runs in the page's isolated world and has no
// LanguageModel global at all, so the on-page Practice card can't call this
// directly and goes through PRACTICE_GENERATE messaging instead.
//
// The API has moved around a lot (window.ai.assistant -> window.ai
// .languageModel -> a global LanguageModel), and availability is gated on
// desktop-only + hardware + a multi-GB one-time model download. So this
// probes several shapes defensively and reports WHY it's unavailable
// rather than just failing — the UI shows that reason to the user.

/** Mirrors the spec's availability states. 'unsupported' is ours: the API
 *  surface isn't present at all (wrong browser/version/platform), which is
 *  different from present-but-no-model-downloaded ('downloadable'). */
export type ModelAvailability =
  | 'unsupported'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

export interface PracticeSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}

/** The output languages Chrome's built-in model actually attests to. The
 *  API logs a warning ("No output language was specified...") and gives
 *  weaker output when you don't declare one, and anything outside this set
 *  isn't supported at all — notably Russian, Italian, Portuguese and
 *  Chinese, all of which this app otherwise offers as target languages.
 *  drill.ts uses this to avoid ever ASKING the model for a language it
 *  can't write. */
export const MODEL_OUTPUT_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'] as const;

export function modelCanWrite(langCode: string): boolean {
  return (MODEL_OUTPUT_LANGUAGES as readonly string[]).includes(langCode);
}

interface CreateOptions {
  /** Called with 0..1 while the one-time model download runs. */
  onDownloadProgress?: (loaded: number) => void;
  /** Languages the session is allowed to produce. Declaring these is what
   *  silences Chrome's "no output language was specified" warning and lets
   *  it attest output safety; every entry must be in MODEL_OUTPUT_LANGUAGES. */
  outputLanguages?: string[];
}

/** The two shapes this API has shipped under. Kept structural (not a hard
 *  reference to a global type) so the extension still compiles and runs in
 *  browsers that have neither. */
interface LanguageModelLike {
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
  create: (options?: Record<string, unknown>) => Promise<PracticeSession>;
}

function getApi(): LanguageModelLike | null {
  const g = globalThis as unknown as {
    LanguageModel?: LanguageModelLike;
    ai?: { languageModel?: LanguageModelLike };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

export function isPromptApiPresent(): boolean {
  return getApi() !== null;
}

/** Normalizes both the current availability() strings and the older
 *  capabilities().available ones ('readily' / 'after-download' / 'no'). */
function normalize(raw: string | undefined): ModelAvailability {
  switch (raw) {
    case 'available':
    case 'readily':
      return 'available';
    case 'downloadable':
    case 'after-download':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    default:
      return 'unavailable';
  }
}

export async function checkAvailability(): Promise<ModelAvailability> {
  const api = getApi();
  if (!api) return 'unsupported';
  try {
    if (api.availability) return normalize(await api.availability());
    if (api.capabilities) return normalize((await api.capabilities()).available);
    return 'unavailable';
  } catch {
    // A present-but-throwing API (permission missing, flag off) is still
    // "can't use it" from here — the UI's guidance covers both.
    return 'unavailable';
  }
}

/** Opens a session, kicking off the one-time model download if needed.
 *  Throws if the model can't be created — callers surface that message. */
export async function createSession(
  systemPrompt: string,
  options: CreateOptions = {},
): Promise<PracticeSession> {
  const api = getApi();
  if (!api) throw new Error('Chrome built-in AI is not available in this browser.');

  const outputLanguages = options.outputLanguages?.filter(modelCanWrite) ?? [];
  return api.create({
    initialPrompts: [{ role: 'system', content: systemPrompt }],
    // Declared per the Prompt API's language attestation. Falls back to
    // English rather than omitting the field, since omitting it is exactly
    // what triggers the warning.
    expectedOutputs: [{ type: 'text', languages: outputLanguages.length > 0 ? outputLanguages : ['en'] }],
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    // The spec's download hook. Older builds ignore an unknown `monitor`
    // key rather than throwing, so passing it unconditionally is safe.
    monitor(m: { addEventListener: (type: string, cb: (e: { loaded: number }) => void) => void }) {
      m.addEventListener('downloadprogress', (e) => options.onDownloadProgress?.(e.loaded));
    },
  });
}
