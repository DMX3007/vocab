import React, { useState, useEffect, useCallback } from 'react';
import { wordClient } from '../../src/lib/messaging/client';
import { SettingsStore } from '../../src/lib/review/settings-store';
import { resume, type OverlaySettings } from '../../src/lib/review/overlay-policy';
import { applyStreakMaintenance } from '../../src/lib/review/progress';
import { downloadJson } from '../../src/lib/export';
import { ReviewPane } from '../../src/components/ReviewPane';
import { LibraryPane } from '../../src/components/LibraryPane';
import { ProgressPane } from '../../src/components/ProgressPane';
import { PlanPane, type PlanState } from '../../src/components/PlanPane';
import { AddWordModal, type AddWordInput } from '../../src/components/AddWordModal';
import { HelpSheet } from '../../src/components/HelpSheet';
import { Icon } from '../../src/components/icons';
import { computeProgressStats } from '../../src/lib/review/progress';
import type { LibrarySort, AlgoFilter } from '../../src/lib/review/library';
import type { Word, ReviewLog } from '../../src/lib/storage/types';
import { DEFAULT_TARGET_LANG } from '../../src/lib/languages';
import { FREE_WORD_CAP } from '../../src/lib/plan';
import type { AlgoId } from '@vocably/core';
import '../../src/components/popup.css';

const settingsStore = new SettingsStore(browser.storage.local);
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
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const [tab, setTab] = useState<TabId>('review');
  const [modalOpen, setModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('added');
  const [librarySelecting, setLibrarySelecting] = useState(false);
  const [planState, setPlanState] = useState<PlanState>('beta');
  const [themePref, setThemePref] = useState<ThemePref>(null);
  const [systemDark, setSystemDark] = useState(false);

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

  async function handleDailyGoalChange(dailyGoal: number) {
    await settingsStore.update((s) => ({ ...s, dailyGoal }));
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
      return { ok: false, message: "Couldn't reach the license server — check your connection and try again." };
    }
    if (!result.valid) {
      return { ok: false, message: "That key doesn't look right. Check the format XXXX-XXXX-XXXX-XXXX." };
    }
    await browser.storage.local.set({ [LICENSE_KEY_STORAGE]: key });
    updatePlanState(result.plan === 'premium' ? 'premium' : 'free');
    return { ok: true, message: 'License accepted. Welcome to Premium.' };
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
      await browser.tabs.sendMessage(tab.id, { type: 'SHOW_OVERLAY', langTo: targetLang, algoFilter });
      window.close();
    } catch {
      showToast('Open a regular webpage first, then review from there.');
    }
  }

  async function handleLangChange(targetLang: string) {
    await settingsStore.update((s) => ({ ...s, targetLang }));
    await refresh();
  }

  async function handleDefaultAlgoChange(defaultAlgo: AlgoId) {
    await settingsStore.update((s) => ({ ...s, defaultAlgo }));
    await refresh();
  }

  async function handleMoveAlgo(wordIds: string[], algo: AlgoId) {
    await wordClient.moveWordsAlgo(wordIds, algo, new Date());
    showToast(`Moved ${wordIds.length} word${wordIds.length === 1 ? '' : 's'} to ${algo === 'sm2' ? 'SM-2' : 'Leitner'}`);
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
      showToast(`You've hit the free ${FREE_WORD_CAP}-word cap — upgrade in the Plan tab to add more`);
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
      showToast(`Added ${toAdd.length} — the rest hit the free ${FREE_WORD_CAP}-word cap. Upgrade in the Plan tab for more.`);
    } else {
      showToast(`Added ${toAdd.length} word${toAdd.length === 1 ? '' : 's'}`);
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
    downloadJson(`vocably-export-${date}.json`, all);
    showToast(`Exported ${all.length} word${all.length === 1 ? '' : 's'}`);
  }

  async function handleClearLibrary() {
    const targetLang = settings?.targetLang ?? DEFAULT_TARGET_LANG;
    const count = await wordClient.clearLibrary(targetLang, new Date());
    showToast(`Cleared ${count} word${count === 1 ? '' : 's'}`);
    await refresh();
  }

  async function handleShelve(id: string) {
    await wordClient.shelveWord(id, new Date());
    showToast('Set aside — it won’t come up in review for now');
    await refresh();
  }

  async function handleUnshelve(id: string) {
    await wordClient.unshelveWord(id, new Date());
    showToast('Back in review rotation');
    await refresh();
  }

  async function handleEditWord(id: string, changes: { term: string; translations: string[]; contextSentence: string }) {
    await wordClient.updateWord(id, changes, new Date());
    showToast('Word updated');
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
  const isPaused = !!pausedUntil && pausedUntil > new Date();
  const isSnoozed = !!snoozedUntil && snoozedUntil > new Date();

  const stats = computeProgressStats(
    words, logs, new Date(),
    settings?.dailyGoal ?? 10,
    new Set(settings?.frozenDates ?? []),
  );
  const tabs: { id: TabId; label: string; badge?: number; count?: number }[] = [
    { id: 'review', label: 'Review', badge: dueCount },
    { id: 'progress', label: 'Progress' },
    { id: 'library', label: 'Library', count: words.length },
    { id: 'plan', label: 'Plan' },
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
                {planState === 'premium' ? '★ PREMIUM' : planState === 'free' ? 'FREE' : 'BETA'}
              </span>
              {planState === 'free' ? (
                <button className="header-quota" onClick={() => setTab('plan')} style={{ marginLeft: 6 }}>
                  {words.length} / 500 words →
                </button>
              ) : (
                <span style={{ marginLeft: 6 }}>{words.length} words</span>
              )}
            </div>
          </div>
        </div>
        <div className="h-actions">
          <button
            className="icon-btn"
            title={effectiveDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            <Icon name={effectiveDark ? 'sun' : 'moon'} />
          </button>
          <button className="icon-btn" title="Help" onClick={() => setHelpOpen(true)}><Icon name="help" /></button>
        </div>
      </div>

      <div className="ribbon">
        <div className="ribbon-cell">
          <div className="ribbon-num">{words.length}</div>
          <div className="ribbon-label">Words</div>
        </div>
        <div className="ribbon-cell">
          <div className="ribbon-num heat">{dueCount}</div>
          <div className="ribbon-label">Due now</div>
          {dueCount > 0 && <Icon name="sparkle" size={12} className="ribbon-spark" />}
        </div>
        <div className="ribbon-cell">
          <div className="ribbon-num gold">{stats.streak}</div>
          <div className="ribbon-label">Day streak</div>
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

      {(isPaused || isSnoozed) && (
        <div className="vf-pausebar">
          <span>{isPaused ? 'Reminders paused' : 'Snoozed'}</span>
          <button className="vf-resume" onClick={handleResume}>Resume now</button>
        </div>
      )}

      <div className="tab-body">
        {tab === 'review' && (
          <ReviewPane
            words={words}
            logs={logs}
            dueCount={dueCount}
            targetLang={settings?.targetLang ?? DEFAULT_TARGET_LANG}
            onLangChange={handleLangChange}
            algo={settings?.defaultAlgo ?? 'sm2'}
            onAlgoChange={handleDefaultAlgoChange}
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
            frozenDates={settings?.frozenDates ?? []}
            streakFreezes={settings?.streakFreezes ?? 0}
            onDailyGoalChange={handleDailyGoalChange}
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
            onBuy={handleBuy}
            onActivateLicense={handleActivateLicense}
            onDeactivate={() => void handleDeactivateLicense()}
          />
        )}
      </div>

      {tab === 'library' && !librarySelecting && (
        <button className="fab" onClick={() => setModalOpen(true)} title="Add new word">
          <Icon name="plus" size={15} />
          <span className="fab-label">Add word</span>
        </button>
      )}

      <AddWordModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={handleAddWords} />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

// Placeholder mark for the Vocably rename — a plain serif V standing in
// for a proper logo until one gets designed.
function BrandMark() {
  return (
    <div className="brand-mark">
      <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 20 }}>V</span>
    </div>
  );
}
