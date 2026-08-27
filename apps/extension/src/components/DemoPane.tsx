// DEMO MODE — experimental, isolated. See src/lib/demo/prompt-api.ts's
// header for how to remove the whole feature.
//
// A vocabulary ACTIVATION drill, deliberately outside the SRS: Chrome's
// on-device model writes a short ENGLISH phrase built from words in your
// library, you render it in your target language by voice or keyboard, and
// the extension reads your answer back. Nothing is graded and nothing is
// written to any word's scheduling state — the point is producing language,
// not being measured. That's also why it lives here in the popup rather
// than the on-page overlay: it touches none of the review machinery, and
// an extension page gets microphone permission once instead of per-site.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useI18n } from '../lib/i18n';
import { speak } from '../lib/tts';
import { isSpeechRecognitionSupported, listen, type VoiceListenHandle } from '../lib/voice/speech-recognition';
import type { Word } from '../lib/storage/types';
import {
  checkAvailability,
  createSession,
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

  // Which side of the pair the learner produces vs. reads.
  const answerLang = direction === 'english' ? LEARNING_LANG : targetLang;
  const promptLang = direction === 'english' ? targetLang : LEARNING_LANG;

  const sessionRef = useRef<DemoSession | null>(null);
  const voiceRef = useRef<VoiceListenHandle | null>(null);

  useEffect(() => {
    void checkAvailability().then(setAvailability);
    return () => {
      sessionRef.current?.destroy();
      voiceRef.current?.stop();
    };
  }, []);

  /** One session is reused across drills — creating it is what triggers the
   *  one-time model download, so doing it per phrase would be wasteful. */
  const getSession = useCallback(async (): Promise<DemoSession> => {
    if (sessionRef.current) return sessionRef.current;
    const session = await createSession(SYSTEM_PROMPT, {
      onDownloadProgress: (loaded) => setDownloadPct(Math.round(loaded * 100)),
    });
    sessionRef.current = session;
    setDownloadPct(null);
    setAvailability('available');
    return session;
  }, []);

  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setAnswer('');
    setSubmitted(false);
    setDrill(null);
    try {
      const picked = pickDrillWords(words, difficulty);
      const terms = picked.map((w) => w.term);
      const session = await getSession();
      const targetLabel = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang;
      const raw = await session.prompt(buildDrillPrompt(terms, difficulty, targetLabel));
      const parsed = parseGeneratedPhrase(raw);
      if (!parsed.english) throw new Error('empty');
      setDrill({ ...parsed, terms });
    } catch (err) {
      console.error(err, 'Error: demo drill generation');
      setError(t('demo.generateError'));
    } finally {
      setGenerating(false);
    }
  }, [generating, words, difficulty, targetLang, getSession, t]);

  function toggleVoice() {
    if (listening) { voiceRef.current?.stop(); return; }
    setListening(true);
    voiceRef.current = listen(answerLang, {
      onResult: (transcript) => { if (transcript) setAnswer(transcript); },
      onError: () => setError(t('demo.voiceError')),
      onEnd: () => { setListening(false); voiceRef.current = null; },
    });
  }

  /** Submitting is purely "I'm done saying it" — nothing is graded. The
   *  answer is read back in the target language so the user hears their own
   *  production, which is the only feedback this mode offers by design. */
  function submit() {
    if (!answer.trim() || submitted) return;
    voiceRef.current?.stop();
    setSubmitted(true);
    speak(answer, answerLang);
  }

  function onKeyDown(e: React.KeyboardEvent) {
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
              {direction === 'english' ? (drill.translated ?? drill.english) : drill.english}
            </div>
            <button
              type="button"
              className="vf-speak-btn"
              onClick={() => speak(direction === 'english' ? (drill.translated ?? drill.english) : drill.english, promptLang)}
              title={t('library.pronounce')}
              aria-label={t('library.pronounce')}
            >
              <Icon name="volume" size={16} />
            </button>
          </div>
          {direction === 'english' && !drill.translated && (
            <div className="demo-note">{t('demo.noTranslation')}</div>
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
                className={`vf-mic-btn ${listening ? 'listening' : ''}`}
                onClick={toggleVoice}
                title={t('demo.speakTitle')}
                aria-label={t('demo.speakTitle')}
              >
                <Icon name="mic" size={16} />
              </button>
            )}
          </div>

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
                  onClick={() => speak(answer, targetLang)}
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
