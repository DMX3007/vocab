// One-off generator for the toolbar icon assets (active + paused, at each
// manifest size), written to ../public/icon/. Run manually with
// `node scripts/generate-icons.mjs` whenever the brand mark design
// changes — not part of the build. Requires `playwright` installed at the
// repo root (not a dependency; see the project's landing-page workflow
// for the same install-then-remove pattern). Lives outside public/ so the
// generator script itself never ships in the built extension.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];

// Mirrors the .brand-mark styling in src/components/popup.css: a dark
// rounded square with a cream serif-italic "V". The paused variant swaps
// in a desaturated ground and a small solid pause-bars badge, so it reads
// as "off" even at 16px where a subtler cue (opacity, outline) disappears.
function svg(state, size) {
  const bg = state === 'paused' ? '#4a473f' : '#161310';
  const fg = '#F2EEE4';
  const vOpacity = state === 'paused' ? 0.55 : 1;
  const badge = state === 'paused' ? `
    <circle cx="82" cy="82" r="30" fill="#D9A441" stroke="#161310" stroke-width="4"/>
    <rect x="72" y="70" width="7" height="24" rx="2" fill="#161310"/>
    <rect x="85" y="70" width="7" height="24" rx="2" fill="#161310"/>
  ` : '';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
      <rect x="4" y="4" width="120" height="120" rx="28" fill="${bg}"/>
      <text x="64" y="90" font-family="Georgia, 'Iowan Old Style', 'Times New Roman', serif"
            font-style="italic" font-size="84" fill="${fg}" fill-opacity="${vOpacity}"
            text-anchor="middle">V</text>
      ${badge}
    </svg>
  `;
}

function page(state, size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;}
    svg{display:block;}
  </style></head><body>${svg(state, size)}</body></html>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const state of ['active', 'paused']) {
  for (const size of SIZES) {
    const page_ = await browser.newPage({ viewport: { width: size, height: size } });
    await page_.setContent(page(state, size));
    const el = await page_.$('svg');
    const buf = await el.screenshot({ omitBackground: true });
    const name = state === 'active' ? `icon-${size}.png` : `icon-${size}-paused.png`;
    writeFileSync(join(outDir, name), buf);
    console.log('wrote', name);
    await page_.close();
  }
}
await browser.close();
