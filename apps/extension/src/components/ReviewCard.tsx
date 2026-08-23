import React, { useState, useRef, useEffect } from 'react';
import type { ReviewSession, ReviewCard as Card } from '../lib/review/session';
import type { GradeResult } from '@vocably/core';
import type { Word } from '../lib/storage/types';
import { Icon } from './icons';
import { speak } from '../lib/tts';
import { shouldSuggestShelving } from '../lib/review/library';
import { diffChars } from '../lib/review/diff';
import { useI18n } from '../lib/i18n';

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
  const [dictInfo, setDictInfo] = useState<Word['dictionary']>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    inputRef.current?.focus();
    startedAt.current = Date.now();
  }, [card]);

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
      const result = await session.answer(answer, { latencyMs }, new Date());
      setVerdict(result);
    } catch (err) {
      console.error(err, 'Error: while checking answer');
      setError(t('card.checkError'));
    } finally {
      setChecking(false);
    }
  }

  function next() {
    setVerdict(null);
    setAnswer('');
    setError(null);
    setShelveSuggestionDismissed(false);
    setDone((d) => ({ ...d, index: d.index + 1 }));
    if (session.isFinished) {
      onFinished();
      return;
    }
    setCard(session.currentCard);
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
    if (e.key === 'Enter') verdict ? next() : check();
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
      {card.contextSentence && <div className="vf-card-ctx">{card.contextSentence}</div>}

      <input
        ref={inputRef}
        className="vf-card-input"
        placeholder={card.direction === 'forward' ? t('card.translationPlaceholder') : t('card.originalPlaceholder')}
        value={answer}
        disabled={!!verdict}
        onChange={(e) => setAnswer(e.target.value)}
      />

      {verdict && verdict.verdict !== 'correct' && (
        <div className="vf-diff" title={t('card.diffTitle')}>
          {diffChars(answer, verdict.matched ?? card.expected[0] ?? '').map((d, i) => (
            <span key={i} className={`vf-diff-char ${d.correct ? 'ok' : 'bad'}`}>{d.char}</span>
          ))}
        </div>
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
