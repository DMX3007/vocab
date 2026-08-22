import { randomBytes } from 'node:crypto';

// Crockford-ish alphabet with ambiguous characters (0/O, 1/I/L) dropped —
// a license key gets read aloud, retyped from an email, pasted from a
// screenshot; every character it can't afford to be confused for another.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** VF-XXXX-XXXX-XXXX-XXXX — matches the placeholder already shown in the
 *  extension's license input (apps/extension PlanPane.tsx). Opaque and
 *  random, not signed/encoded: validity is a live lookup against
 *  LicenseStore, not something the extension checks offline, so there's
 *  nothing to gain from embedding data in the key itself. */
export function generateLicenseKey(): string {
  const bytes = randomBytes(16);
  let chars = '';
  for (const byte of bytes) chars += ALPHABET[byte % ALPHABET.length];
  const groups = [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)];
  return `VF-${groups.join('-')}`;
}
