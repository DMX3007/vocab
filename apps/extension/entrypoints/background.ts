import { WordRepository } from '../src/lib/storage/word-repository';
import { SettingsStore } from '../src/lib/review/settings-store';
import { planTick } from '../src/lib/review/scheduler';
import { shouldShowStreakReminder, markStreakReminderShown, isPausedOrSnoozed, type OverlaySettings } from '../src/lib/review/overlay-policy';
import { computeProgressStats } from '../src/lib/review/progress';
import { translateWord } from '../src/lib/translate/mymemory';
import { fetchDictionaryInfo } from '../src/lib/dictionary/freeDictionary';
import { validateLicense } from '../src/lib/licensing/license-client';
import type { Message } from '../src/lib/messaging/protocol';

// The service worker owns the database AND drives the review alarm.
// On each alarm it asks the active tab for its page context, decides via
// planTick whether to pop the overlay, and tells the tab to show it.
//
// MV3: the worker may be killed when idle; browser.alarms wakes it back up,
// and Dexie/browser.storage reopen lazily, so we keep no long-lived state.

const ALARM = 'vocably-review';
const TICK_MINUTES = 1; // check often; the throttle/cap keep it polite

export default defineBackground(() => {
  console.log('[Vocably] service worker alive');
  const repo = new WordRepository();
  const ready = repo.open();
  const settingsStore = new SettingsStore(browser.storage.local);

  browser.alarms.create(ALARM, { periodInMinutes: TICK_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void onTick();
  });

  // ── toolbar icon: reflects paused/snoozed state ───────────────
  // Refreshed on worker wake, on every settings change (so pausing from
  // the review card or the popup flips it immediately), and on the
  // 1-minute alarm tick (so a *timed* pause/snooze reverts the icon on
  // its own once it expires, without waiting for the next user action).
  void settingsStore.load().then((s) => refreshIcon(s, new Date()));
  settingsStore.subscribe((s) => refreshIcon(s, new Date()));

  function refreshIcon(settings: OverlaySettings, now: Date): void {
    const paused = isPausedOrSnoozed(settings, now);
    browser.action.setIcon({
      path: paused
        ? { 16: 'icon/icon-16-paused.png', 32: 'icon/icon-32-paused.png', 48: 'icon/icon-48-paused.png', 128: 'icon/icon-128-paused.png' }
        : { 16: 'icon/icon-16.png', 32: 'icon/icon-32.png', 48: 'icon/icon-48.png', 128: 'icon/icon-128.png' },
    }).catch(() => { });
  }

  // ── data messages from popup / content script ────────────────
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Message
    handle(msg).then(sendResponse).catch((err) => {
      console.error('[Vocably] message error', msg.type, err);
      sendResponse({ __error: String(err) });
    });
    return true;
  });

  // routes each message type to the right repository call
  async function handle(message: Message): Promise<unknown> {
    await ready;
    switch (message.type) {
      case 'SAVE_WORD': {
        const { defaultAlgo, defaultPace } = await settingsStore.load();
        return repo.saveWord(message.payload.input, new Date(), defaultAlgo, defaultPace);
      }
      case 'GET_ALL_WORDS':
        return repo.getAllWords(message.payload.langTo);
      case 'GET_DUE_WORDS':
        return repo.getDueWords(new Date(message.payload.now), message.payload.langTo);
      case 'COUNT_WORDS':
        return repo.countWords(message.payload.langTo);
      case 'RECORD_REVIEW':
        return repo.recordReview(
          message.payload.wordId, message.payload.grade,
          message.payload.mode, new Date(message.payload.now),
        );
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

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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

    const context = await prepareForTick(now, settings.targetLang)
    if (!context) return

    const { dueCount, host, pageCtx, tabId } = context
    const result = planTick(settings, { host, dueCount, ...pageCtx }, now);
    if (result.show) {
      if (result.settings) await settingsStore.save(result.settings);
      browser.tabs.sendMessage(tabId, { type: 'SHOW_OVERLAY', langTo: settings.targetLang }).catch(() => { });
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
