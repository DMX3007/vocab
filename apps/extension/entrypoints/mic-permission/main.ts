// The one job of this page: be a REAL TAB that calls getUserMedia, so Chrome
// will actually render a microphone permission bubble. See
// src/lib/voice/mic-permission.ts for why the popup can't do this itself.
//
// Deliberately plain TS rather than React: it's three states and a button,
// and it's on the critical path of "voice is broken" — the less machinery
// between the user and the prompt, the better.

import { strings as en } from '../../src/lib/i18n/en';
import { strings as ru } from '../../src/lib/i18n/ru';
import { LOCALE_STORAGE_KEY, detectDefaultLocale, type Locale } from '../../src/lib/i18n';
import './mic-permission.css';

type Phase = 'idle' | 'asking' | 'granted' | 'denied';

async function loadLocale(): Promise<Locale> {
  try {
    const stored = await browser.storage.local.get(LOCALE_STORAGE_KEY);
    const value = stored[LOCALE_STORAGE_KEY];
    if (value === 'ru' || value === 'en') return value;
  } catch {
    // storage unavailable — fall through to the browser's own language
  }
  return detectDefaultLocale();
}

void (async () => {
  const locale = await loadLocale();
  const dict = locale === 'ru' ? ru : en;
  const t = (key: keyof typeof en) => dict[key] as string;

  const root = document.getElementById('root')!;
  document.title = t('mic.title');

  function render(phase: Phase) {
    root.replaceChildren();

    const card = el('div', 'mic-card');
    card.append(el('h1', 'mic-title', t('mic.title')));

    if (phase === 'granted') {
      card.append(el('p', 'mic-body mic-ok', t('mic.granted')));
      card.append(button(t('mic.close'), () => window.close()));
    } else if (phase === 'denied') {
      card.append(el('p', 'mic-body mic-bad', t('mic.denied')));
      card.append(button(t('mic.retry'), () => void ask()));
    } else {
      card.append(el('p', 'mic-body', t('mic.body')));
      const b = button(phase === 'asking' ? t('mic.asking') : t('mic.allow'), () => void ask());
      // The prompt only appears in response to a user gesture, so this
      // button is the entire mechanism — never auto-call ask() on load.
      (b as HTMLButtonElement).disabled = phase === 'asking';
      card.append(b);
    }

    card.append(el('p', 'mic-note', t('mic.note')));
    root.append(card);
  }

  async function ask() {
    render('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release the device immediately — the permission GRANT is what we
      // came for; holding the mic open would leave the recording indicator
      // on in a tab the user is about to close.
      stream.getTracks().forEach((track) => track.stop());
      render('granted');
    } catch {
      render('denied');
    }
  }

  render('idle');
})();

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void): HTMLElement {
  const node = document.createElement('button');
  node.className = 'mic-btn';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}
