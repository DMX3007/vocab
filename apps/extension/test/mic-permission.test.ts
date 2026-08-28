import { describe, it, expect } from 'vitest';
import { classifyVoiceError, MIC_PERMISSION_PAGE } from '../src/lib/voice/mic-permission';

describe('classifyVoiceError', () => {
  it('treats both Chrome denial codes as denied', () => {
    // 'service-not-allowed' is what Chrome reports for an extension page that
    // has never been granted the mic — the exact case the permission page
    // exists to fix. Collapsing it into the generic bucket would hide the
    // only actionable error this feature has.
    expect(classifyVoiceError('not-allowed')).toBe('denied');
    expect(classifyVoiceError('service-not-allowed')).toBe('denied');
  });

  it('reports a missing API separately from a denial', () => {
    // Different copy, different affordance: nothing to grant on a browser
    // with no SpeechRecognition at all.
    expect(classifyVoiceError('not-supported')).toBe('unsupported');
  });

  it('treats silence as retryable, not as a failure', () => {
    expect(classifyVoiceError('no-speech')).toBe('no-speech');
    expect(classifyVoiceError('audio-capture')).toBe('no-speech');
  });

  it('shows nothing when the user stopped it themselves', () => {
    // 'aborted' is what our own stop() produces. Surfacing an error there
    // would blame the user for clicking the button they just clicked.
    expect(classifyVoiceError('aborted')).toBe('none');
  });

  it('falls back to a generic error for anything unrecognised', () => {
    expect(classifyVoiceError('network')).toBe('other');
    expect(classifyVoiceError('')).toBe('other');
    expect(classifyVoiceError('some-future-code')).toBe('other');
  });
});

describe('MIC_PERMISSION_PAGE', () => {
  it('names a real built entrypoint, not a path', () => {
    // WXT emits entrypoints/mic-permission/index.html as mic-permission.html
    // at the extension root; the leading slash is added at the call site by
    // runtime.getURL, so a slash here would produce a double one.
    expect(MIC_PERMISSION_PAGE).toBe('mic-permission.html');
    expect(MIC_PERMISSION_PAGE.startsWith('/')).toBe(false);
  });
});
