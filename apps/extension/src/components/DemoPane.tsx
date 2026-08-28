// DEMO MODE — experimental, isolated. See src/lib/demo/prompt-api.ts's
// header for how to remove the whole feature.
//
// A vocabulary ACTIVATION drill, deliberately outside the SRS: Chrome's
// on-device model writes a short ENGLISH phrase built from words in your
// library, you render it in your target language by voice or keyboard, and
// the extension reads your answer back. Nothing is graded and nothing is
// written to any word's scheduling state — the point is producing language,
// not being measured. That's also why it lives here in the popup rather
// than the on-page overlay: it touches none of the review machinery.
//
// Voice here is deliberately the SAME shape as the review card's: one
// shared hands-free setting, the mic opening by itself on every new phrase,
// Ctrl/Cmd+Shift+V to toggle, and a spoken answer submitting itself. The one
// thing that genuinely differs is the microphone PERMISSION — an extension
// page can't prompt for it at all, so this pane hands the user a way to grant
// it from a real tab. See lib/voice/mic-permission.ts.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useI18n } from '../lib/i18n';
import { speak } from '../lib/tts';
import { isSpeechRecognitionSupported, listen, type VoiceListenHandle } from '../lib/voice/speech-recognition';
import { MIC_PERMISSION_PAGE, classifyVoiceError, readMicPermission } from '../lib/voice/mic-permission';
import { SettingsStore } from '../lib/review/settings-store';
import type { Word } from '../lib/storage/types';
import {
  checkAvailability,
  createSession,
  modelCanWrite,
  type DemoSession,
  type ModelAvailability,
} from '../lib/demo/prompt-api';
import {
  SYSTEM_PROMPT,
  buildDrillPrompt,
  canDrill,
  parseGeneratedPhrase,
  pickDrillWords,
  type DrillDifficulty,
  type DrillDirection,
} from '../lib/demo/drill';
import { SUPPORTED_LANGUAGES } from '../lib/languages';

const settingsStore = new SettingsStore(browser.storage.local);

interface Props {
  words: Word[];
  /** The app's targetLang: the language words are translated INTO. Note this
   *  is NOT necessarily the language being learned — see DrillDirection. */
  targetLang: string;
  onExit: () => void;
}

interface Drill {
  english: string;
  translated: string | null;
  /** The picked words' own saved translations. Used as the cue when the
   *  model can't write the target language (see buildDrillPrompt) — these
   *  come from the user's library, so they're correct by construction. */
  cues: string[];
  /** Which library words this phrase was built from — shown so the user
   *  can see what's being activated even if the model buried one. */
  terms: string[];
}

/** The language of the page text this app captures words from, and so the
 *  language most users are actually learning (see DrillDirection). */
const LEARNING_LANG = 'en';

export function DemoPane({ words, targetLang, onExit }: Props) {
  const { t } = useI18n();
  const [availability, setAvailability] = useState<ModelAvailability | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<DrillDifficulty>('simple');
  // Defaults to producing English: that's the language you're learning if
  // you're reading English pages, and producing it is the point.
  const [direction, setDirection] = useState<DrillDirection>('english');
  const [drill, setDrill] = useState<Drill | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  /** True once we know the mic is blocked for this extension — either the
   *  Permissions API said so up front, or a listen turn came back 'denied'.
   *  Drives the "Allow microphone" button, which is the ONLY thing that can
   *  actually fix it (a popup can't prompt; see mic-permission.ts). */
  const [micBlocked, setMicBlocked] = useState(false);
  /** The same hands-free setting the review card uses (voiceReviewEnabled) —
   *  one preference, not two: turning voice on for review and finding it off
   *  in demo mode would just read as broken. */
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);

  // Which side of the pair the learner produces vs. reads.
  const canTranslate = modelCanWrite(targetLang);
  const answerLang = direction === 'english' ? LEARNING_LANG : targetLang;
  const promptLang = direction === 'english' ? targetLang : LEARNING_LANG;

  const sessionRef = useRef<DemoSession | null>(null);
  const voiceRef = useRef<VoiceListenHandle | null>(null);
  /** Monotonic id for the current listening turn. Every callback checks it
   *  before touching state, so a transcript that arrives after the drill
   *  moved on can't answer the NEW phrase with the old phrase's speech. */
  const turnRef = useRef(0);
  const submittedRef = useRef(false);

  useEffect(() => {
    void checkAvailability().then(setAvailability);
    return () => {
      sessionRef.current?.destroy();
      voiceRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    void settingsStore.load().then((s) => setVoiceModeEnabled(s.voiceReviewEnabled));
    settingsStore.subscribe((s) => setVoiceModeEnabled(s.voiceReviewEnabled));
    // The grant is stored against the whole chrome-extension:// origin, so
    // this is a one-time check for the pane, not a per-drill one.
    void readMicPermission().then((state) => setMicBlocked(state === 'denied'));
    // No unsubscribe — matches every other long-lived subscribe() here.
  }, []);

  /** One session is reused across drills — creating it is what triggers the
   *  one-time model download, so doing it per phrase would be wasteful. */
  const getSession = useCallback(async (): Promise<DemoSession> => {
    if (sessionRef.current) return sessionRef.current;
    const session = await createSession(SYSTEM_PROMPT, {
      onDownloadProgress: (loaded) => setDownloadPct(Math.round(loaded * 100)),
      // English is always produced; the target only when the model can
      // actually write it (createSession filters the rest out anyway).
      outputLanguages: ['en', targetLang],
    });
    sessionRef.current = session;
    setDownloadPct(null);
    setAvailability('available');
    return session;
  }, [targetLang]);

  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setAnswer('');
    setSubmitted(false);
    submittedRef.current = false;
    setDrill(null);
    try {
      const picked = pickDrillWords(words, difficulty);
      const terms = picked.map((w) => w.term);
      const session = await getSession();
      const targetLabel = canTranslate
        ? SUPPORTED_LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang
        : null;
      const raw = await session.prompt(buildDrillPrompt(terms, difficulty, targetLabel));
      const parsed = parseGeneratedPhrase(raw);
      if (!parsed.english) throw new Error('empty');
      setDrill({
        ...parsed,
        translated: canTranslate ? parsed.translated : null,
        terms,
        cues: picked.map((w) => w.translations[0] ?? w.term),
      });
    } catch (err) {
      console.error(err, 'Error: demo drill generation');
      setError(t('demo.generateError'));
    } finally {
      setGenerating(false);
    }
  }, [generating, words, difficulty, targetLang, canTranslate, getSession, t]);

  // ── voice ──────────────────────────────────────────────────────
  //
  // Two effects rather than one, exactly as in ReviewCard and for the same
  // reason: voiceModeEnabled arrives from storage ASYNCHRONOUSLY, long after
  // the first drill has rendered, so an effect keyed on [drill] alone would
  // capture the stale initial `false` and never re-run to see the real value.

  useEffect(() => {
    // A new phrase must abandon the previous one's listening turn, so a late
    // transcript can't leak across (see turnRef).
    turnRef.current += 1;
    voiceRef.current?.stop();
    voiceRef.current = null;
    setListening(false);
    setVoiceError(null);
  }, [drill]);

  useEffect(() => {
    if (voiceModeEnabled && drill && !submitted) startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, voiceModeEnabled]);

  /** Starts one listening turn. A result SUBMITS straight away rather than
   *  just filling the box — that's what makes this hands-free: speak the
   *  phrase, hear it read back, press Next (or keep the keyboard hand free
   *  and press Enter). Nothing is graded, so there's no wrong answer to
   *  stop and look at, unlike the review card. */
  function startListening() {
    // Guards on the REF, not the `listening` state: on a new drill the reset
    // effect and this one run after the same render, so `listening` still
    // reads true from that render's closure even though the previous turn was
    // just stopped. The ref is already null by then, so it's the only honest
    // "is a turn in flight" answer available here.
    if (submittedRef.current || voiceRef.current) return;
    const turn = ++turnRef.current;
    const isCurrent = () => turnRef.current === turn;
    setVoiceError(null);
    setListening(true);
    voiceRef.current = listen(answerLang, {
      onResult: (transcript) => {
        if (!isCurrent() || !transcript) return;
        setAnswer(transcript);
        submitAnswer(transcript);
      },
      onError: (code) => {
        if (!isCurrent()) return;
        const kind = classifyVoiceError(code);
        if (kind === 'none') return;
        if (kind === 'denied') setMicBlocked(true);
        setVoiceError(
          kind === 'unsupported' ? t('demo.voiceUnsupported')
          : kind === 'denied' ? t('demo.voiceDenied')
          : t('demo.voiceError'),
        );
      },
      onEnd: () => {
        if (!isCurrent()) return;
        setListening(false);
        voiceRef.current = null;
      },
    });
  }

  /** Toggles the shared hands-free setting. Deliberately does NOT call
   *  startListening() when turning on — the [drill, voiceModeEnabled] effect
   *  above already reacts to this same state change, and starting from both
   *  places would race two recognition turns against each other. */
  async function toggleVoiceMode() {
    const enabled = !voiceModeEnabled;
    setVoiceModeEnabled(enabled); // optimistic — subscribe() confirms it right behind this
    await settingsStore.update((s) => ({ ...s, voiceReviewEnabled: enabled }));
    if (!enabled) {
      turnRef.current += 1;
      voiceRef.current?.stop();
      setListening(false);
    }
  }

  /** Opens the permission page in a real TAB. This is the whole fix for
   *  "the mic does nothing in the popup": Chrome refuses to show a
   *  permission bubble on an extension popup, but grants made from an
   *  extension page in a tab apply to the extension origin everywhere. */
  function openMicPermission() {
    void browser.tabs.create({ url: browser.runtime.getURL(`/${MIC_PERMISSION_PAGE}`) });
  }

  /** Submitting is purely "I'm done saying it" — nothing is graded. The
   *  answer is read back so the user hears their own production, which is
   *  the only feedback this mode offers by design. Takes the text as an
   *  argument so a voice result can submit the fresh transcript without
   *  waiting for React state to catch up in the same tick. */
  function submitAnswer(text: string) {
    if (!text.trim() || submittedRef.current) return;
    submittedRef.current = true;
    turnRef.current += 1; // done talking; ignore anything still in flight
    voiceRef.current?.stop();
    setListening(false);
    setSubmitted(true);
    speak(text, answerLang);
  }

  function submit() {
    submitAnswer(answer);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault(); // don't let it fall through and insert 'v'
      void toggleVoiceMode();
      return;
    }
    if (e.key !== 'Enter') return;
    if (submitted) void generate();
    else submit();
  }

  // ── gates ──────────────────────────────────────────────────────
  if (!canDrill(words)) {
    return (
      <div className="demo-pane">
        <DemoHeader onExit={onExit} />
        <div className="empty">
          <div className="empty-title">{t('demo.noWordsTitle')}</div>
          <div className="empty-hint">{t('demo.noWordsHint')}</div>
        </div>
      </div>
    );
  }

  if (availability === 'unsupported' || availability === 'unavailable') {
    return (
      <div className="demo-pane">
        <DemoHeader onExit={onExit} />
        <div className="empty">
          <div className="empty-title">{t('demo.unavailableTitle')}</div>
          <div className="empty-hint">{t('demo.unavailableHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="demo-pane" onKeyDown={onKeyDown}>
      <DemoHeader onExit={onExit} />

      <div className="demo-controls">
        <div className="demo-difficulty">
          {(['english', 'target'] as const).map((d) => (
            <button
              key={d}
              className={`demo-diff-btn ${direction === d ? 'active' : ''}`}
              onClick={() => setDirection(d)}
              title={t('demo.directionHint')}
            >
              {d === 'english' ? t('demo.writeEnglish') : t('demo.writeTarget')}
            </button>
          ))}
        </div>
      </div>

      <div className="demo-controls">
        <div className="demo-difficulty">
          {(['simple', 'hard'] as const).map((d) => (
            <button
              key={d}
              className={`demo-diff-btn ${difficulty === d ? 'active' : ''}`}
              onClick={() => setDifficulty(d)}
            >
              {t(d === 'simple' ? 'demo.simple' : 'demo.hard')}
            </button>
          ))}
        </div>
        <button className="btn-primary demo-generate" onClick={() => void generate()} disabled={generating}>
          <Icon name="sparkle" size={13} />{' '}
          {generating ? t('demo.generating') : drill ? t('demo.another') : t('demo.start')}
        </button>
      </div>

      {downloadPct !== null && (
        <div className="demo-note">{t('demo.downloading', { pct: downloadPct })}</div>
      )}
      {availability === 'downloadable' && downloadPct === null && !drill && (
        <div className="demo-note">{t('demo.firstRunNote')}</div>
      )}
      {error && <div className="vf-hint demo-note">{error}</div>}

      {drill && (
        <div className="demo-drill">
          <div className="demo-prompt-row">
            <div className="demo-phrase">
              {direction === 'english'
                ? (drill.translated ?? drill.cues.join(', '))
                : drill.english}
            </div>
            <button
              type="button"
              className="vf-speak-btn"
              onClick={() => speak(direction === 'english' ? (drill.translated ?? drill.cues.join(', ')) : drill.english, promptLang)}
              title={t('library.pronounce')}
              aria-label={t('library.pronounce')}
            >
              <Icon name="volume" size={16} />
            </button>
          </div>
          {direction === 'english' && !drill.translated && (
            <div className="demo-note">
              {canTranslate ? t('demo.noTranslation') : t('demo.cueFallback')}
            </div>
          )}
          <div className="demo-terms">{drill.terms.join(' · ')}</div>

          <div className="vf-card-input-row demo-input-row">
            <input
              className="vf-card-input"
              placeholder={listening ? t('card.listening') : t('demo.answerPlaceholder')}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              autoFocus
            />
            {isSpeechRecognitionSupported() && (
              <button
                type="button"
                className={`vf-mic-btn ${voiceModeEnabled ? 'enabled' : ''} ${listening ? 'listening' : ''}`}
                onClick={() => void toggleVoiceMode()}
                title={t('demo.voiceToggleTitle')}
                aria-label={t('demo.voiceToggleTitle')}
                aria-pressed={voiceModeEnabled}
              >
                <Icon name="mic" size={16} />
              </button>
            )}
          </div>

          {voiceError && <div className="vf-hint demo-note">{voiceError}</div>}
          {micBlocked && (
            <button type="button" className="vf-card-btn-ghost demo-mic-fix" onClick={openMicPermission}>
              <Icon name="mic" size={13} /> {t('demo.allowMic')}
            </button>
          )}

          {submitted && direction === 'english' && (
            <div className="demo-reference">
              <div className="demo-reference-label">{t('demo.referenceLabel')}</div>
              <div className="demo-reference-row">
                <span>{drill.english}</span>
                <button
                  type="button"
                  className="vf-speak-btn"
                  onClick={() => speak(drill.english, LEARNING_LANG)}
                  title={t('library.pronounce')}
                  aria-label={t('library.pronounce')}
                >
                  <Icon name="volume" size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="demo-actions">
            {!submitted ? (
              <button className="btn-primary" onClick={submit} disabled={!answer.trim()}>
                {t('demo.submit')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="vf-card-btn-ghost"
                  onClick={() => speak(answer, answerLang)}
                  title={t('demo.replay')}
                >
                  <Icon name="volume" size={13} /> {t('demo.replay')}
                </button>
                <button className="btn-primary" onClick={() => void generate()} disabled={generating}>
                  {t('demo.next')} {'→'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DemoHeader({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="demo-header">
      <div>
        <div className="demo-badge">{t('demo.badge')}</div>
        <div className="demo-sub">{t('demo.subtitle')}</div>
      </div>
      <button className="ghost-btn demo-exit" onClick={onExit}>{t('demo.exit')}</button>
    </div>
  );
}
