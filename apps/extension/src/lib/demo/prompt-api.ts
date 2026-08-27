// ─────────────────────────────────────────────────────────────────
// DEMO MODE — experimental, self-contained, safe to delete.
//
// Everything under src/lib/demo/ plus components/DemoPane.tsx is an
// isolated experiment. Removing the feature means: delete this folder,
// delete DemoPane.tsx, drop `demoModeEnabled` from OverlaySettings, and
// remove the two one-line guards that read it (overlay-policy.ts's
// decideOverlay and content.ts's pollForBurstDrill). Nothing else in the
// extension imports from here.
// ─────────────────────────────────────────────────────────────────
//
// Thin wrapper over Chrome's built-in on-device model (Gemini Nano) via
// the Prompt API. Runs entirely on the user's machine: no API key, no
// network call, no cost, and nothing typed here ever leaves the device.
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

export interface DemoSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}

interface CreateOptions {
  /** Called with 0..1 while the one-time model download runs. */
  onDownloadProgress?: (loaded: number) => void;
}

/** The two shapes this API has shipped under. Kept structural (not a hard
 *  reference to a global type) so the extension still compiles and runs in
 *  browsers that have neither. */
interface LanguageModelLike {
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
  create: (options?: Record<string, unknown>) => Promise<DemoSession>;
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
): Promise<DemoSession> {
  const api = getApi();
  if (!api) throw new Error('Chrome built-in AI is not available in this browser.');

  return api.create({
    initialPrompts: [{ role: 'system', content: systemPrompt }],
    // The spec's download hook. Older builds ignore an unknown `monitor`
    // key rather than throwing, so passing it unconditionally is safe.
    monitor(m: { addEventListener: (type: string, cb: (e: { loaded: number }) => void) => void }) {
      m.addEventListener('downloadprogress', (e) => options.onDownloadProgress?.(e.loaded));
    },
  });
}
