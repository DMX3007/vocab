import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tooltip } from '../src/components/Tooltip';
import { ReviewOverlay } from '../src/components/ReviewOverlay';
import { PracticeOverlay } from '../src/components/PracticeOverlay';
import { StreakReminder } from '../src/components/StreakReminder';
import { AchievementToast } from '../src/components/AchievementToast';
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
  // PRACTICE MODE — same full-page placement as 'overlay', kept as its own
  // kind so showOverlay can tell "a review is up" from "the user is mid-
  // phrase in Practice" and decline to replace the latter.
  | { kind: 'practice'; }
  | { kind: 'streak'; };

type Surface = { host: HTMLDivElement; root: Root; component: ComponentPlacements };

let currentSurface: Surface | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
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

      host.style.cssText = component.kind === 'overlay' || component.kind === 'practice'
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
      // Every dismiss path (X, snooze, pause, disable-site, finishing the
      // session) ends up here regardless of how it got triggered, so this
      // is the one place to release the cross-tab overlay lock — see
      // background.ts's requestShowOverlay/getOverlayLock.
      if (currentSurface?.component.kind === 'overlay') {
        browser.runtime.sendMessage({ type: 'RELEASE_OVERLAY_LOCK' }).catch(() => { });
      }
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
      // PRACTICE MODE guard (removable — see lib/practice/prompt-api.ts).
      // mount() is exclusive, so without this a due word arriving mid-phrase
      // would silently replace the Practice card the user is mid-sentence in.
      // Practice is always something the user opened deliberately; a review
      // that can wait a minute waits.
      if (currentSurface?.component.kind === 'practice') return;
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

    // ── practice overlay (PRACTICE MODE) ───────────────────────
    // Opened only on request from the popup — never by the scheduler, never
    // on a timer. It shares the review overlay's surface and placement, so
    // the two can't be on screen at once.
    function showPractice(langTo: string) {
      mount(
        React.createElement(PracticeOverlay, { targetLang: langTo, onClose: unmount }),
        { kind: 'practice' },
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

    // ── achievement unlock toast ───────────────────────────────
    // Deliberately NOT routed through mount()/currentSurface above: that
    // machinery is exclusive (mounting a new surface replaces whatever's
    // showing), which would mean an achievement unlocked mid-review wipes
    // out the very ReviewOverlay the user just triggered it from. This gets
    // its own independent host so it appears on top of, not instead of,
    // whatever else is on screen.
    let achievementToastSurface: { host: HTMLDivElement; root: Root } | null = null;

    function unmountAchievementToast() {
      achievementToastSurface?.root.unmount();
      achievementToastSurface?.host.remove();
      achievementToastSurface = null;
    }

    function showAchievementToast(ids: string[]) {
      unmountAchievementToast();
      const host = document.createElement('div');
      // Same non-blocking full-viewport trick as the 'streak' placement in
      // mount() above: the host spans the viewport (so the card's own fixed
      // corner position works), but pointer-events stay off everywhere
      // except the card itself (see .vf-ach-toast in tooltip.css).
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = tooltipCss;
      shadow.appendChild(style);
      const slot = document.createElement('div');
      shadow.appendChild(slot);
      const root = createRoot(slot);
      root.render(React.createElement(I18nProvider, {
        storage: browser.storage.local,
        children: React.createElement(AchievementToast, { ids, onDismiss: unmountAchievementToast }),
      }));
      achievementToastSurface = { host, root };
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

        // This poll runs independently in EVERY visible tab (any tab whose
        // OWN window is frontmost, which can be more than one tab at once
        // across multiple browser windows) — without asking first, two tabs
        // could each decide to show the same due word at the same time.
        // background.ts's lock makes sure only the tab the user's actually
        // looking at gets it; if a different (background-window) tab asked,
        // the background redirects SHOW_OVERLAY there itself instead of
        // granting this one.
        const response = await browser.runtime.sendMessage({ type: 'REQUEST_SHOW_OVERLAY', langTo: settings.targetLang }) as { granted: boolean };
        if (response.granted) await showOverlay(settings.targetLang);
      } catch (err) {
        // The extension was reloaded/updated while this tab's content script
        // was still running (common on long-lived tabs, e.g. a doc viewer
        // left open across a dev rebuild). Every browser.* call now rejects
        // with this same message — ctx.setInterval below stops the polling
        // once WXT notices, but swallow this one so it doesn't spam the
        // console in the meantime.
        if (!(err instanceof Error && err.message.includes('Extension context invalidated'))) throw err;
      } finally {
        burstPollInFlight = false;
      }
    }

    // ctx.setInterval (not the raw global) so WXT clears it automatically
    // once this content script's context is invalidated by an extension
    // reload/update, instead of polling forever into a dead context.
    ctx.setInterval(() => { void pollForBurstDrill(); }, BURST_POLL_MS);

    // ── messages from the background ───────────────────────────
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const message = msg as ContentCommand
      if (message?.type === 'GET_PAGE_CONTEXT') {
        sendResponse(getPageContext());
        return true;
      }
      if (message?.type === 'SHOW_OVERLAY') {
        // A card already open in THIS tab (started by burst-drill polling,
        // or a previous SHOW_OVERLAY) — mounting a fresh one would reset an
        // in-progress, possibly-answered-but-not-yet-submitted session out
        // from under the user. The cross-tab lock (background.ts) already
        // keeps other TABS from sending this in the first place, but that
        // doesn't cover every path here (e.g. the popup's own "start
        // review" click messages this tab directly), so guard locally too.
        if (currentSurface?.component.kind !== 'overlay') void showOverlay(message.langTo, message.algoFilter);
        // Acknowledge immediately either way — showOverlay's own await(s)
        // shouldn't hold up the sender (the popup awaits this to know a
        // content script is here before closing itself).
        sendResponse(true);
      }
      // PRACTICE MODE (removable — see lib/practice/prompt-api.ts).
      // Unconditional, unlike SHOW_OVERLAY above: the user explicitly asked
      // for this from the popup, so it should replace whatever's on screen.
      if (message?.type === 'SHOW_PRACTICE') {
        showPractice(message.langTo);
        sendResponse(true);
      }
      if (message?.type === 'SHOW_STREAK_REMINDER') {
        showStreakReminder(message.streak, message.todayCount, message.dailyGoal);
        sendResponse(true);
      }
      if (message?.type === 'ACHIEVEMENT_UNLOCKED') {
        showAchievementToast(message.ids);
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
