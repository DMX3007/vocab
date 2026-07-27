import React, { useState, useEffect, useCallback } from 'react';
import { wordClient } from '../../src/lib/messaging/client';
import { SettingsStore } from '../../src/lib/review/settings-store';
import { resume, type OverlaySettings } from '../../src/lib/review/overlay-policy';
import { ReviewSession } from '../../src/lib/review/session';
import { ReviewCard } from '../../src/components/ReviewCard';
import type { Word } from '../../src/lib/storage/types';
import { SUPPORTED_LANGUAGES } from '../../src/lib/languages';
import '../../src/components/popup.css';

const settingsStore = new SettingsStore(browser.storage.local);

export function Popup() {
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [settings, setSettings] = useState<OverlaySettings | null>(null);

  const refresh = useCallback(async () => {
    const s = await settingsStore.load();
    const all = await wordClient.getAllWords(s.targetLang);
    const due = await wordClient.getDueWords(new Date(), s.targetLang);
    setWords(all);
    setDueCount(due.length);
    setSettings(s);
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  async function startReview(forceAll = false) {
    const targetLang = settings?.targetLang ?? (await settingsStore.load()).targetLang;
    const s = new ReviewSession(wordClient, { mode: 'normal' });
    await s.start(targetLang, new Date(), { includeAll: forceAll });
    setSession(s);
  }

  async function handleLangChange(targetLang: string) {
    await settingsStore.update((s) => ({ ...s, targetLang }));
    await refresh();
  }

  async function endReview() {
    setSession(null);
    await refresh();
  }

  async function handleResume() {
    await settingsStore.update((s) => resume(s));
    await refresh();
  }

  const pausedUntil = settings?.pausedUntil ? new Date(settings.pausedUntil) : null;
  const snoozedUntil = settings?.snoozedUntil ? new Date(settings.snoozedUntil) : null;
  const isPaused = !!pausedUntil && pausedUntil > new Date();
  const isSnoozed = !!snoozedUntil && snoozedUntil > new Date();

  if (session) {
    return (
      <div className="vf-app">
        <ReviewCard session={session} onFinished={endReview} />
      </div>
    );
  }

  return (
    <div className="vf-app">
      <div className="vf-dash">
        <div className="vf-brand">Vocabflow</div>

        <div className="vf-stats">
          <div className="vf-stat">
            <div className="vf-stat-n">{words.length}</div>
            <div className="vf-stat-l">WORDS</div>
          </div>
          <div className="vf-stat">
            <div className="vf-stat-n vf-stat-due">{dueCount}</div>
            <div className="vf-stat-l">DUE NOW</div>
          </div>
        </div>

        <div className="vf-lang">
          TARGET{' '}
          <select
            className="vf-lang-select"
            value={settings?.targetLang ?? ''}
            onChange={(e) => void handleLangChange(e.target.value)}
            disabled={!ready}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
            ))}
          </select>
        </div>

        <button className="vf-review-btn" onClick={() => startReview(false)} disabled={!ready || dueCount === 0}>
          {dueCount > 0 ? `Review ${dueCount}` : 'Nothing due'}
        </button>

        {(isPaused || isSnoozed) && (
          <div className="vf-pausebar">
            <span>{isPaused ? 'Reminders paused' : 'Snoozed'}</span>
            <button className="vf-resume" onClick={handleResume}>Resume now</button>
          </div>
        )}

        <div className="vf-libhead">LIBRARY {'\u00b7'} {words.length}</div>
        {words.length === 0 ? (
          <div className="vf-libempty">No words yet. Select text on any page to add some.</div>
        ) : (
          words.slice(0, 8).map((w) => (
            <div className="vf-libitem" key={w.id}>
              <span className="vf-libterm">{w.term}</span>
              <span className="vf-libtr">{w.translations[0]}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
