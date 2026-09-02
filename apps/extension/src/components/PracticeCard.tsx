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
import { SUPPORTED_LANGUAGES } from '../lib/languages';
import { wordClient } from '../lib/messaging/client';
import type { PracticeDrill } from '../lib/messaging/protocol';
import type { ModelAvailability } from '../lib/practice/prompt-api';
import { findLocalHint, tokenizePhrase, type DrillDifficulty, type DrillDirection } from '../lib/practice/drill';

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
  /** Words the user tapped in the prompt, lowercased, mapped to what they
   *  mean. A null value means "looked it up and found nothing" — kept as a
   *  key so the word doesn't look unclicked and invite endless retries. */
  const [hints, setHints] = useState<Record<string, string | null>>({});

  const answerLang = direction === 'english' ? LEARNING_LANG : targetLang;
  const promptLang = direction === 'english' ? targetLang : LEARNING_LANG;
  // Named by the actual language rather than "target"/"English" labels —
  // "target" is jargon, and it means the opposite of what a learner assumes
  // (see DrillDirection). Buttons read "English" / "Русский".
  const targetLangLabel = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang;
  const answerLangLabel = direction === 'english' ? t('practice.langEnglish') : targetLangLabel;

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
    setHints({}); // a new phrase starts with nothing revealed
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

  /** Submitting is purely "I'm done saying it" — nothing is graded.
   *
   *  What gets read aloud is the GENERATED phrase, never the user's own
   *  words. Speaking your own sentence back teaches nothing: a transcript of
   *  what you already said (or worse, what the recognizer mis-heard) is not
   *  a model to compare yourself against. The version worth hearing is the
   *  one you were producing toward. */
  function submitAnswer(text: string) {
    if (!text.trim() || submittedRef.current) return;
    submittedRef.current = true;
    turnRef.current += 1;
    voiceRef.current?.stop();
    setListening(false);
    setSubmitted(true);
    if (referenceText) speak(referenceText, answerLang);
  }

  /** Reveals what one word of the prompt means.
   *
   *  The drill's own word pairs are consulted first: they come from the
   *  user's library, so they're free and correct by construction. Only a
   *  word from outside that set costs a provider call. */
  async function revealWord(word: string) {
    const key = word.toLowerCase();
    if (key in hints || !drill) return; // already shown, or nothing to look up

    const pairs = drill.terms.map((term, i) => ({ term, cue: drill.cues[i] ?? term }));
    const local = findLocalHint(word, pairs);
    if (local) {
      setHints((h) => ({ ...h, [key]: local }));
      return;
    }
    // Optimistically mark it as being looked up so a second tap can't fire
    // a duplicate request while this one is in flight.
    setHints((h) => ({ ...h, [key]: null }));
    try {
      const translated = await wordClient.translate(word, promptLang, answerLang);
      if (translated.trim()) setHints((h) => ({ ...h, [key]: translated.trim() }));
    } catch {
      // Leaves the null already set — shown as "no translation found",
      // which is the honest outcome and stops it being retried forever.
    }
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
  /** The generated phrase in the language the user was asked to produce —
   *  the reference to hear and read after answering. Null when the model
   *  side of that pair is missing (see resolveTranslation), in which case
   *  there is simply nothing to compare against and nothing is spoken. */
  const referenceText = drill
    ? (direction === 'english' ? drill.english : drill.translated)
    : null;

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
      </div>

      {/* Two labelled groups rather than one undifferentiated strip of four
          buttons: without the labels there was no way to tell which pair did
          what, and they read as decoration rather than controls. */}
      <div className="vf-practice-controls">
        <div className="vf-practice-control">
          <span className="vf-practice-control-label">{t('practice.iWriteIn')}</span>
          <div className="vf-practice-seg">
            {(['english', 'target'] as const).map((d) => (
              <button
                key={d}
                className={`vf-practice-toggle ${direction === d ? 'active' : ''}`}
                onClick={() => setDirection(d)}
                title={t('practice.directionHint')}
              >
                {d === 'english' ? t('practice.langEnglish') : targetLangLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="vf-practice-control">
          <span className="vf-practice-control-label">{t('practice.lengthLabel')}</span>
          <div className="vf-practice-seg">
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
      </div>

      {!drill && (
        <div className="vf-practice-intro">
          <p className="vf-card-prompt">{t('practice.introTitle')}</p>
          <ol className="vf-practice-steps">
            <li>{t('practice.step1')}</li>
            <li>{t('practice.step2', { lang: answerLangLabel })}</li>
            <li>{t('practice.step3')}</li>
          </ol>
          {availability === 'downloadable' && (
            <p className="vf-card-ctx">{t('practice.firstRunNote')}</p>
          )}
        </div>
      )}

      {drill && (
        <>
          <div className="vf-practice-phrase-row">
            {/* Every word is a button: this mode is ungraded, so a hint is
                the point rather than a leak. Stuck on one word shouldn't
                mean abandoning the whole phrase. */}
            <div className="vf-card-prompt vf-practice-phrase">
              {tokenizePhrase(promptText).map((token, i) => (
                token.isWord ? (
                  <button
                    key={i}
                    type="button"
                    className={`vf-practice-word ${hints[token.text.toLowerCase()] ? 'revealed' : ''}`}
                    onClick={() => void revealWord(token.text)}
                    title={t('practice.wordHintTitle')}
                  >
                    {token.text}
                  </button>
                ) : (
                  <span key={i}>{token.text}</span>
                )
              ))}
            </div>
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
            <div className="vf-card-ctx">{t('practice.cueFallback')}</div>
          )}
          {Object.keys(hints).length > 0 && (
            <div className="vf-practice-hints">
              {Object.entries(hints).map(([word, hint]) => (
                <span key={word} className="vf-practice-hint">
                  <span className="vf-practice-hint-src">{word}</span>
                  {' → '}
                  {hint ?? t('practice.wordHintNone')}
                </span>
              ))}
            </div>
          )}

          <div className="vf-practice-terms">
            <span className="vf-practice-terms-label">{t('practice.builtFrom')}</span>
            {drill.terms.join(' · ')}
          </div>
          <div className="vf-practice-task">{t('practice.taskHint', { lang: answerLangLabel })}</div>

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

          {submitted && referenceText && (
            <div className="vf-practice-reference">
              <div className="vf-practice-reference-label">{t('practice.referenceLabel')}</div>
              <div className="vf-practice-reference-row">
                <span>{referenceText}</span>
                <button
                  type="button"
                  className="vf-speak-btn"
                  onClick={() => speak(referenceText, answerLang)}
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

      {/* Its own class rather than .vf-card-actions: that rule ends in
          `.vf-card-btn { margin-left: auto }`, which is fine for the review
          card's single button but shoves two apart into opposite corners. */}
      <div className="vf-practice-actions">
        {drill && submitted && referenceText && (
          <button
            type="button"
            className="vf-card-btn-ghost"
            onClick={() => speak(referenceText, answerLang)}
            title={t('practice.replay')}
          >
            <Icon name="volume" size={13} /> {t('practice.replay')}
          </button>
        )}
        <div className="vf-practice-actions-main">
          {drill && !submitted && (
            <button className="vf-card-btn" onClick={() => submitAnswer(answer)} disabled={!answer.trim()}>
              {t('practice.submit')}
            </button>
          )}
          <button
            className={drill && !submitted ? 'vf-card-btn-ghost' : 'vf-card-btn'}
            onClick={() => void generate()}
            disabled={generating}
          >
            {generating ? t('practice.generating') : drill ? t('practice.another') : t('practice.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
