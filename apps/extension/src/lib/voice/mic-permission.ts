// Why this file exists: Chrome will NOT show a microphone permission prompt
// inside the toolbar action popup. getUserMedia (and therefore
// SpeechRecognition) is rejected there outright — no bubble, nothing for the
// user to click, just a `not-allowed` error. That's not a bug in this
// extension: a permission bubble can't be anchored to a surface that closes
// the moment it loses focus.
//
// The documented way around it is to ask from an extension page opened as a
// real TAB. The grant is stored against the chrome-extension:// origin, so
// once it's given, every extension page — the popup included — can use the
// mic with no further prompting, on every site and forever.
//
// The on-page review overlay never needed this: it's a content script, so its
// mic prompt is attributed to whatever SITE it's drawn on top of and Chrome
// shows it there normally. That difference is exactly why voice worked in the
// review card and not in the popup's demo pane.

/** The extension page that asks for the mic. Opened in a tab, never in the
 *  popup — see this file's header for why that distinction is the whole
 *  point. Resolved through browser.runtime.getURL() at the call site. */
export const MIC_PERMISSION_PAGE = 'mic-permission.html';

/** What a SpeechRecognitionErrorEvent code means for the user, reduced to
 *  the only distinctions this app acts on differently. */
export type VoiceErrorKind =
  /** The browser has no SpeechRecognition at all. Nothing to offer. */
  | 'unsupported'
  /** Mic access is blocked — the one case with an actionable fix (open the
   *  permission page), so it must never be collapsed into a generic error. */
  | 'denied'
  /** Heard nothing / didn't understand. Normal, retryable, not a failure. */
  | 'no-speech'
  /** We stopped it on purpose (or the user did). Show nothing at all —
   *  an "error" here would blame the user for clicking the button. */
  | 'none'
  | 'other';

export function classifyVoiceError(code: string): VoiceErrorKind {
  switch (code) {
    case 'not-supported':
      return 'unsupported';
    // service-not-allowed is Chrome's code when the mic is blocked by policy
    // or by an unprompted extension origin — same fix as a plain denial.
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
    case 'audio-capture':
      return 'no-speech';
    case 'aborted':
      return 'none';
    default:
      return 'other';
  }
}

/** Reads the mic permission WITHOUT prompting, so the UI can hide the
 *  "allow microphone" prompt for users who already granted it.
 *
 *  Returns 'unknown' rather than throwing anywhere the Permissions API is
 *  missing or doesn't recognise the 'microphone' name (Firefox, older
 *  builds) — callers must treat 'unknown' as "just try it and see", never as
 *  a denial, or voice would be disabled on browsers where it works fine. */
export async function readMicPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!permissions) return 'unknown';
    const status = await permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}
