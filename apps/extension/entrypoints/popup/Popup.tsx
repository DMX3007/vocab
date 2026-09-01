import React, { useState, useEffect, useCallback } from 'react';
import { wordClient } from '../../src/lib/messaging/client';
import { SettingsStore } from '../../src/lib/review/settings-store';
// DEMO MODE (experimental — see src/lib/demo/). Removable with its block below.
import { DemoPane } from '../../src/components/DemoPane';
import { DraftStore } from '../../src/lib/storage/draft-store';
import { OverlayLockStore } from '../../src/lib/review/overlay-lock';
import { resume, pauseFor, addToBlacklist, removeFromBlacklist, isBlacklisted, type OverlaySettings, type PausePreset } from '../../src/lib/review/overlay-policy';
import { applyStreakMaintenance, computeProgressStats, resolveUnlockedAchievement } from '../../src/lib/review/progress';
import { ACHIEVEMENT_TIER_KEY, ACHIEVEMENT_TRACK_KEY } from '../../src/lib/review/achievement-copy';
import type { AchievementUnlockedMessage } from '../../src/lib/messaging/protocol';
import { downloadJson } from '../../src/lib/export';
import { ReviewPane } from '../../src/components/ReviewPane';
import { LibraryPane } from '../../src/components/LibraryPane';
import { ProgressPane } from '../../src/components/ProgressPane';
import { PlanPane, type PlanState } from '../../src/components/PlanPane';
import { AddWordModal, type AddWordInput } from '../../src/components/AddWordModal';
import { HelpSheet } from '../../src/components/HelpSheet';
import { Icon } from '../../src/components/icons';
import type { LibrarySort, AlgoFilter } from '../../src/lib/review/library';
import type { Word, ReviewLog } from '../../src/lib/storage/types';
import { DEFAULT_TARGET_LANG } from '../../src/lib/languages';
import { FREE_WORD_CAP } from '../../src/lib/plan';
import { useI18n } from '../../src/lib/i18n';
import type { AlgoId, Pace } from '@vocably/core';
import '../../src/components/popup.css';

const settingsStore = new SettingsStore(browser.storage.local);
const draftStore = new DraftStore(browser.storage.local);
const overlayLockStore = new OverlayLockStore(browser.storage.local);
// Popped out via handlePopout below, into a real (non-auto-closing) browser
// window — see AddWordModal's onPopout for why. openAdd=1 jumps straight to
// the Library tab with the Add Word sheet already up, matching what the
// user was doing in the toolbar popup before they popped out.
const urlParams = new URLSearchParams(window.location.search);
const isStandalone = urlParams.get('standalone') === '1';
const shouldOpenAddOnLoad = urlParams.get('openAdd') === '1';
const PLAN_STATE_KEY = 'vocably_plan_state';
const LICENSE_KEY_STORAGE = 'vocably_license_key';
// Point this at your real Ko-fi page before shipping — see the licensing
// runbook. Payment always happens on Ko-fi's own site, in a new tab, never
// inside the extension itself.
const KOFI_URL = 'https://ko-fi.com/vocably';
const THEME_KEY = 'vocably_theme';

type TabId = 'review' | 'progress' | 'library' | 'plan';
/** null = follow the OS/browser's own dark/light setting. */
type ThemePref = 'light' | 'dark' | null;

export function Popup() {
  const { t, tp, locale, setLocale } = useI18n();
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const [tab, setTab] = useState<TabId>(shouldOpenAddOnLoad ? 'library' : 'review');
  const [modalOpen, setModalOpen] = useState(shouldOpenAddOnLoad);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('added');
  const [librarySelecting, setLibrarySelecting] = useState(false);
  const [planState, setPlanState] = useState<PlanState>('beta');
  const [themePref, setThemePref] = useState<ThemePref>(null);
  const [systemDark, setSystemDark] = useState(false);
  const [currentHost, setCurrentHost] = useState<string | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [elsewhereReview, setElsewhereReview] = useState<{ tabId: number; host: string | null } | null>(null);
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);

  const refresh = useCallback(async () => {
    const s = await settingsStore.load();
    const [all, due, allLogs] = await Promise.all([
      wordClient.getAllWords(s.targetLang),
      wordClient.getDueWords(new Date(), s.targetLang),
      wordClient.getAllReviewLogs(),
    ]);
    // Consumes a banked streak freeze for a missed yesterday, and awards a
    // new one on a fresh milestone — see progress.ts. Runs on every popup
    // open since there's no reliable "midnight" hook otherwise.
    const maintenance = applyStreakMaintenance(allLogs, s, new Date());
    if (maintenance.changed) await settingsStore.save(maintenance.settings);
    setWords(all);
    setDueCount(due.length);
    setLogs(allLogs);
    setSettings(maintenance.settings);
  }, []);

  // Achievement unlocks are detected centrally in background.ts — the one
  // place every trigger path (this popup's Add Word modal, the in-page
  // tooltip, the on-page review overlay) funnels through — which broadcasts
  // here so the popup's toast stays in sync with whatever just happened,
  // even when it happened on a page this popup isn't showing. Re-registers
  // on locale change (not an empty dep array) so the listener always closes
  // over the current t/tp rather than freezing whatever was active on mount.
  useEffect(() => {
    function onMessage(msg: unknown) {
      const message = msg as AchievementUnlockedMessage;
      if (message?.type !== 'ACHIEVEMENT_UNLOCKED') return;
      announceUnlocked(message.ids);
      void refresh();
    }
    function announceUnlocked(ids: string[]) {
      if (ids.length === 1) {
        const resolved = resolveUnlockedAchievement(ids[0]!);
        if (!resolved) return;
        showToast(
          resolved.isOneOff
            ? t('achievement.oneOff.firstWord')
            : t('achievement.unlockedToastOne', {
                tier: t(ACHIEVEMENT_TIER_KEY[resolved.tier!]),
                track: t(ACHIEVEMENT_TRACK_KEY[resolved.trackId!]!.name),
              }),
        );
        return;
      }
      showToast(tp('achievement.unlockedToastMany', ids.length));
    }
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [t, tp, refresh]);

  async function handleDailyGoalChange(dailyGoal: number) {
    await settingsStore.update((s) => ({ ...s, dailyGoal }));
    await refresh();
  }

  async function handleDailyAddGoalChange(dailyAddGoal: number) {
    await settingsStore.update((s) => ({ ...s, dailyAddGoal }));
    await refresh();
  }

  useEffect(() => {
    (async () => {
      const stored = await browser.storage.local.get(PLAN_STATE_KEY);
      const storedState = stored[PLAN_STATE_KEY];
      if (storedState === 'beta' || storedState === 'free' || storedState === 'premium') {
        setPlanState(storedState);
      }
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  // LibraryPane unmounts on tab switch (resetting its own state), but it
  // can't tell us that's happening — reset our mirror of its select mode too.
  useEffect(() => {
    if (tab !== 'library') setLibrarySelecting(false);
  }, [tab]);

  // Theme: load any explicit choice, and track the system preference live so
  // the header toggle icon (and the "no explicit choice yet" default) stay
  // correct even if the OS theme changes while the popup happens to be open.
  useEffect(() => {
    (async () => {
      const stored = await browser.storage.local.get(THEME_KEY);
      const storedTheme = stored[THEME_KEY];
      if (storedTheme === 'light' || storedTheme === 'dark') setThemePref(storedTheme);
    })();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (themePref) document.documentElement.setAttribute('data-theme', themePref);
    else document.documentElement.removeAttribute('data-theme');
  }, [themePref]);

  // The active tab's host, so the site on/off toggle below knows what it's
  // toggling. null on anything that isn't a normal webpage (chrome://,
  // extension pages, a blank new tab) — those can't carry a content script
  // anyway, so there's nothing there to enable or disable.
  useEffect(() => {
    (async () => {
      try {
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        setCurrentHost(activeTab?.url ? new URL(activeTab.url).hostname : null);
        setCurrentTabId(activeTab?.id ?? null);
      } catch {
        setCurrentHost(null);
        setCurrentTabId(null);
      }
    })();
  }, []);

  // "Review card open elsewhere" — reads the same lock background.ts (and
  // handleStartReview below) use to arbitrate which tab gets to show the
  // overlay (see overlay-lock.ts), so this can never disagree with what's
  // actually on screen. currentTabId gates both effects below so neither
  // runs against a still-unresolved "which tab is this popup even attached
  // to" — comparing against null would show a
  // false-positive banner for the tab that's actually holding the lock.
  const checkElsewhereReview = useCallback(async (tabId: number) => {
    const lock = await overlayLockStore.get();
    if (!lock || lock.tabId === tabId) {
      setElsewhereReview(null);
      return;
    }
    try {
      const lockedTab = await browser.tabs.get(lock.tabId);
      setElsewhereReview({ tabId: lock.tabId, host: lockedTab.url ? new URL(lockedTab.url).hostname : null });
    } catch {
      setElsewhereReview(null); // that tab's gone — a stale lock the background will clean up on its own
    }
  }, []);

  useEffect(() => {
    if (currentTabId === null) return;
    void checkElsewhereReview(currentTabId);
  }, [currentTabId, checkElsewhereReview]);

  // Live updates while the popup stays open — e.g. the user answers/closes
  // the card in the other tab while browsing Library here.
  useEffect(() => {
    if (currentTabId === null) return;
    function onChanged(changes: Record<string, { newValue?: unknown }>, area: string) {
      if (area === 'local' && 'vocably_overlay_lock' in changes) void checkElsewhereReview(currentTabId!);
    }
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [currentTabId, checkElsewhereReview]);

  async function handleGoToReviewTab() {
    if (!elsewhereReview) return;
    try {
      const target = await browser.tabs.get(elsewhereReview.tabId);
      await browser.tabs.update(elsewhereReview.tabId, { active: true });
      if (target.windowId != null) await browser.windows.update(target.windowId, { focused: true });
      window.close();
    } catch {
      setElsewhereReview(null); // the tab's gone by the time we tried to jump to it
    }
  }

  async function handleToggleSite() {
    if (!currentHost) return;
    await settingsStore.update((s) =>
      isBlacklisted(s, currentHost) ? removeFromBlacklist(s, currentHost) : addToBlacklist(s, currentHost),
    );
    await refresh();
  }

  /** Re-opens this same UI as a real browser window instead of the toolbar
   *  action popup, then closes the action popup. A real window doesn't
   *  auto-close on blur, so it survives switching the OS input language
   *  mid-word (unlike the action popup — see AddWordModal's onPopout). */
  function handlePopout() {
    const url = browser.runtime.getURL('/popup.html') + '?openAdd=1&standalone=1';
    void browser.windows.create({ url, type: 'popup', width: 420, height: 640 });
    window.close();
  }

  const effectiveDark = themePref ? themePref === 'dark' : systemDark;

  function toggleTheme() {
    const next: ThemePref = effectiveDark ? 'light' : 'dark';
    setThemePref(next);
    void browser.storage.local.set({ [THEME_KEY]: next });
  }

  function updatePlanState(next: PlanState) {
    setPlanState(next);
    void browser.storage.local.set({ [PLAN_STATE_KEY]: next });
  }

  /** Checks a pasted license key against the API and, if it's good, both
   *  updates planState AND remembers the key itself (so a future re-check —
   *  e.g. after a refund revokes it — has something to re-validate). */
  async function handleActivateLicense(key: string): Promise<{ ok: boolean; message: string }> {
    let result: Awaited<ReturnType<typeof wordClient.activateLicense>>;
    try {
      result = await wordClient.activateLicense(key);
    } catch {
      return { ok: false, message: t('toast.licenseServerError') };
    }
    if (!result.valid) {
      return { ok: false, message: t('toast.licenseBadFormat') };
    }
    await browser.storage.local.set({ [LICENSE_KEY_STORAGE]: key });
    updatePlanState(result.plan === 'premium' ? 'premium' : 'free');
    return { ok: true, message: t('toast.licenseAccepted') };
  }

  /** Checkout always happens on Ko-fi's own page, in a new tab — never a
   *  form embedded in the extension. */
  function handleBuy() {
    void browser.tabs.create({ url: KOFI_URL });
  }

  async function handleDeactivateLicense() {
    await browser.storage.local.remove(LICENSE_KEY_STORAGE);
    updatePlanState('free');
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  // Review always happens as the same full-page overlay the alarm shows —
  // never inline in the popup — so there's one review experience, not two.
  async function handleStartReview(algoFilter: AlgoFilter) {
    const targetLang = settings?.targetLang ?? (await settingsStore.load()).targetLang;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('no active tab');
      // Claims the same lock the alarm tick / burst-drill polling use (see
      // overlay-lock.ts) — without this, a manually-started review wouldn't
      // register at all: another tab's ambient poll could still pop the
      // same due word mid-session, and the "review open elsewhere" banner
      // would never know this session exists. A deliberate click here
      // always wins over whatever ambient trigger might be mid-flight.
      await overlayLockStore.set(tab.id);
      await browser.tabs.sendMessage(tab.id, { type: 'SHOW_OVERLAY', langTo: targetLang, algoFilter });
      window.close();
    } catch {
      showToast(t('toast.openWebpageFirst'));
    }
  }

  async function handleLangChange(targetLang: string) {
    await settingsStore.update((s) => ({ ...s, targetLang }));
    await refresh();
  }

  async function handleDefaultAlgoChange(defaultAlgo: AlgoId, defaultPace: Pace) {
    await settingsStore.update((s) => ({ ...s, defaultAlgo, defaultPace }));
    await refresh();
  }

  /** DEMO MODE (experimental — see src/lib/demo/). Removable. */
  async function handleDemoModeChange(demoModeEnabled: boolean) {
    await settingsStore.update((s) => ({ ...s, demoModeEnabled }));
    await refresh();
  }

  async function handleVoiceReviewEnabledChange(voiceReviewEnabled: boolean) {
    await settingsStore.update((s) => ({ ...s, voiceReviewEnabled }));
    await refresh();
  }

  async function handleMoveAlgo(wordIds: string[], algo: AlgoId, pace: Pace) {
    await wordClient.moveWordsAlgo(wordIds, algo, new Date(), pace);
    showToast(tp('toast.movedWords', wordIds.length, { algo: algo === 'sm2' ? 'SM-2' : 'Leitner' }));
    await refresh();
  }

  /** Pauses the INTERRUPTIONS, not the schedule. Nothing here touches any
   *  word's dueAt (see pauseFor — it only writes settings), so words keep
   *  coming due and the Review tab's countdowns keep ticking the whole
   *  time; you simply don't get a card pushed at you. Until now this could
   *  only be triggered from the review card's own Pause menu, which meant
   *  waiting to be interrupted before you could ask not to be. */
  async function handlePause(preset: PausePreset) {
    setPauseMenuOpen(false);
    await settingsStore.update((s) => pauseFor(s, new Date(), preset));
    await refresh();
  }

  async function handleResume() {
    await settingsStore.update((s) => resume(s));
    await refresh();
  }

  async function handleAddWords(inputs: AddWordInput[]) {
    const targetLang = settings?.targetLang ?? DEFAULT_TARGET_LANG;

    // The only real plan difference today: free is capped at FREE_WORD_CAP
    // words total. beta/premium are unlimited. Approximates against the
    // batch size rather than checking each merge-vs-create outcome — errs
    // toward stopping a little early, never over the cap.
    const remaining = planState === 'free' ? Math.max(0, FREE_WORD_CAP - words.length) : Infinity;
    if (remaining <= 0) {
      showToast(t('toast.capHit', { cap: FREE_WORD_CAP }));
      return;
    }
    const toAdd = inputs.slice(0, remaining);

    for (const input of toAdd) {
      await wordClient.saveWord({
        term: input.term,
        translation: input.translation,
        contextSentence: input.contextSentence ?? '',
        sourceUrl: '',
        langFrom: 'en',
        langTo: targetLang,
      });
    }

    if (toAdd.length < inputs.length) {
      showToast(t('toast.addedPartialCap', { n: toAdd.length, cap: FREE_WORD_CAP }));
    } else {
      showToast(tp('toast.addedWords', toAdd.length));
    }
    await refresh();
  }

  async function handleDelete(id: string) {
    await wordClient.deleteWord(id, new Date());
    await refresh();
  }

  async function handleExportLibrary() {
    const all = await wordClient.exportLibrary();
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`browsevocab-export-${date}.json`, all);
    showToast(tp('toast.exportedWords', all.length));
  }

  async function handleClearLibrary() {
    const targetLang = settings?.targetLang ?? DEFAULT_TARGET_LANG;
    const count = await wordClient.clearLibrary(targetLang, new Date());
    showToast(tp('toast.clearedWords', count));
    await refresh();
  }

  async function handleShelve(id: string) {
    await wordClient.shelveWord(id, new Date());
    showToast(t('toast.shelved'));
    await refresh();
  }

  async function handleUnshelve(id: string) {
    await wordClient.unshelveWord(id, new Date());
    showToast(t('toast.unshelved'));
    await refresh();
  }

  async function handleEditWord(id: string, changes: { term: string; translations: string[]; contextSentence: string }) {
    await wordClient.updateWord(id, changes, new Date());
    showToast(t('toast.wordUpdated'));
    await refresh();
  }

  /** Nothing else is due — bring the oldest-shelved word back into rotation
   *  and start reviewing it immediately, rather than leaving Review empty
   *  while shelved words just sit there. */
  async function handleReviveShelved() {
    const shelved = words
      .filter((w) => w.shelvedAt)
      .sort((a, b) => a.shelvedAt!.getTime() - b.shelvedAt!.getTime());
    const oldest = shelved[0];
    if (!oldest) return;
    await wordClient.unshelveWord(oldest.id, new Date());
    await refresh();
    await handleStartReview('all');
  }

  const pausedUntil = settings?.pausedUntil ? new Date(settings.pausedUntil) : null;
  const snoozedUntil = settings?.snoozedUntil ? new Date(settings.snoozedUntil) : null;
  const isPaused = !!settings?.pausedIndefinitely || (!!pausedUntil && pausedUntil > new Date());
  const isSnoozed = !!snoozedUntil && snoozedUntil > new Date();
  const siteDisabled = !!currentHost && !!settings && isBlacklisted(settings, currentHost);

  const stats = computeProgressStats(
    words, logs, new Date(),
    settings?.dailyGoal ?? 10,
    new Set(settings?.frozenDates ?? []),
  );
  const tabs: { id: TabId; label: string; badge?: number; count?: number }[] = [
    { id: 'review', label: t('tab.review'), badge: dueCount },
    { id: 'progress', label: t('tab.progress') },
    { id: 'library', label: t('tab.library'), count: words.length },
    { id: 'plan', label: t('tab.plan') },
  ];

  return (
    <div className="vf-app">
      <div className={`toast ${toast ? 'show' : ''}`}>
        {toast && <Icon name="check" />} {toast}
      </div>

      <div className="h-bar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Vocab<em>ly</em></div>
            <div className="overline">
              <span className={`tier-pill ${planState === 'premium' ? 'premium' : ''}`}>
                {planState === 'premium' ? t('tier.premium') : planState === 'free' ? t('tier.free') : t('tier.beta')}
              </span>
              {planState === 'free' ? (
                <button className="header-quota" onClick={() => setTab('plan')} style={{ marginLeft: 6 }}>
                  {t('header.quotaLink', { used: words.length, cap: FREE_WORD_CAP })}
                </button>
              ) : (
                <span style={{ marginLeft: 6 }}>{tp('header.wordsPlain', words.length)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="h-actions">
          <button
            className="icon-btn"
            title={locale === 'ru' ? 'Switch to English' : 'Переключить на русский'}
            onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>
              {locale === 'ru' ? 'EN' : 'RU'}
            </span>
          </button>
          <button
            className="icon-btn"
            title={effectiveDark ? t('theme.toLight') : t('theme.toDark')}
            onClick={toggleTheme}
          >
            <Icon name={effectiveDark ? 'sun' : 'moon'} />
          </button>
          <button className="icon-btn" title={t('help.title')} onClick={() => setHelpOpen(true)}><Icon name="help" /></button>
        </div>
      </div>

      <div className="ribbon">
        <div className="ribbon-cell">
          <div className="ribbon-num">{words.length}</div>
          <div className="ribbon-label">{t('ribbon.words')}</div>
        </div>
        <div className="ribbon-cell">
          <div className="ribbon-num heat">{dueCount}</div>
          <div className="ribbon-label">{t('ribbon.dueNow')}</div>
          {dueCount > 0 && <Icon name="sparkle" size={12} className="ribbon-spark" />}
        </div>
        <div className="ribbon-cell">
          <div className="ribbon-num gold">{stats.streak}</div>
          <div className="ribbon-label">{t('ribbon.dayStreak')}</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge != null && t.badge > 0 && <span className="badge attn">{t.badge}</span>}
            {t.count != null && t.count > 0 && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>

      {(isPaused || isSnoozed) ? (
        <div className="vf-pausebar">
          <span>{isPaused ? t('pausebar.remindersPaused') : t('pausebar.snoozed')}</span>
          <button className="vf-resume" onClick={handleResume}>{t('pausebar.resumeNow')}</button>
        </div>
      ) : (
        <div className="vf-pausebar idle">
          <span>{t('pausebar.remindersActive')}</span>
          <div className="vf-pause-wrap">
            <button
              className="vf-pause-btn"
              onClick={() => setPauseMenuOpen((v) => !v)}
              aria-expanded={pauseMenuOpen}
              title={t('pausebar.pauseHint')}
            >
              {t('overlay.pause')} {'\u25be'}
            </button>
            {pauseMenuOpen && (
              <div className="vf-pause-menu">
                <button onClick={() => void handlePause('15m')}>{t('overlay.pause15m')}</button>
                <button onClick={() => void handlePause('1h')}>{t('overlay.pause1h')}</button>
                <button onClick={() => void handlePause('tomorrow')}>{t('overlay.pauseTomorrow')}</button>
                <button onClick={() => void handlePause('indefinite')}>{t('overlay.pauseIndefinite')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {currentHost && (
        <div className={`vf-sitebar ${siteDisabled ? 'off' : ''}`}>
          <span>{siteDisabled ? t('sitebar.disabledOn', { host: currentHost }) : t('sitebar.activeOn', { host: currentHost })}</span>
          <button className="vf-site-toggle" onClick={() => void handleToggleSite()}>
            {siteDisabled ? t('sitebar.enable') : t('sitebar.disable')}
          </button>
        </div>
      )}

      {elsewhereReview && (
        <div className="vf-elsewhere-bar">
          <span>
            {elsewhereReview.host
              ? t('reviewElsewhere.onHost', { host: elsewhereReview.host })
              : t('reviewElsewhere.generic')}
          </span>
          <button className="vf-elsewhere-go" onClick={() => void handleGoToReviewTab()}>
            {t('reviewElsewhere.goThere')}
          </button>
        </div>
      )}

      <div className="tab-body">
        {/* DEMO MODE (experimental — see src/lib/demo/). Takes over the
            Review tab entirely while on, which is also what makes it
            obvious that normal review is paused. Remove this one block
            plus the import to drop the feature. */}
        {tab === 'review' && settings?.demoModeEnabled && (
          <DemoPane
            words={words}
            targetLang={settings?.targetLang ?? DEFAULT_TARGET_LANG}
            onExit={() => void handleDemoModeChange(false)}
          />
        )}
        {tab === 'review' && !settings?.demoModeEnabled && (
          <ReviewPane
            words={words}
            logs={logs}
            dueCount={dueCount}
            targetLang={settings?.targetLang ?? DEFAULT_TARGET_LANG}
            onLangChange={handleLangChange}
            algo={settings?.defaultAlgo ?? 'sm2'}
            pace={settings?.defaultPace ?? 'aggressive'}
            onAlgoChange={handleDefaultAlgoChange}
            voiceReviewEnabled={settings?.voiceReviewEnabled ?? false}
            onVoiceReviewEnabledChange={handleVoiceReviewEnabledChange}
            onEnterDemoMode={() => void handleDemoModeChange(true)}
            onStartReview={handleStartReview}
            onReviveShelved={handleReviveShelved}
            ready={ready}
            onDueCountChange={setDueCount}
          />
        )}
        {tab === 'progress' && (
          <ProgressPane
            words={words}
            logs={logs}
            dailyGoal={settings?.dailyGoal ?? 10}
            dailyAddGoal={settings?.dailyAddGoal ?? 3}
            frozenDates={settings?.frozenDates ?? []}
            streakFreezes={settings?.streakFreezes ?? 0}
            onDailyGoalChange={handleDailyGoalChange}
            onDailyAddGoalChange={handleDailyAddGoalChange}
          />
        )}
        {tab === 'library' && (
          <LibraryPane
            words={words}
            sort={sort}
            setSort={setSort}
            search={search}
            setSearch={setSearch}
            onDelete={handleDelete}
            onMoveAlgo={handleMoveAlgo}
            onShelve={handleShelve}
            onUnshelve={handleUnshelve}
            onEdit={handleEditWord}
            onExport={handleExportLibrary}
            onClearLibrary={handleClearLibrary}
            onSelectModeChange={setLibrarySelecting}
          />
        )}
        {tab === 'plan' && (
          <PlanPane
            words={words}
            planState={planState}
            defaultAlgo={settings?.defaultAlgo ?? 'sm2'}
            defaultPace={settings?.defaultPace ?? 'aggressive'}
            onBuy={handleBuy}
            onActivateLicense={handleActivateLicense}
            onDeactivate={() => void handleDeactivateLicense()}
          />
        )}
      </div>

      {tab === 'library' && !librarySelecting && (
        <button className="fab" onClick={() => setModalOpen(true)} title={t('fab.addWordTitle')}>
          <Icon name="plus" size={15} />
          <span className="fab-label">{t('fab.addWord')}</span>
        </button>
      )}

      <AddWordModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddWords}
        draftStore={draftStore}
        onPopout={isStandalone ? undefined : handlePopout}
      />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

// Placeholder mark for BrowseVocab — a plain serif B standing in for a
// proper logo until one gets designed.
function BrandMark() {
  return (
    <div className="brand-mark">
      <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 20 }}>B</span>
    </div>
  );
}
