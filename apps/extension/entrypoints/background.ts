import { WordRepository } from '../src/lib/storage/word-repository';
import { SettingsStore } from '../src/lib/review/settings-store';
import { planTick } from '../src/lib/review/scheduler';
import { translateWord } from '../src/lib/translate/mymemory';
import type { Message } from '../src/lib/messaging/protocol';

// The service worker owns the database AND drives the review alarm.
// On each alarm it asks the active tab for its page context, decides via
// planTick whether to pop the overlay, and tells the tab to show it.
//
// MV3: the worker may be killed when idle; browser.alarms wakes it back up,
// and Dexie/browser.storage reopen lazily, so we keep no long-lived state.

const ALARM = 'vocabflow-review';
const TICK_MINUTES = 1; // check often; the throttle/cap keep it polite

export default defineBackground(() => {
  console.log('[VocabFlow] service worker alive');
  const repo = new WordRepository();
  const ready = repo.open();
  const settingsStore = new SettingsStore(browser.storage.local);

  browser.alarms.create(ALARM, { periodInMinutes: TICK_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void onTick();
  });

  // ── data messages from popup / content script ────────────────
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Message
    handle(msg).then(sendResponse).catch((err) => {
      console.error('[VocabFlow] message error', msg.type, err);
      sendResponse({ __error: String(err) });
    });
    return true;
  });

  // routes each message type to the right repository call
  async function handle(message: Message): Promise<unknown> {
    await ready;
    switch (message.type) {
      case 'SAVE_WORD': {
        const { defaultAlgo } = await settingsStore.load();
        return repo.saveWord(message.payload.input, new Date(), defaultAlgo);
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
        return repo.moveWordsAlgo(message.payload.wordIds, message.payload.algo, new Date(message.payload.now));
      case 'TRANSLATE':
        // Runs here, not in the content script: a service worker's fetch
        // isn't subject to the host page's CSP, so this stays reliable
        // across whatever site the tooltip happens to be open on.
        return translateWord(message.payload.term, message.payload.langFrom, message.payload.langTo);
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

    const context = await prepareForTick(now, settings.targetLang)
    if (!context) return

    const { dueCount, host, pageCtx, tabId } = context
    const result = planTick(settings, { host, dueCount, ...pageCtx }, now);
    if (!result.show) return;

    if (result.settings) await settingsStore.save(result.settings);
    browser.tabs.sendMessage(tabId, { type: 'SHOW_OVERLAY', langTo: settings.targetLang }).catch(() => { });
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
