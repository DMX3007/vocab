import { WordRepository } from '../src/lib/storage/word-repository';
import { SettingsStore } from '../src/lib/review/settings-store';
import { planTick } from '../src/lib/review/scheduler';
import type { Message } from '../src/lib/messaging/protocol';

// The service worker owns the database AND drives the review alarm.
// On each alarm it asks the active tab for its page context, decides via
// planTick whether to pop the overlay, and tells the tab to show it.
//
// MV3: the worker may be killed when idle; browser.alarms wakes it back up,
// and Dexie/browser.storage reopen lazily, so we keep no long-lived state.

const ALARM = 'vocabflow-review';
const TICK_MINUTES = 1; // check often; the throttle/cap keep it polite

// TODO(loop): real active target language from settings.
const LANG_TO = 'ru';

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
      case 'SAVE_WORD':
        return repo.saveWord(message.payload.input, new Date());
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
  async function prepareForTick(now: Date): Promise<TickContext | undefined> {
    const dueCount = (await repo.getDueWords(now, LANG_TO)).length;
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

    const context = await prepareForTick(now)
    if (!context) return

    const { dueCount, host, pageCtx, tabId } = context
    const result = planTick(settings, { host, dueCount, ...pageCtx }, now);
    if (!result.show) return;

    if (result.settings) await settingsStore.save(result.settings);
    browser.tabs.sendMessage(tabId, { type: 'SHOW_OVERLAY', langTo: LANG_TO }).catch(() => { });
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
