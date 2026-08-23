import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tooltip } from '../src/components/Tooltip';
import { ReviewOverlay } from '../src/components/ReviewOverlay';
import { StreakReminder } from '../src/components/StreakReminder';
import tooltipCss from '../src/components/tooltip.css?inline';
import { analyzeSelection } from '../src/lib/selection';
import { wordClient } from '../src/lib/messaging/client';
import { ReviewSession } from '../src/lib/review/session';
import { SettingsStore } from '../src/lib/review/settings-store';
import { snooze, pauseFor, addToBlacklist, isBlacklisted, isPausedOrSnoozed, type PausePreset } from '../src/lib/review/overlay-policy';
import type { SavePayload } from '../src/lib/tooltip-machine';
import { ContentCommand } from '@/src/lib/messaging/protocol';
import { isBurstWord, type AlgoFilter } from '../src/lib/review/library';
import TooltipIcon from '@/src/components/TooltipIcon';
import SkippedChip from '@/src/components/SkippedChip';
import { DEFAULT_TARGET_LANG } from '../src/lib/languages';
import { I18nProvider } from '../src/lib/i18n';

// Runs inside every page. Hosts BOTH the selection tooltip and the review
// overlay in a Shadow DOM so the host page's CSS can't break them. The logic
// (selection, session, policy, settings) is unit-tested; this file is the
// thin DOM glue, verified by the manual checklist.

type ComponentPlacements =
  | { kind: 'icon' | 'tooltip' | 'skipped'; x: number; y: number; }
  | { kind: 'overlay'; }
  | { kind: 'streak'; };

type Surface = { host: HTMLDivElement; root: Root; component: ComponentPlacements };

let currentSurface: Surface | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const LANG_FROM = 'en';
    // The active target language; loaded from settings and kept live via
    // subscribe() so a change made in the popup (or another tab) applies
    // immediately without a page reload.
    let targetLang = DEFAULT_TARGET_LANG;
    const settingsStore = new SettingsStore(browser.storage.local)
    void settingsStore.load().then((s) => { targetLang = s.targetLang; });

    function mount(node: React.ReactElement, component: ComponentPlacements) {
      unmount();
      let host = document.createElement('div');

      host.style.cssText = component.kind === 'overlay'
        ? 'position:fixed;inset:0;z-index:2147483647;'
        : component.kind === 'streak'
          // Covers the viewport (so the card's own fixed corner position
          // works) but never blocks the page underneath — only the card
          // itself (see .vf-streak-card's pointer-events:auto) is clickable.
          ? 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
          : `position:absolute;z-index:2147483647;left:${component.x}px;top:${component.y}px;`;

      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = tooltipCss;
      shadow.appendChild(style);
      const slot = document.createElement('div');
      shadow.appendChild(slot);
      const root = createRoot(slot);
      // Every content-script surface gets its own I18nProvider — this tree
      // is separate from the popup's (a content script can't share React
      // context across the extension/page boundary), but both read the
      // same persisted locale out of chrome.storage.local.
      root.render(React.createElement(I18nProvider, { storage: browser.storage.local, children: node }));
      currentSurface = { host, root, component };
      suppressOuterListeners(host);
    }

    function suppressOuterListeners(host: HTMLDivElement) {
      host.addEventListener('keydown', (e) => {
        e.stopPropagation();
      })
      host.addEventListener('keypress', (e) => {
        e.stopPropagation();
      })
      host.addEventListener('keyup', (e) => {
        e.stopPropagation();
      })
    }

    function unmount() {
      currentSurface?.root.unmount();
      currentSurface?.host.remove();
      currentSurface = null;
    }

    function showTooltipIcon(term: string, contextSentence: string, x: number, y: number) {
      mount(React.createElement(TooltipIcon, {
        onClick: () => showTooltip(term, contextSentence, x, y),
        onSkip: () => showSkipped(term, contextSentence, x, y),
      }), { kind: 'icon', x, y });
    }

    // ── skipped — a quiet chip the user can click to bring the trigger back ──
    function showSkipped(term: string, contextSentence: string, x: number, y: number) {
      mount(
        React.createElement(SkippedChip, { onClick: () => showTooltipIcon(term, contextSentence, x, y) }),
        { kind: 'skipped', x, y },
      );
    }

    // ── selection tooltip ──────────────────────────────────────
    function showTooltip(term: string, contextSentence: string, x: number, y: number) {
      const onSave = (payload: SavePayload) => {
        void wordClient.saveWord({
          term: payload.term, translation: payload.translation,
          contextSentence: payload.contextSentence, sourceUrl: payload.sourceUrl,
          langFrom: LANG_FROM, langTo: targetLang,
        });
        unmount();
      };
      mount(
        React.createElement(Tooltip, {
          term, contextSentence, sourceUrl: location.href,
          langFrom: LANG_FROM, langTo: targetLang, onSave,
          onDismiss: () => showSkipped(term, contextSentence, x, y),
          onAutoTranslate: (t: string, from: string, to: string) => wordClient.translate(t, from, to),
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

    function getPageContext() {
      const active = document.activeElement;
      const userIsTyping = !!active && (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable);
      return { userIsTyping, isFullscreen: !!document.fullscreenElement };
    }

    // ── review overlay ─────────────────────────────────────────
    async function showOverlay(langTo: string, algoFilter?: AlgoFilter) {
      const session = new ReviewSession(wordClient, { mode: 'normal' });
      await session.start(langTo, new Date(), { algoFilter });
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
          onLookupDictionary: (wordId: string) => wordClient.lookupDictionary(wordId, new Date()),
        }),
        { kind: 'overlay' },
      );
    }

    // ── streak-at-risk reminder ────────────────────────────────
    function showStreakReminder(streak: number, todayCount: number, dailyGoal: number) {
      mount(
        React.createElement(StreakReminder, {
          streak, todayCount, dailyGoal,
          onReviewNow: () => { void showOverlay(targetLang); },
          onDismiss: unmount,
        }),
        { kind: 'streak' },
      );
    }

    // ── burst drilling: auto-reappear fast for a word already mid-drill ──
    // The normal alarm/throttle path (background.ts) checks once a minute
    // and paces itself to avoid nagging — right for a slow ambient due
    // backlog, wrong for a card that's supposed to come back in ~25s. This
    // polls locally, in-page, so it isn't bound by chrome.alarms' 1-minute
    // floor, and bypasses the throttle/hourly-cap entirely — but ONLY for
    // words the user already started drilling (isBurstWord), and still
    // respects pause/snooze/blacklist/typing/fullscreen.
    const BURST_POLL_MS = 5_000;
    let burstPollInFlight = false;

    async function pollForBurstDrill() {
      if (burstPollInFlight) return;
      if (document.hidden) return; // only the tab actually being looked at
      if (currentSurface) return; // don't interrupt an existing tooltip/overlay
      burstPollInFlight = true;
      try {
        const settings = await settingsStore.load();
        if (isPausedOrSnoozed(settings, new Date())) return;
        if (isBlacklisted(settings, location.hostname)) return;

        const { userIsTyping, isFullscreen } = getPageContext();
        if (userIsTyping || isFullscreen) return;

        const due = await wordClient.getDueWords(new Date(), settings.targetLang);
        if (!due.some(isBurstWord)) return;

        await showOverlay(settings.targetLang);
      } finally {
        burstPollInFlight = false;
      }
    }

    setInterval(() => { void pollForBurstDrill(); }, BURST_POLL_MS);

    // ── messages from the background ───────────────────────────
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const message = msg as ContentCommand
      if (message?.type === 'GET_PAGE_CONTEXT') {
        sendResponse(getPageContext());
        return true;
      }
      if (message?.type === 'SHOW_OVERLAY') {
        void showOverlay(message.langTo, message.algoFilter);
        // Acknowledge immediately — showOverlay's own await(s) shouldn't hold
        // up the sender (the popup awaits this to know a content script is
        // here before closing itself).
        sendResponse(true);
      }
      if (message?.type === 'SHOW_STREAK_REMINDER') {
        showStreakReminder(message.streak, message.todayCount, message.dailyGoal);
        sendResponse(true);
      }
      return true;  // WXT 0.19 types require every path to return true
    });

    // ── cross-tab sync: if settings change (pause on another tab), close ──
    settingsStore.subscribe((s) => {
      targetLang = s.targetLang;
      if (isPausedOrSnoozed(s, new Date()) && currentSurface?.component.kind === 'overlay') unmount();
    });
  },
});
