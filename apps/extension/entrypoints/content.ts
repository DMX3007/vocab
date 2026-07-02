import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tooltip } from '../src/components/Tooltip';
import { ReviewOverlay } from '../src/components/ReviewOverlay';
import tooltipCss from '../src/components/tooltip.css?inline';
import { analyzeSelection } from '../src/lib/selection';
import { wordClient } from '../src/lib/messaging/client';
import { ReviewSession } from '../src/lib/review/session';
import { SettingsStore } from '../src/lib/review/settings-store';
import { snooze, pauseFor, addToBlacklist, type PausePreset } from '../src/lib/review/overlay-policy';
import type { SavePayload } from '../src/lib/tooltip-machine';
import { ContentCommand } from '@/src/lib/messaging/protocol';
import TooltipIcon from '@/src/components/TooltipIcon';

// Runs inside every page. Hosts BOTH the selection tooltip and the review
// overlay in a Shadow DOM so the host page's CSS can't break them. The logic
// (selection, session, policy, settings) is unit-tested; this file is the
// thin DOM glue, verified by the manual checklist.

type ComponentPlacements = | { kind: 'icon' | 'tooltip'; x: number; y: number; } | { kind: 'overlay'; };

type Surface = { host: HTMLDivElement; root: Root; component: ComponentPlacements };
let currentSurface: Surface | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const LANG_FROM = 'en';
    const LANG_TO = 'ru';
    const settingsStore = new SettingsStore(browser.storage.local)

    function mount(node: React.ReactElement, component: ComponentPlacements) {
      unmount();
      let host = document.createElement('div');

      host.style.cssText = component.kind !== 'overlay'
        ? `position:absolute;z-index:2147483647;left:${component.x}px;top:${component.y}px;`
        : 'position:fixed;inset:0;z-index:2147483647;';

      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = tooltipCss;
      shadow.appendChild(style);
      const slot = document.createElement('div');
      shadow.appendChild(slot);
      const root = createRoot(slot);
      root.render(node);
      currentSurface = { host, root, component };
    }

    function unmount() {
      currentSurface?.root.unmount();
      currentSurface?.host.remove();
      currentSurface = null;
    }

    function showTooltipIcon(term: string, contextSentence: string, x: number, y: number) {
      mount(React.createElement(TooltipIcon, {
        onClick: () => showTooltip(term, contextSentence, x, y)
      }), { kind: 'icon', x, y });
    }

    // ── selection tooltip ──────────────────────────────────────
    function showTooltip(term: string, contextSentence: string, x: number, y: number) {
      const onSave = (payload: SavePayload) => {
        void wordClient.saveWord({
          term: payload.term, translation: payload.translation,
          contextSentence: payload.contextSentence, sourceUrl: payload.sourceUrl,
          langFrom: LANG_FROM, langTo: LANG_TO,
        });
        unmount();
      };
      mount(
        React.createElement(Tooltip, {
          term, contextSentence, sourceUrl: location.href,
          langFrom: LANG_FROM, langTo: LANG_TO, onSave, onDismiss: unmount,
        }),
        { kind: 'tooltip', x, y }
      );
    }

    document.addEventListener('mouseup', (e) => {
      if (currentSurface && e.composedPath().includes(currentSurface.host)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        return
      };
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
        (active as HTMLElement).isContentEditable)) return;
      const text = selection.toString();
      const container = selection.anchorNode?.textContent ?? text;
      const start = container.indexOf(text);
      const analyzed = start >= 0
        ? analyzeSelection(container, start, start + text.length)
        : analyzeSelection(text, 0, text.length);
      if (!analyzed) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      showTooltipIcon(analyzed.term, analyzed.contextSentence, window.scrollX + rect.left, window.scrollY + rect.bottom + 8);
    });

    let flag: boolean = false

    document.addEventListener('selectionchange', () => {
      if (currentSurface?.component.kind !== 'icon') {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        unmount()
      }
    })

    document.addEventListener('mousedown', (e) => {
      flag = currentSurface !== null && currentSurface.component.kind === 'tooltip' && !e.composedPath().includes(currentSurface.host)
    });

    document.addEventListener('click', () => {
      if (flag) {
        unmount();
        flag = false;
      }
    })

    // ── review overlay ─────────────────────────────────────────
    async function showOverlay() {
      const session = new ReviewSession(wordClient, { mode: 'normal' });
      await session.start(LANG_TO, new Date());
      if (session.total === 0) return; // nothing due after all

      const hostname = location.hostname;
      mount(
        React.createElement(ReviewOverlay, {
          session, host: hostname,
          onClose: unmount,
          onSnooze: async () => { await settingsStore.update((s) => snooze(s, new Date())); unmount(); },
          onPause: async (preset: PausePreset) => {
            await settingsStore.update((s) => pauseFor(s, new Date(), preset)); unmount();
          },
          onDisableSite: async () => {
            await settingsStore.update((s) => addToBlacklist(s, hostname)); unmount();
          },
        }),
        { kind: 'overlay' },
      );
    }


    // ── messages from the background ───────────────────────────
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const message = msg as ContentCommand
      if (message?.type === 'GET_PAGE_CONTEXT') {
        const active = document.activeElement;
        const userIsTyping = !!active && (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable);
        sendResponse({ userIsTyping, isFullscreen: !!document.fullscreenElement });
        return true;
      }
      if (message?.type === 'SHOW_OVERLAY') {
        void showOverlay();
      }
      return true;  // WXT 0.19 types require every path to return true
    });

    // ── cross-tab sync: if settings change (pause on another tab), close ──
    settingsStore.subscribe((s) => {
      const pausedOrSnoozed =
        (s.pausedUntil && new Date(s.pausedUntil) > new Date()) ||
        (s.snoozedUntil && new Date(s.snoozedUntil) > new Date());
      if (pausedOrSnoozed && currentSurface?.component.kind === 'overlay') unmount();
    });
  },
});
