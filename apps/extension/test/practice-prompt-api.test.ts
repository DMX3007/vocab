import { describe, it, expect } from 'vitest';
import { MODEL_OUTPUT_LANGUAGES, modelCanWrite } from '../src/lib/practice/prompt-api';

describe('modelCanWrite', () => {
  it('accepts every language the built-in model attests to', () => {
    for (const code of MODEL_OUTPUT_LANGUAGES) expect(modelCanWrite(code)).toBe(true);
  });

  it('rejects app target languages the model does not support', () => {
    // These are all offered as target languages by this app but are outside
    // Chrome's attested output set — the drill must not ask for them.
    for (const code of ['ru', 'it', 'pt', 'zh']) expect(modelCanWrite(code)).toBe(false);
  });

  it('rejects an unknown code rather than throwing', () => {
    expect(modelCanWrite('xx')).toBe(false);
  });
});
