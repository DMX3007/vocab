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

// Runs inside every page. Hosts BOTH the selection tooltip and the review
// overlay in a Shadow DOM so the host page's CSS can't break them. The logic
// (selection, session, policy, settings) is unit-tested; this file is the
// thin DOM glue, verified by the manual checklist.

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('[VocabFlow] content script loaded');
    const LANG_FROM = 'en';
    const LANG_TO = 'ru';
    const settingsStore = new SettingsStore(browser.storage.local);

    // ── shared shadow-DOM host ─────────────────────────────────
    let host: HTMLDivElement | null = null;
    let root: Root | null = null;

    function mount(node: React.ReactElement, fixed: boolean, x = 0, y = 0) {
      unmount();
      host = document.createElement('div');
      host.style.cssText = fixed
        ? 'position:fixed;inset:0;z-index:2147483647;'
        : `position:absolute;z-index:2147483647;left:${x}px;top:${y}px;`;
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = tooltipCss;
      shadow.appendChild(style);
      const slot = document.createElement('div');
      shadow.appendChild(slot);
      root = createRoot(slot);
      root.render(node);
    }

    function unmount() {
      root?.unmount();
      host?.remove();
      root = null;
      host = null;
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
        false, x, y,
      );
    }

    document.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
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
      showTooltip(analyzed.term, analyzed.contextSentence,
        window.scrollX + rect.left, window.scrollY + rect.bottom + 8);
    });

    document.addEventListener('mousedown', (e) => {
      // don't dismiss the modal overlay by clicking the backdrop
      if (host && host.style.position === 'absolute' && !e.composedPath().includes(host)) unmount();
    });

    // ── review overlay ─────────────────────────────────────────
    async function showOverlay() {
      const session = new ReviewSession(wordClient, { mode: 'normal' });
      await session.start(LANG_TO, new Date());
      if (session.total === 0) return; // nothing due after all

      const host = location.hostname;
      mount(
        React.createElement(ReviewOverlay, {
          session, host,
          onClose: unmount,
          onSnooze: async () => { await settingsStore.update((s) => snooze(s, new Date())); unmount(); },
          onPause: async (preset: PausePreset) => {
            await settingsStore.update((s) => pauseFor(s, new Date(), preset)); unmount();
          },
          onDisableSite: async () => {
            await settingsStore.update((s) => addToBlacklist(s, host)); unmount();
          },
        }),
        true,
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
      if (pausedOrSnoozed && host?.style.position === 'fixed') unmount();
    });
  },
});
