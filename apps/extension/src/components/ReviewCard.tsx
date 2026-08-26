import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ReviewSession, ReviewCard as Card } from '../lib/review/session';
import type { GradeResult } from '@vocably/core';
import type { Word } from '../lib/storage/types';
import { Icon } from './icons';
import { speak } from '../lib/tts';
import { shouldSuggestShelving } from '../lib/review/library';
import { diffChars } from '../lib/review/diff';
import { maskSpoilers } from '../lib/review/spoiler-mask';
import { useI18n } from '../lib/i18n';
import { isSpeechRecognitionSupported, listen, type VoiceListenHandle } from '../lib/voice/speech-recognition';

interface Props {
  session: ReviewSession;
  onFinished: () => void;
  /** Looks up (and caches) a definition/example for the just-answered word.
   *  Fetched only after grading, not before — reinforcement for a word
   *  you've already tried to recall, not a hint beforehand. */
  onLookupDictionary: (wordId: string) => Promise<Word>;
}

// Dumb view over an already-started ReviewSession. The session holds all the
// logic (which card, direction, grading, persistence); this only renders the
// current card, takes an answer, shows the verdict, then advances.
export function ReviewCard({ session, onFinished, onLookupDictionary }: Props) {
  const { t, tp } = useI18n();
  const [card, setCard] = useState<Card | null>(session.currentCard);
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<GradeResult | null>(null);
  const [done, setDone] = useState({ index: 0, total: session.total });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shelveSuggestionDismissed, setShelveSuggestionDismissed] = useState(false);
  const [shelving, setShelving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [dictInfo, setDictInfo] = useState<Word['dictionary']>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef<number>(Date.now());
  const voiceHandleRef = useRef<VoiceListenHandle | null>(null);
  /** Whether the CURRENT card's answer came from voice input — logged as
   *  the review's mode (see session.answer's `mode` param). Reset on every
   *  new card, not just on submit, so switching cards mid-listen doesn't
   *  leak a stale "voice" label onto a later typed answer. */
  const usedVoiceRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    startedAt.current = Date.now();
    usedVoiceRef.current = false;
    // A new card (including via shuffle) must stop any in-flight listening
    // from the PREVIOUS card — otherwise a late result could fill the new
    // card's input with an answer meant for a different word.
    voiceHandleRef.current?.stop();
    setListening(false);
    setVoiceError(null);
  }, [card]);

  useEffect(() => () => void voiceHandleRef.current?.stop(), []);

  // Fetches the example/definition only once the verdict is up — after the
  // user's already tried to recall the word, never as a hint beforehand.
  // Cached on the word itself (dictionaryFetchedAt), so this is a no-op
  // network-wise on every review after the first.
  useEffect(() => {
    if (!verdict) { setDictInfo(null); return; }
    const word = session.lastAnsweredWord;
    if (!word) return;
    if (word.dictionaryFetchedAt) { setDictInfo(word.dictionary); return; }
    let cancelled = false;
    onLookupDictionary(word.id)
      .then((updated) => { if (!cancelled) setDictInfo(updated.dictionary); })
      .catch(() => { if (!cancelled) setDictInfo(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict]);

  async function check() {
    if (!card || verdict || checking) return;
    setError(null);
    setChecking(true);
    const latencyMs = Date.now() - startedAt.current;
    try {
      const result = await session.answer(answer, { latencyMs }, new Date(), usedVoiceRef.current ? 'voice' : 'typing');
      setVerdict(result);
    } catch (err) {
      console.error(err, 'Error: while checking answer');
      setError(t('card.checkError'));
    } finally {
      setChecking(false);
    }
  }

  function next() {
    voiceHandleRef.current?.stop();
    setVerdict(null);
    setAnswer('');
    setError(null);
    setVoiceError(null);
    setShelveSuggestionDismissed(false);
    setDone((d) => ({ ...d, index: d.index + 1 }));
    if (session.isFinished) {
      onFinished();
      return;
    }
    setCard(session.currentCard);
  }

  /** Toggles speech-to-text for the answer box (Ctrl/Cmd+Shift+V, or the
   *  mic button). One listening turn ends itself on silence/a result — this
   *  only needs to handle the "cancel early" half explicitly. Fills the
   *  input with the transcript rather than auto-submitting: a misheard
   *  word should be as easy to fix as a typo, not force a wrong grade. */
  function toggleVoice() {
    if (verdict) return;
    if (listening) {
      voiceHandleRef.current?.stop();
      return;
    }
    setVoiceError(null);
    setListening(true);
    const langCode = card!.direction === 'forward' ? card!.langTo : card!.langFrom;
    voiceHandleRef.current = listen(langCode, {
      onResult: (transcript) => {
        if (transcript) {
          setAnswer(transcript);
          usedVoiceRef.current = true;
        }
      },
      onError: (code) => {
        setVoiceError(
          code === 'not-supported' ? t('card.voiceUnsupported')
          : code === 'not-allowed' ? t('card.voiceDenied')
          : t('card.voiceError'),
        );
      },
      onEnd: () => {
        setListening(false);
        voiceHandleRef.current = null;
      },
    });
  }

  /** The user is confident their answer was actually right — a typo the
   *  SRS's own tolerance didn't happen to cover, most often. Re-grades the
   *  just-shown verdict as correct in place; the card stays open so they
   *  can see the corrected verdict before moving on. */
  async function markCorrect() {
    if (marking) return;
    setMarking(true);
    try {
      const corrected = await session.markLastAnsweredCorrect(new Date());
      if (corrected) setVerdict(corrected);
    } finally {
      setMarking(false);
    }
  }

  /** The user agreed the struggling word is worth setting aside — shelve it
   *  and move on in one step, same as clicking Next/Finish. */
  async function shelveAndContinue() {
    setShelving(true);
    try {
      await session.shelveLastAnswered(new Date());
      next();
    } finally {
      setShelving(false);
    }
  }

  /** Swaps to a different due word — the skipped one isn't graded, it just
   *  comes back around later in this same session. */
  function shuffle() {
    if (verdict) return;
    session.shuffle();
    setAnswer('');
    setError(null);
    setCard(session.currentCard);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault(); // don't let it fall through and paste/insert 'v'
      toggleVoice();
      return;
    }
    if (e.key !== 'Enter') return;
    if (verdict) { next(); return; }
    if (answer.trim() && !checking) void check();
  }

  if (!card) {
    return (
      <div className="vf-card vf-card-empty">
        <p>{t('card.nothingDue')}</p>
        <button className="vf-card-btn" onClick={onFinished}>{t('card.close')}</button>
      </div>
    );
  }

  const verdictClass = verdict
    ? verdict.verdict === 'correct'
      ? 'vf-ok'
      : verdict.verdict === 'almost'
        ? 'vf-almost'
        : 'vf-wrong'
    : '';

  const lastAnswered = session.lastAnsweredWord;
  const suggestShelve = !!verdict && verdict.verdict !== 'correct' && !shelveSuggestionDismissed
    && !!lastAnswered && shouldSuggestShelving(lastAnswered);

  // The context sentence is captured verbatim from the page it was saved
  // on, so it very often contains the answer word itself — blank those
  // occurrences out until the word's been answered (or given up on).
  const ctxParts = useMemo(
    () => maskSpoilers(card.contextSentence, card.expected),
    [card.contextSentence, card.expected],
  );

  return (
    <div className={`vf-card ${verdictClass}`} onKeyDown={onKeyDown}>
      <div className="vf-card-top">
        <span className="vf-card-streak">{t('card.streak', { a: done.index + 1, b: done.total })}</span>
        <span className="vf-card-dir">{card.direction === 'forward' ? 'EN → RU' : 'RU → EN'}</span>
      </div>

      <div className="vf-card-prompt-row">
        <div className="vf-card-prompt">{card.prompt}</div>
        <button
          type="button"
          className="vf-speak-btn"
          onClick={() => speak(card.prompt, card.direction === 'forward' ? card.langFrom : card.langTo)}
          title={t('library.pronounce')}
          aria-label={t('library.pronounce')}
        >
          <Icon name="volume" size={16} />
        </button>
      </div>
      {card.contextSentence && (
        <div className="vf-card-ctx">
          {ctxParts.map((part, i) =>
            part.spoiler ? (
              <span key={i} className={`vf-ctx-spoiler ${verdict ? 'revealed' : ''}`} title={verdict ? undefined : t('card.spoilerHint')}>
                {part.text}
              </span>
            ) : (
              <React.Fragment key={i}>{part.text}</React.Fragment>
            ),
          )}
        </div>
      )}

      <div className="vf-card-input-row">
        <input
          ref={inputRef}
          className="vf-card-input"
          placeholder={
            listening ? t('card.listening')
            : card.direction === 'forward' ? t('card.translationPlaceholder')
            : t('card.originalPlaceholder')
          }
          value={answer}
          readOnly={!!verdict}
          // readOnly, not disabled: a disabled input blurs itself the instant
          // it's set (moving focus out of the card entirely, which the host
          // page's own keydown listeners are deliberately isolated from — see
          // suppressOuterListeners in content.ts), so the very next Enter
          // press to advance the card would go nowhere. readOnly blocks
          // edits without giving up focus.
          onChange={(e) => setAnswer(e.target.value)}
        />
        {!verdict && isSpeechRecognitionSupported() && (
          <button
            type="button"
            className={`vf-mic-btn ${listening ? 'listening' : ''}`}
            onClick={toggleVoice}
            title={t('card.voiceToggleTitle')}
            aria-label={t('card.voiceToggleTitle')}
          >
            <Icon name="mic" size={16} />
          </button>
        )}
      </div>
      {voiceError && <div className="vf-hint">{voiceError}</div>}

      {verdict && verdict.verdict !== 'correct' && (
        <div className="vf-diff" title={t('card.diffTitle')}>
          {diffChars(answer, verdict.matched ?? card.expected[0] ?? '').map((d, i) => (
            <span key={i} className={`vf-diff-char ${d.correct ? 'ok' : 'bad'}`}>{d.char}</span>
          ))}
        </div>
      )}

      {verdict && verdict.verdict === 'wrong' && (
        <button
          type="button"
          className="vf-mark-correct-btn"
          onClick={() => void markCorrect()}
          disabled={marking}
          title={t('card.markCorrectTitle')}
        >
          {marking ? t('card.marking') : t('card.markCorrect')}
        </button>
      )}

      {verdict ? (
        <div className="vf-card-feedback">
          <span className="vf-card-verdict">
            {verdict.verdict === 'correct'
              ? '+10 XP'
              : verdict.verdict === 'almost'
                ? t('card.almost')
                : t('card.answer')}
          </span>
          <span className="vf-card-answer">{card.expected.join(', ')}</span>
          <button
            type="button"
            className="vf-speak-btn"
            onClick={() => speak(card.expected[0]!, card.direction === 'forward' ? card.langTo : card.langFrom)}
            title={t('library.pronounce')}
            aria-label={t('library.pronounce')}
          >
            <Icon name="volume" size={14} />
          </button>
          <button className="vf-card-btn" onClick={next}>
            {session.remaining > 1 ? t('card.next') : t('card.finish')} {'\u2192'}
          </button>
        </div>
      ) : null}

      {verdict && dictInfo && (
        <div className="vf-dict">
          <span className="vf-dict-pos">{dictInfo.partOfSpeech}</span>
          <span className="vf-dict-text">{dictInfo.example ?? dictInfo.definition}</span>
        </div>
      )}

      {suggestShelve && (
        <div className="vf-shelve-suggest">
          <span>{t('card.struggling', { misses: tp('review.missCount', lastAnswered!.srsState.lapses) })}</span>
          <div className="vf-shelve-suggest-actions">
            <button
              className="vf-shelve-suggest-btn"
              onClick={() => void shelveAndContinue()}
              disabled={shelving}
            >
              {shelving ? t('card.shelving') : t('card.shelve')}
            </button>
            <button
              className="vf-shelve-suggest-dismiss"
              onClick={() => setShelveSuggestionDismissed(true)}
            >
              {t('card.notNow')}
            </button>
          </div>
        </div>
      )}

      {!verdict && (
        <>
          {error && <div className="vf-hint">{error}</div>}
          <div className="vf-card-actions">
            <button
              className="vf-card-btn-ghost"
              onClick={shuffle}
              disabled={!session.canShuffle}
              title={t('card.shuffleTitle')}
            >
              <Icon name="shuffle" size={13} /> {t('card.shuffle')}
            </button>
            <button className="vf-card-btn" onClick={check} disabled={!answer.trim() || checking}>
              {checking ? t('card.checking') : <>{t('card.check')} {'\u2192'}</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
