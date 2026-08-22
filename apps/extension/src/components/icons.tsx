import React from 'react';

// A shadow-DOM host (Tooltip/ReviewCard, see tooltip.css) resets `*` with
// `all: revert` so an untethered host page's CSS can't leak in. Chromium
// treats a <path>'s `d` as a real CSS property (from the SVG Motion Path
// spec) alongside fill/stroke — so that reset wipes its geometry back to
// `d: none` too, leaving a perfectly styled but INVISIBLE path, since a
// plain `d="..."` attribute is only a presentation attribute (lower
// priority than any stylesheet rule, revert included). This helper sets
// the same data as an inline style too, which nothing in a stylesheet can
// out-rank, so every <path> below survives that reset regardless of which
// surface — shadow-DOM or the plain popup document — ends up hosting it.
function P(d: string, extra?: React.CSSProperties) {
  return <path d={d} style={{ d: `path("${d}")`, ...extra }} />;
}

// Small inline SVG icon set — stroke-based, 16px viewBox. Ported from the
// approved redesign; trimmed to the icons this app actually uses.
const PATHS: Record<string, React.ReactNode> = {
  plus: <><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>,
  close: <><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></>,
  search: <><circle cx="7" cy="7" r="4.2" /><line x1="10.2" y1="10.2" x2="13" y2="13" /></>,
  trash: <>{P('M3 5h10 M5 5v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5 M6 5V3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5V5')}</>,
  sparkle: P('M8 2L9 6.5 13.5 8 9 9.5 8 14 7 9.5 2.5 8 7 6.5z', { fill: 'currentColor', stroke: 'none' }),
  flame: P('M8 14.5c-3 0-5-2-5-5 0-2 1.5-3.5 2-5 .3 1 .8 1.5 1.5 1.5C7 6 7 4 6 1.5 9 3 12 5.5 12 9c0 3.5-1.5 5.5-4 5.5z', { fill: 'currentColor', stroke: 'none' }),
  check: <polyline points="3,8.5 7,12 13,4.5" />,
  download: <>{P('M8 2v9 M4 8l4 4 4-4 M3 14h10')}</>,
  paste: <><rect x="3.5" y="4" width="9" height="10" rx="1" />{P('M6 4V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V4')}</>,
  help: <><circle cx="8" cy="8" r="6.5" />{P('M6 6.5c0-1.1.9-2 2-2s2 .9 2 2-1 1.5-2 2.2v.6')}<circle cx="8" cy="11.5" r=".6" style={{ fill: 'currentColor' }} /></>,
  sheet: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><line x1="2.5" y1="7.5" x2="13.5" y2="7.5" /><line x1="7.5" y1="2.5" x2="7.5" y2="13.5" /></>,
  volume: <>{P('M2.5 6.5v3h2.3L8 12.2V3.8L4.8 6.5z', { fill: 'currentColor', stroke: 'none' })}{P('M10.3 6c.7.5 1.2 1.3 1.2 2.2s-.5 1.7-1.2 2.2')}{P('M11.8 4.2c1.3.9 2.2 2.4 2.2 4.1s-.9 3.2-2.2 4.1')}</>,
  moon: P('M10.5 2.2c-3.6.6-6.2 3.7-6.2 7.4 0 4.1 3.4 7.5 7.5 7.5 2 0 3.9-.8 5.3-2.1-.6.1-1.2.2-1.8.2-4.1 0-7.5-3.4-7.5-7.5 0-1.9.7-3.7 1.9-5.1-.4-.2-.8-.3-1.2-.4z', { fill: 'currentColor', stroke: 'none' }),
  sun: <>
    <circle cx="8" cy="8" r="2.6" />
    <line x1="8" y1="1.5" x2="8" y2="3.2" />
    <line x1="8" y1="12.8" x2="8" y2="14.5" />
    <line x1="1.5" y1="8" x2="3.2" y2="8" />
    <line x1="12.8" y1="8" x2="14.5" y2="8" />
    <line x1="3.3" y1="3.3" x2="4.5" y2="4.5" />
    <line x1="11.5" y1="11.5" x2="12.7" y2="12.7" />
    <line x1="3.3" y1="12.7" x2="4.5" y2="11.5" />
    <line x1="11.5" y1="4.5" x2="12.7" y2="3.3" />
  </>,
  shuffle: <>
    <polyline points="10.7,2 14,2 14,5.3" />
    <line x1="2.7" y1="13.3" x2="14" y2="2" />
    <polyline points="14,10.7 14,14 10.7,14" />
    <line x1="10" y1="10" x2="14" y2="14" />
    <line x1="2.7" y1="2.7" x2="6" y2="6" />
  </>,
};

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: keyof typeof PATHS;
  size?: number;
}

export function Icon({ name, size = 16, style, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      // Inline style, not attributes: a shadow-DOM host (Tooltip/ReviewCard)
      // resets `*` with `all: revert` so untethered host CSS can't leak in
      // (see tooltip.css). That reset also wins over plain SVG presentation
      // attributes like fill="none", silently turning every icon into a
      // solid black blob — inline style is the one thing with higher
      // priority than any stylesheet rule, so it survives that reset.
      style={{
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        ...style,
      }}
      {...rest}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
