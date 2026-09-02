// PRACTICE MODE — see src/lib/practice/prompt-api.ts's header for how to
// remove the whole feature.
//
// The counterpart to ReviewCard, on the same on-page surface: Chrome's
// on-device model writes a short phrase out of words in your library, you
// render it in the other language by voice or keyboard, and the extension
// reads your answer back. Nothing is graded and no word's scheduling state
// is touched — the point is producing language, not being measured.
//
// It lives in the page (a content script) rather than the popup for two
// concrete reasons beyond matching Review's feel:
//   • the microphone. A content script's prompt is attributed to the SITE
//     and Chrome shows it normally; an extension popup can't prompt at all
//     (see lib/voice/mic-permission.ts). Voice here needs no workaround.
//   • room. A phrase plus its cue needs more than a 420px popup column.
//
// What it CANNOT do here is call the model: the Prompt API is exposed to
// extension contexts only, and this runs in the page's isolated world. All
// generation goes through the background worker via wordClient.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useI18n } from '../lib/i18n';
import { speak } from '../lib/tts';
import { isSpeechRecognitionSupported, listen, type VoiceListenHandle } from '../lib/voice/speech-recognition';
import { classifyVoiceError } from '../lib/voice/mic-permission';
import { SettingsStore } from '../lib/review/settings-store';
import { wordClient } from '../lib/messaging/client';
import type { PracticeDrill } from '../lib/messaging/protocol';
import type { ModelAvailability } from '../lib/practice/prompt-api';
import type { DrillDifficulty, DrillDirection } from '../lib/practice/drill';

const settingsStore = new SettingsStore(browser.storage.local);

/** The language of the pages this app captures words from, and so the one
 *  most users are actually learning — see DrillDirection, whose naming is
 *  about the LEARNER rather than the app's targetLang field. */
const LEARNING_LANG = 'en';

interface Props {
  /** The app's targetLang: the language words are translated INTO. Note this
   *  is NOT necessarily the language being learned — see DrillDirection. */
  targetLang: string;
  onClose: () => void;
}

export function PracticeCard({ targetLang, onClose }: Props) {
  const { t } = useI18n();
  const [availability, setAvailability] = useState<ModelAvailability | null>(null);
  const [canTranslate, setCanTranslate] = useState(false);
  const [difficulty, setDifficulty] = useState<DrillDifficulty>('simple');
  // Defaults to producing English: that's the language you're learning if
  // you're reading English pages, and producing it is the whole point.
  const [direction, setDirection] = useState<DrillDirection>('english');
  const [drill, setDrill] = useState<PracticeDrill | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  /** Shared with the review card (OverlaySettings.voiceReviewEnabled) — one
   *  hands-free preference, not two. */
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);

  const answerLang = direction === 'english' ? LEARNING_LANG : targetLang;
  const promptLang = direction === 'english' ? targetLang : LEARNING_LANG;

  const inputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<VoiceListenHandle | null>(null);
  /** Monotonic id for the current listening turn, so a transcript that
   *  arrives after the phrase moved on can't answer the new one. */
  const turnRef = useRef(0);
  const submittedRef = useRef(false);

  useEffect(() => {
    void wordClient.practiceAvailability()
      .then((r) => { setAvailability(r.availability); setCanTranslate(r.canTranslate); })
      .catch(() => setAvailability('unavailable'));
    void settingsStore.load().then((s) => setVoiceModeEnabled(s.voiceReviewEnabled));
    settingsStore.subscribe((s) => setVoiceModeEnabled(s.voiceReviewEnabled));
    return () => voiceRef.current?.stop();
  }, []);

  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setAnswer('');
    setSubmitted(false);
    submittedRef.current = false;
    setDrill(null);
    try {
      setDrill(await wordClient.generatePracticeDrill(targetLang, difficulty));
    } catch (err) {
      console.error(err, 'Error: practice drill generation');
      setError(t('practice.generateError'));
    } finally {
      setGenerating(false);
    }
  }, [generating, targetLang, difficulty, t]);

  // Two effects rather than one, for the same reason ReviewCard splits them:
  // voiceModeEnabled arrives from storage asynchronously, long after the
  // first phrase renders, so an effect keyed on [drill] alone would capture
  // the stale initial `false` and never re-run to see the real value.
  useEffect(() => {
    turnRef.current += 1;
    voiceRef.current?.stop();
    voiceRef.current = null;
    setListening(false);
    setVoiceError(null);
    inputRef.current?.focus();
  }, [drill]);

  useEffect(() => {
    if (voiceModeEnabled && drill && !submitted) startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, voiceModeEnabled]);

  function startListening() {
    // Guards on the ref, not `listening` state: on a new phrase the reset
    // effect above and this one run after the same render, so `listening`
    // still reads true from that render's closure.
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
        setVoiceError(
          kind === 'unsupported' ? t('practice.voiceUnsupported')
          : kind === 'denied' ? t('card.voiceDenied')
          : t('practice.voiceError'),
        );
      },
      onEnd: () => {
        if (!isCurrent()) return;
        setListening(false);
        voiceRef.current = null;
      },
    });
  }

  /** Toggles the shared hands-free setting. Deliberately does NOT start
   *  listening itself — the effect above already reacts to this same state
   *  change, and starting from both places races two recognition turns. */
  async function toggleVoiceMode() {
    const enabled = !voiceModeEnabled;
    setVoiceModeEnabled(enabled);
    await settingsStore.update((s) => ({ ...s, voiceReviewEnabled: enabled }));
    if (!enabled) {
      turnRef.current += 1;
      voiceRef.current?.stop();
      setListening(false);
    }
  }

  /** Submitting is purely "I'm done saying it" — nothing is graded. The
   *  answer is read back so the user hears their own production, which is
   *  the only feedback this mode offers by design. */
  function submitAnswer(text: string) {
    if (!text.trim() || submittedRef.current) return;
    submittedRef.current = true;
    turnRef.current += 1;
    voiceRef.current?.stop();
    setListening(false);
    setSubmitted(true);
    speak(text, answerLang);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      void toggleVoiceMode();
      return;
    }
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Enter') return;
    if (submitted) void generate();
    else submitAnswer(answer);
  }

  const promptText = drill
    ? (direction === 'english' ? (drill.translated ?? drill.cues.join(', ')) : drill.english)
    : '';

  if (availability === 'unsupported' || availability === 'unavailable') {
    return (
      <div className="vf-card vf-card-empty" onKeyDown={onKeyDown}>
        <p>{t('practice.unavailableTitle')}</p>
        <p className="vf-card-ctx">{t('practice.unavailableHint')}</p>
        <button className="vf-card-btn" onClick={onClose}>{t('card.close')}</button>
      </div>
    );
  }

  return (
    <div className="vf-card vf-practice" onKeyDown={onKeyDown}>
      <div className="vf-card-top">
        <span className="vf-card-dir">{t('practice.badge')}</span>
        <div className="vf-practice-toggles">
          {(['english', 'target'] as const).map((d) => (
            <button
              key={d}
              className={`vf-practice-toggle ${direction === d ? 'active' : ''}`}
              onClick={() => setDirection(d)}
              title={t('practice.directionHint')}
            >
              {d === 'english' ? t('practice.writeEnglish') : t('practice.writeTarget')}
            </button>
          ))}
          {(['simple', 'hard'] as const).map((d) => (
            <button
              key={d}
              className={`vf-practice-toggle ${difficulty === d ? 'active' : ''}`}
              onClick={() => setDifficulty(d)}
            >
              {t(d === 'simple' ? 'practice.simple' : 'practice.hard')}
            </button>
          ))}
        </div>
      </div>

      {!drill && (
        <div className="vf-practice-intro">
          <p className="vf-card-prompt">{t('practice.introTitle')}</p>
          <p className="vf-card-ctx">
            {availability === 'downloadable' ? t('practice.firstRunNote') : t('practice.introHint')}
          </p>
        </div>
      )}

      {drill && (
        <>
          <div className="vf-practice-phrase-row">
            <div className="vf-card-prompt">{promptText}</div>
            <button
              type="button"
              className="vf-speak-btn"
              onClick={() => speak(promptText, promptLang)}
              title={t('library.pronounce')}
              aria-label={t('library.pronounce')}
            >
              <Icon name="volume" size={16} />
            </button>
          </div>
          {direction === 'english' && !drill.translated && (
            <div className="vf-card-ctx">
              {canTranslate ? t('practice.noTranslation') : t('practice.cueFallback')}
            </div>
          )}
          <div className="vf-practice-terms">{drill.terms.join(' · ')}</div>

          <div className="vf-card-input-row">
            <input
              ref={inputRef}
              className="vf-card-input"
              placeholder={listening ? t('card.listening') : t('practice.answerPlaceholder')}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              autoFocus
            />
            {isSpeechRecognitionSupported() && (
              <button
                type="button"
                className={`vf-mic-btn ${voiceModeEnabled ? 'enabled' : ''} ${listening ? 'listening' : ''}`}
                onClick={() => void toggleVoiceMode()}
                title={t('practice.voiceToggleTitle')}
                aria-label={t('practice.voiceToggleTitle')}
                aria-pressed={voiceModeEnabled}
              >
                <Icon name="mic" size={16} />
              </button>
            )}
          </div>

          {submitted && direction === 'english' && (
            <div className="vf-practice-reference">
              <div className="vf-practice-reference-label">{t('practice.referenceLabel')}</div>
              <div className="vf-practice-reference-row">
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
        </>
      )}

      {voiceError && <div className="vf-hint">{voiceError}</div>}
      {error && <div className="vf-hint">{error}</div>}

      <div className="vf-card-actions">
        {drill && !submitted && (
          <button className="vf-card-btn" onClick={() => submitAnswer(answer)} disabled={!answer.trim()}>
            {t('practice.submit')}
          </button>
        )}
        {drill && submitted && (
          <button
            type="button"
            className="vf-card-btn-ghost"
            onClick={() => speak(answer, answerLang)}
            title={t('practice.replay')}
          >
            <Icon name="volume" size={13} /> {t('practice.replay')}
          </button>
        )}
        <button className="vf-card-btn" onClick={() => void generate()} disabled={generating}>
          {generating ? t('practice.generating') : drill ? t('practice.another') : t('practice.start')}
        </button>
      </div>
    </div>
  );
}
