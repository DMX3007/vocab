// Validates a pasted license key against the BrowseVocab API. Runs in the
// service worker (like TRANSLATE in mymemory.ts) so it isn't subject to
// whatever CSP the current tab happens to have, and stays reliable
// regardless of which site the popup was opened from.

// Point this at your deployed API before shipping to real users. Left as
// localhost so local dev and the test suite never accidentally hit a real
// server — see the licensing runbook for what else goes with a real deploy.
export const API_BASE = 'http://localhost:3000';

export interface LicenseValidation {
  valid: boolean;
  plan?: 'free' | 'premium';
  limits?: { maxWords: number | null };
}

/** Never throws on an invalid/unknown key — that's an everyday result, not
 *  an error. Throws only on an actual network/HTTP failure, same contract
 *  as translateWord. */
export async function validateLicense(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseValidation> {
  const response = await fetchImpl(`${API_BASE}/v1/licenses/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) {
    throw new Error(`License check failed: HTTP ${response.status}`);
  }
  return (await response.json()) as LicenseValidation;
}
