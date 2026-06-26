import React, { useState, useRef, useEffect } from 'react';
import type { ReviewSession, ReviewCard as Card } from '../lib/review/session';
import type { GradeResult } from '@vocabflow/core';

interface Props {
  session: ReviewSession;
  onFinished: () => void;
}

// Dumb view over an already-started ReviewSession. The session holds all the
// logic (which card, direction, grading, persistence); this only renders the
// current card, takes an answer, shows the verdict, then advances.
export function ReviewCard({ session, onFinished }: Props) {
  const [card, setCard] = useState<Card | null>(session.currentCard);
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<GradeResult | null>(null);
  const [done, setDone] = useState({ index: 0, total: session.total });
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    inputRef.current?.focus();
    startedAt.current = Date.now();
  }, [card]);

  async function check() {
    if (!card || verdict) return;
    const latencyMs = Date.now() - startedAt.current;
    try {
      const result = await session.answer(answer, { latencyMs }, new Date());
      setVerdict(result);
    } catch (error) {
      console.error(error, 'Error: while checking answer') // TODO: show user correct user error
    }
  }

  function next() {
    setVerdict(null);
    setAnswer('');
    setDone((d) => ({ ...d, index: d.index + 1 }));
    if (session.isFinished) {
      onFinished();
      return;
    }
    setCard(session.currentCard);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') verdict ? next() : check();
  }

  if (!card) {
    return (
      <div className="vf-card vf-card-empty">
        <p>Nothing due right now. Come back later.</p>
        <button className="vf-card-btn" onClick={onFinished}>Close</button>
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

  return (
    <div className={`vf-card ${verdictClass}`} onKeyDown={onKeyDown}>
      <div className="vf-card-top">
        <span className="vf-card-streak">Streak {'\u00b7'} {done.index + 1} / {done.total}</span>
        <span className="vf-card-dir">{card.direction === 'forward' ? 'EN' : 'RU'}</span>
      </div>

      <div className="vf-card-prompt">{card.prompt}</div>
      {card.contextSentence && <div className="vf-card-ctx">{card.contextSentence}</div>}

      <input
        ref={inputRef}
        className="vf-card-input"
        placeholder="Type the translation..."
        value={answer}
        disabled={!!verdict}
        onChange={(e) => setAnswer(e.target.value)}
      />

      {verdict ? (
        <div className="vf-card-feedback">
          <span className="vf-card-verdict">
            {verdict.verdict === 'correct'
              ? '+10 XP'
              : verdict.verdict === 'almost'
                ? 'Almost!'
                : 'Answer:'}
          </span>
          <span className="vf-card-answer">{card.expected.join(', ')}</span>
          <button className="vf-card-btn" onClick={next}>
            {session.remaining > 1 ? 'Next' : 'Finish'} {'\u2192'}
          </button>
        </div>
      ) : (
        <div className="vf-card-actions">
          <button className="vf-card-btn" onClick={check} disabled={!answer.trim()}>
            Check {'\u2192'}
          </button>
        </div>
      )}
    </div>
  );
}
