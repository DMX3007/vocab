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
import { SettingsStore } from '../lib/review/settings-store';

// A correct auto-submitted (voice mode) verdict lingers on screen this long
// before auto-advancing — long enough to register "+10 XP" actually
// happened, short enough that hands-free review still feels continuous. A
// WRONG verdict never auto-advances at all (see submitAnswer) — the whole
// point of stopping there is to make the user look at the mistake.
const VOICE_AUTO_ADVANCE_DELAY_MS = 900;

const settingsStore = new SettingsStore(browser.storage.local);

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
  /** Hands-free mode (OverlaySettings.voiceReviewEnabled) — a value shared
   *  with the popup's Review tab via chrome.storage, not local UI state:
   *  toggling it here must show up there and vice versa. Loaded once and
   *  kept live via subscribe() so flipping it from the popup mid-review
   *  takes effect on the very next card without needing to reopen anything. */
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef<number>(Date.now());
  const voiceHandleRef = useRef<VoiceListenHandle | null>(null);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the CURRENT card's answer came from voice input — logged as
   *  the review's mode (see session.answer's `mode` param). Reset on every
   *  new card, not just on submit, so switching cards mid-listen doesn't
   *  leak a stale "voice" label onto a later typed answer. */
  const usedVoiceRef = useRef(false);

  useEffect(() => {
    void settingsStore.load().then((s) => setVoiceModeEnabled(s.voiceReviewEnabled));
    settingsStore.subscribe((s) => setVoiceModeEnabled(s.voiceReviewEnabled));
    // No unsubscribe: StorageArea.onChanged has no removeListener in this
    // app's shared interface (see settings-store.ts) — matches every other
    // long-lived subscribe() in this codebase (e.g. content.ts's own).
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    startedAt.current = Date.now();
    usedVoiceRef.current = false;
    // A new card (including via shuffle) must stop any in-flight listening
    // AND cancel any pending auto-advance from the PREVIOUS card — otherwise
    // a late result/timer could fill in or skip past an answer meant for a
    // different word.
    voiceHandleRef.current?.stop();
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    setListening(false);
    setVoiceError(null);
  }, [card]);

  // Deliberately a SEPARATE effect from the per-card reset above, keyed on
  // BOTH card and voiceModeEnabled — not folded into the reset effect above
  // (which only depends on `card`). Two real timing gaps that fix depends
  // on: (1) voiceModeEnabled loads from storage ASYNCHRONOUSLY, well after
  // the first card's own [card] effect has already run once with its
  // stale initial `false` — since a real session only ever shows ONE card
  // (maxCards: 1), that effect would never get a second chance to see the
  // loaded value. (2) toggling the mode ON from the popup mid-review, with
  // a card already open, must arm THAT card immediately, not wait for a
  // next one that (per (1)) may never come. Re-running whenever either
  // value changes covers both: startListening() itself is a safe no-op if
  // a turn's already in flight or a verdict's already showing.
  useEffect(() => {
    if (voiceModeEnabled && card && !verdict) startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, voiceModeEnabled]);

  useEffect(() => () => {
    voiceHandleRef.current?.stop();
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
  }, []);

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

  /** Grades `text` and shows the verdict. Shared by the manual Check button
   *  (reads the typed `answer` state) and voice auto-submit (passes the
   *  fresh transcript directly, since it can't wait for React state to
   *  catch up within the same tick). A CORRECT verdict in voice mode
   *  auto-advances after a beat (see VOICE_AUTO_ADVANCE_DELAY_MS) — anything
   *  else (wrong OR almost) stops here regardless of mode: the whole point
   *  of hands-free review is speed on the easy cards, never at the cost of
   *  skipping past a mistake before the user's actually seen it. */
  async function submitAnswer(text: string, mode: 'typing' | 'voice') {
    if (!card || verdict || checking) return;
    setError(null);
    setChecking(true);
    const latencyMs = Date.now() - startedAt.current;
    try {
      const result = await session.answer(text, { latencyMs }, new Date(), mode);
      setVerdict(result);
      if (mode === 'voice' && result.verdict === 'correct') {
        autoAdvanceTimerRef.current = setTimeout(next, VOICE_AUTO_ADVANCE_DELAY_MS);
      }
    } catch (err) {
      console.error(err, 'Error: while checking answer');
      setError(t('card.checkError'));
    } finally {
      setChecking(false);
    }
  }

  function check() {
    if (!answer.trim() || checking) return;
    void submitAnswer(answer, usedVoiceRef.current ? 'voice' : 'typing');
  }

  function next() {
    voiceHandleRef.current?.stop();
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
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

  /** Starts one listening turn — called automatically for every new card
   *  while voice mode is on, and manually when turning the mode on mid-card
   *  (see toggleVoiceMode). A result auto-submits straight away rather than
   *  just filling the box: that's the whole difference between "voice
   *  mode" and the old one-shot mic button (see submitAnswer for what
   *  happens next depending on the verdict). */
  function startListening() {
    if (verdict || listening) return;
    setVoiceError(null);
    setListening(true);
    const langCode = card!.direction === 'forward' ? card!.langTo : card!.langFrom;
    voiceHandleRef.current = listen(langCode, {
      onResult: (transcript) => {
        if (!transcript) return;
        setAnswer(transcript);
        usedVoiceRef.current = true;
        void submitAnswer(transcript, 'voice');
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

  /** The mic button / Ctrl-Shift-V shortcut now toggles the PERSISTENT
   *  voice-mode setting (shared with the popup's Review tab), not just
   *  this one card's listening — turning it on arms the card on screen;
   *  turning it off stops whatever's in flight and every future card goes
   *  back to normal typing. Deliberately does NOT call startListening()
   *  itself when turning on — the [card, voiceModeEnabled] effect above
   *  already reacts to this same setVoiceModeEnabled and does that, and
   *  calling it from both places risked two overlapping recognition
   *  sessions racing on stale `listening` closures. */
  async function toggleVoiceMode() {
    const enabled = !voiceModeEnabled;
    setVoiceModeEnabled(enabled); // optimistic — settingsStore.subscribe will confirm it right behind this
    await settingsStore.update((s) => ({ ...s, voiceReviewEnabled: enabled }));
    if (!enabled) {
      voiceHandleRef.current?.stop();
    }
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
      void toggleVoiceMode();
      return;
    }
    if (e.key !== 'Enter') return;
    if (verdict) { next(); return; }
    check();
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
            className={`vf-mic-btn ${voiceModeEnabled ? 'enabled' : ''} ${listening ? 'listening' : ''}`}
            onClick={() => void toggleVoiceMode()}
            title={t('card.voiceToggleTitle')}
            aria-label={t('card.voiceToggleTitle')}
            aria-pressed={voiceModeEnabled}
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
