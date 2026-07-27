import React from 'react';

// Small inline SVG icon set — stroke-based, 16px viewBox. Ported from the
// approved redesign; trimmed to the icons this app actually uses.
const PATHS: Record<string, React.ReactNode> = {
  plus: <><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>,
  close: <><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></>,
  search: <><circle cx="7" cy="7" r="4.2" /><line x1="10.2" y1="10.2" x2="13" y2="13" /></>,
  trash: <><path d="M3 5h10 M5 5v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5 M6 5V3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5V5" /></>,
  sparkle: <path d="M8 2L9 6.5 13.5 8 9 9.5 8 14 7 9.5 2.5 8 7 6.5z" fill="currentColor" stroke="none" />,
  flame: <path d="M8 14.5c-3 0-5-2-5-5 0-2 1.5-3.5 2-5 .3 1 .8 1.5 1.5 1.5C7 6 7 4 6 1.5 9 3 12 5.5 12 9c0 3.5-1.5 5.5-4 5.5z" fill="currentColor" stroke="none" />,
  check: <polyline points="3,8.5 7,12 13,4.5" />,
  download: <><path d="M8 2v9 M4 8l4 4 4-4 M3 14h10" /></>,
  paste: <><rect x="3.5" y="4" width="9" height="10" rx="1" /><path d="M6 4V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V4" /></>,
  help: <><circle cx="8" cy="8" r="6.5" /><path d="M6 6.5c0-1.1.9-2 2-2s2 .9 2 2-1 1.5-2 2.2v.6" /><circle cx="8" cy="11.5" r=".6" fill="currentColor" /></>,
  sheet: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><line x1="2.5" y1="7.5" x2="13.5" y2="7.5" /><line x1="7.5" y1="2.5" x2="7.5" y2="13.5" /></>,
};

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: keyof typeof PATHS;
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
