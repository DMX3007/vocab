import React, { useEffect, useState } from 'react';

interface Props {
  /** Filename stem under /achievements/ — e.g. "scholar-bronze" or "first-word". */
  iconKey: string;
  /** Shown instead of (until) the PNG at /achievements/{iconKey}.png exists. */
  glyph: string;
  locked?: boolean;
  size?: number;
}

// PNG icons are dropped by hand into apps/extension/public/achievements/
// (see progress.ts's ACHIEVEMENT_TRACKS comment for the filename
// convention) — until one exists for a given key, onError below falls back
// to the plain-text glyph so the tab never shows a broken image.
export function AchievementBadge({ iconKey, glyph, locked, size = 34 }: Props) {
  const [broken, setBroken] = useState(false);
  // A tier unlocking mid-session swaps which icon this slot should show —
  // give the new key's PNG a fresh chance rather than staying stuck on a
  // previous key's fallback.
  useEffect(() => setBroken(false), [iconKey]);

  const className = `ach-badge ${locked ? 'locked' : ''}`;
  if (broken) {
    return (
      <span className={className} style={{ width: size, height: size, fontSize: size * 0.6 }}>
        {glyph}
      </span>
    );
  }
  return (
    <img
      className={className}
      // browser.runtime.getURL, not a bare root-relative path: this renders
      // both inside the popup document (chrome-extension://...) AND inside a
      // content script's shadow DOM injected into an arbitrary webpage — a
      // plain "/achievements/x.png" there would resolve against the HOST
      // PAGE's origin instead of the extension's, and 404.
      src={browser.runtime.getURL('/') + `achievements/${iconKey}.png`}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
    />
  );
}
