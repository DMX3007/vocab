import { WordRepository } from '../src/lib/storage/word-repository';
import { SettingsStore } from '../src/lib/review/settings-store';
import { OverlayLockStore } from '../src/lib/review/overlay-lock';
import { planTick } from '../src/lib/review/scheduler';
import { shouldShowStreakReminder, markStreakReminderShown, isPausedOrSnoozed, type OverlaySettings } from '../src/lib/review/overlay-policy';
import { computeProgressStats, computeUnlockedAchievementIds } from '../src/lib/review/progress';
import { translateWord } from '../src/lib/translate/mymemory';
import { fetchDictionaryInfo } from '../src/lib/dictionary/freeDictionary';
import { validateLicense } from '../src/lib/licensing/license-client';
import type { Message, AchievementUnlockedMessage, BackgroundCommand, RequestShowOverlayResponse } from '../src/lib/messaging/protocol';

// The service worker owns the database AND drives the review alarm.
// On each alarm it asks the active tab for its page context, decides via
// planTick whether to pop the overlay, and tells the tab to show it.
//
// MV3: the worker may be killed when idle; browser.alarms wakes it back up,
// and Dexie/browser.storage reopen lazily, so we keep no long-lived state.

const ALARM = 'vocably-review';
const TICK_MINUTES = 1; // check often; the throttle/cap keep it polite
// Caps an unreasonably large due count so the 4-character badge doesn't
// visually overflow the toolbar icon.
const BADGE_COUNT_CAP = 99;
const BADGE_COLOR = '#C15A34'; // matches --heat in popup.css/tooltip.css

export default defineBackground(() => {
  console.log('[Vocably] service worker alive');
  const repo = new WordRepository();
  const ready = repo.open();
  const settingsStore = new SettingsStore(browser.storage.local);
  // Two independent triggers can each decide to show the review overlay:
  // the 1-minute alarm tick below, and burst-drill polling running locally
  // in EVERY open tab (content.ts — it deliberately bypasses the normal
  // throttle so a card mid-drill can reappear in ~25s). Without
  // coordination, the alarm can slam a fresh overlay on top of an already-
  // open burst card (the visible "blink" this exists to fix), and two
  // different tabs — even two different browser WINDOWS, each with its own
  // visible front tab — can each independently pop the same due word at
  // once. Also read (never written) by Popup.tsx for the "review open
  // elsewhere" banner — same lock, so the banner can't disagree with what's
  // actually showing.
  const overlayLock = new OverlayLockStore(browser.storage.local);

  browser.alarms.create(ALARM, { periodInMinutes: TICK_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void onTick();
  });

  // ── toolbar icon: reflects paused/snoozed state ───────────────
  // Refreshed on worker wake, on every settings change (so pausing from
  // the review card or the popup flips it immediately), and on the
  // 1-minute alarm tick (so a *timed* pause/snooze reverts the icon on
  // its own once it expires, without waiting for the next user action).
  void settingsStore.load().then((s) => { refreshIcon(s, new Date()); void refreshBadge(s); });
  settingsStore.subscribe((s) => { refreshIcon(s, new Date()); void refreshBadge(s); });

  function refreshIcon(settings: OverlaySettings, now: Date): void {
    const paused = isPausedOrSnoozed(settings, now);
    browser.action.setIcon({
      path: paused
        ? { 16: 'icon/icon-16-paused.png', 32: 'icon/icon-32-paused.png', 48: 'icon/icon-48-paused.png', 128: 'icon/icon-128-paused.png' }
        : { 16: 'icon/icon-16.png', 32: 'icon/icon-32.png', 48: 'icon/icon-48.png', 128: 'icon/icon-128.png' },
    }).catch(() => { });
  }

  // ── toolbar badge: how many words are due right now ───────────
  // Scoped to the current target language, matching every other "due"
  // count in the app (the popup's ribbon, the ambient alarm tick below) —
  // switching target language changes what counts as due, so this refires
  // from settingsStore.subscribe() same as the icon does.
  async function refreshBadge(settings: OverlaySettings): Promise<void> {
    await ready;
    const dueCount = (await repo.getDueWords(new Date(), settings.targetLang)).length;
    const text = dueCount === 0 ? '' : dueCount > BADGE_COUNT_CAP ? `${BADGE_COUNT_CAP}+` : String(dueCount);
    await browser.action.setBadgeText({ text }).catch(() => { });
    if (dueCount > 0) await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => { });
  }

  /** The one place that decides "yes, show it here" — both the alarm tick
   *  and every tab's burst-drill poll go through this, so only ONE tab
   *  ever ends up with the overlay open. Always resolves to whichever tab
   *  the user is ACTUALLY looking at (lastFocusedWindow, not just some
   *  window's front tab) — if that's a different tab than the one asking,
   *  this redirects the SHOW_OVERLAY there instead of granting the asker,
   *  so a background-window tab noticing a due word never pops it somewhere
   *  the user isn't looking. */
  async function requestShowOverlay(requestingTabId: number | undefined, langTo: string): Promise<RequestShowOverlayResponse> {
    if (await overlayLock.get()) return { granted: false }; // already showing somewhere

    const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab?.id) return { granted: false };

    await overlayLock.set(activeTab.id);
    if (activeTab.id === requestingTabId) return { granted: true };

    browser.tabs.sendMessage(activeTab.id, { type: 'SHOW_OVERLAY', langTo }).catch(() => { });
    return { granted: false };
  }

  // Content scripts only (never the popup — it isn't a tab, see
  // BackgroundCommand's doc comment) ask for overlay permission here.
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const cmd = message as BackgroundCommand;
    if (cmd?.type === 'REQUEST_SHOW_OVERLAY') {
      void requestShowOverlay(sender.tab?.id, cmd.langTo).then(sendResponse);
    } else if (cmd?.type === 'RELEASE_OVERLAY_LOCK') {
      if (sender.tab?.id != null) void overlayLock.clearIfHeldBy(sender.tab.id);
      sendResponse(true);
    }
    // Always true (not just when handled): the data-message listener below
    // fires for this same message too and needs to run regardless.
    return true;
  });

  // A tab closing mid-review (or crashing) would otherwise leave the lock
  // held until its TTL expires (see overlay-lock.ts) — release it immediately instead.
  browser.tabs.onRemoved.addListener((tabId) => { void overlayLock.clearIfHeldBy(tabId); });

  // ── data messages from popup / content script ────────────────
  // Every listener registered here fires for EVERY message regardless of
  // shape, so this has to explicitly ignore BackgroundCommand messages
  // (handled by the listener above) rather than assume anything it
  // receives is a Message — otherwise both listeners would race to call
  // sendResponse for the same REQUEST_SHOW_OVERLAY, and handle()'s
  // "Unknown message" rejection might win over the real answer.
  const BACKGROUND_COMMAND_TYPES = new Set<BackgroundCommand['type']>(['REQUEST_SHOW_OVERLAY', 'RELEASE_OVERLAY_LOCK']);
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Message
    if (!BACKGROUND_COMMAND_TYPES.has(msg?.type as BackgroundCommand['type'])) {
      handle(msg).then(sendResponse).catch((err) => {
        console.error('[Vocably] message error', msg.type, err);
        sendResponse({ __error: String(err) });
      });
    }
    return true;
  });

  // routes each message type to the right repository call
  async function handle(message: Message): Promise<unknown> {
    await ready;
    switch (message.type) {
      case 'SAVE_WORD': {
        const settings = await settingsStore.load();
        const word = await repo.saveWord(message.payload.input, new Date(), settings.defaultAlgo, settings.defaultPace);
        void checkAchievements();
        void refreshBadge(settings);
        return word;
      }
      case 'GET_ALL_WORDS':
        return repo.getAllWords(message.payload.langTo);
      case 'GET_DUE_WORDS':
        return repo.getDueWords(new Date(message.payload.now), message.payload.langTo);
      case 'COUNT_WORDS':
        return repo.countWords(message.payload.langTo);
      case 'RECORD_REVIEW': {
        const word = await repo.recordReview(
          message.payload.wordId, message.payload.grade,
          message.payload.mode, new Date(message.payload.now),
        );
        void checkAchievements();
        void settingsStore.load().then(refreshBadge);
        return word;
      }
      case 'CORRECT_REVIEW': {
        const { wordId, preReviewState, grade, reviewedAt, now } = message.payload;
        const word = await repo.correctReview(
          wordId,
          { ...preReviewState, dueAt: new Date(preReviewState.dueAt) },
          grade,
          new Date(reviewedAt),
          new Date(now),
        );
        void checkAchievements();
        void settingsStore.load().then(refreshBadge);
        return word;
      }
      case 'GET_REVIEW_LOGS':
        return repo.getReviewLogs(message.payload.wordId);
      case 'DELETE_WORD':
        await repo.deleteWord(message.payload.wordId, new Date(message.payload.now));
        return null;
      case 'GET_ALL_LOGS':
        return repo.getAllReviewLogs();
      case 'MOVE_WORDS_ALGO':
        return repo.moveWordsAlgo(
          message.payload.wordIds, message.payload.algo, new Date(message.payload.now), message.payload.pace,
        );
      case 'SHELVE_WORD':
        return repo.shelveWord(message.payload.wordId, new Date(message.payload.now));
      case 'UNSHELVE_WORD':
        return repo.unshelveWord(message.payload.wordId, new Date(message.payload.now));
      case 'CLEAR_LIBRARY':
        return repo.clearLibrary(message.payload.langTo, new Date(message.payload.now));
      case 'EXPORT_LIBRARY':
        return repo.getAllWordsEverywhere();
      case 'LOOKUP_DICTIONARY': {
        const word = await repo.getWord(message.payload.wordId);
        if (!word) throw new Error(`Word not found: ${message.payload.wordId}`);
        if (word.dictionaryFetchedAt) return word; // already looked up, found or not
        const info = await fetchDictionaryInfo(word.term);
        return repo.setDictionaryInfo(word.id, info, new Date(message.payload.now));
      }
      case 'UPDATE_WORD':
        return repo.updateWord(message.payload.wordId, message.payload.changes, new Date(message.payload.now));
      case 'TRANSLATE':
        // Runs here, not in the content script: a service worker's fetch
        // isn't subject to the host page's CSP, so this stays reliable
        // across whatever site the tooltip happens to be open on.
        return translateWord(message.payload.term, message.payload.langFrom, message.payload.langTo);
      case 'ACTIVATE_LICENSE':
        return validateLicense(message.payload.key);
      default: {
        const exhaustive: never = message
        throw new Error(`Unknown message: ${String(exhaustive)}`);
      }
    }
  }

  type TickContext = {
    dueCount: number;
    tabId: number;
    host: string;
    pageCtx: {
      userIsTyping: boolean;
      isFullscreen: boolean;
    }
  }
  // ── the review alarm ─────────────────────────────────────────
  async function prepareForTick(now: Date, langTo: string): Promise<TickContext | undefined> {
    const dueCount = (await repo.getDueWords(now, langTo)).length;
    if (dueCount === 0) return;

    // lastFocusedWindow, not currentWindow — a service worker has no window
    // of its own, so "current" is ill-defined; lastFocusedWindow is the
    // well-defined "wherever the user's actually looking" query, matching
    // requestShowOverlay's own definition of "active tab" below.
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) return;
    const tabId = tab.id

    let host: string;
    try { host = new URL(tab.url).hostname; } catch { return; } // skip browser:// etc.

    const pageCtx = await askPageContext(tab.id);
    if (!pageCtx) return; // no content script on this page (browser store, pdf...)

    return { dueCount, tabId, host, pageCtx }
  }

  async function onTick(): Promise<void> {
    await ready;
    const now = new Date();
    const settings = await settingsStore.load();
    refreshIcon(settings, now);
    void refreshBadge(settings);

    const context = await prepareForTick(now, settings.targetLang)
    if (!context) return

    const { dueCount, host, pageCtx, tabId } = context
    const result = planTick(settings, { host, dueCount, ...pageCtx }, now);
    if (result.show) {
      if (result.settings) await settingsStore.save(result.settings);
      // Same lock burst-drill polling uses (requestShowOverlay above) — a
      // card already open (however it got there) means this tick backs off
      // instead of resetting it.
      if (!(await overlayLock.get())) {
        await overlayLock.set(tabId);
        browser.tabs.sendMessage(tabId, { type: 'SHOW_OVERLAY', langTo: settings.targetLang }).catch(() => { });
      }
      return;
    }

    // The ambient due-word overlay isn't showing this tick (throttled,
    // paused, etc.) — check whether a separate, once-a-day streak nudge
    // should fire instead. The two never show in the same tick: a visit
    // from the ambient overlay already gives the user a chance to review.
    await checkStreakReminder(settings, host, pageCtx, tabId, now);
  }

  async function checkStreakReminder(
    settings: Awaited<ReturnType<typeof settingsStore.load>>,
    host: string,
    pageCtx: { userIsTyping: boolean; isFullscreen: boolean },
    tabId: number,
    now: Date,
  ): Promise<void> {
    const logs = await repo.getAllReviewLogs();
    const stats = computeProgressStats([], logs, now, settings.dailyGoal, new Set(settings.frozenDates));
    const fire = shouldShowStreakReminder(
      { todayCount: stats.todayCount, dailyGoal: stats.goal, streak: stats.streak },
      settings,
      { host, ...pageCtx },
      now,
    );
    if (!fire) return;

    await settingsStore.save(markStreakReminderShown(settings, now));
    browser.tabs.sendMessage(tabId, {
      type: 'SHOW_STREAK_REMINDER',
      streak: stats.streak,
      todayCount: stats.todayCount,
      dailyGoal: stats.goal,
    }).catch(() => { });
  }

  /** Runs after SAVE_WORD and RECORD_REVIEW — the two operations that can
   *  ever cross an achievement threshold, and (crucially) the two handlers
   *  every trigger path shares: the popup's Add Word modal, the in-page
   *  tooltip, and the on-page review overlay all funnel through these same
   *  background message handlers regardless of which surface the user is
   *  actually looking at. That makes this the one place unlock detection
   *  can live and still see every action — a check that lived in the popup
   *  (as it used to) would only ever fire when the popup happened to be
   *  open, missing the on-page overlay/tooltip flows entirely.
   *
   *  Fire-and-forget from the caller (not awaited) so it never delays the
   *  SAVE_WORD/RECORD_REVIEW response the UI is waiting on. */
  async function checkAchievements(): Promise<void> {
    const settings = await settingsStore.load();
    const [words, logs] = await Promise.all([
      repo.getAllWords(settings.targetLang),
      repo.getAllReviewLogs(),
    ]);
    const stats = computeProgressStats(words, logs, new Date(), settings.dailyGoal, new Set(settings.frozenDates), settings.dailyAddGoal);
    const unlockedIds = computeUnlockedAchievementIds(words, stats);
    const seen = new Set(settings.seenAchievements);
    const newlyUnlocked = unlockedIds.filter((id) => !seen.has(id));
    if (newlyUnlocked.length === 0) return;

    await settingsStore.save({ ...settings, seenAchievements: unlockedIds });

    const msg: AchievementUnlockedMessage = { type: 'ACHIEVEMENT_UNLOCKED', ids: newlyUnlocked };
    // The popup, if it's currently open.
    browser.runtime.sendMessage(msg).catch(() => { });
    // Wherever the user is actually looking, for an on-page toast — the
    // active tab regardless of whether IT was the one that triggered this
    // (the popup itself isn't a tab, so this is the only way to reach the
    // page when the action came from there).
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) browser.tabs.sendMessage(tab.id, msg).catch(() => { });
  }

  async function askPageContext(tabId: number): Promise<{ userIsTyping: boolean; isFullscreen: boolean } | null> {
    try {
      const sendMessageResponse = await browser.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' });
      return sendMessageResponse ? (sendMessageResponse as { userIsTyping: boolean; isFullscreen: boolean }) : null
    } catch {
      // There is no content script on the page (pdf file for example)
      return null
    }
  }
});
