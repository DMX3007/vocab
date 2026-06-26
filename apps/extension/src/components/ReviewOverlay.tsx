import React, { useState } from 'react';
import { ReviewCard } from './ReviewCard';
import type { ReviewSession } from '../lib/review/session';
import type { PausePreset } from '../lib/review/overlay-policy';

interface Props {
  session: ReviewSession;
  host: string;
  onClose: () => void;
  onSnooze: () => void;
  onPause: (preset: PausePreset) => void;
  onDisableSite: () => void;
}

// The full-page review overlay: a dimmed backdrop with the review card
// centered, plus the "leave me alone" controls (snooze / pause / disable
// on this site). Rendered into a Shadow DOM by the content script so the
// host page can't style or break it.
export function ReviewOverlay({ session, host, onClose, onSnooze, onPause, onDisableSite }: Props) {
  const [showPause, setShowPause] = useState(false);

  return (
    <div className="vf-ov-backdrop">
      <div className="vf-ov-card">
        <ReviewCard session={session} onFinished={onClose} />

        <div className="vf-ov-controls">
          <button className="vf-ov-link" onClick={onSnooze}>Later (15 min)</button>

          <div className="vf-ov-pause">
            <button className="vf-ov-link" onClick={() => setShowPause((v) => !v)}>
              Pause {'\u25be'}
            </button>
            {showPause && (
              <div className="vf-ov-menu">
                <button onClick={() => onPause('15m')}>15 minutes</button>
                <button onClick={() => onPause('1h')}>1 hour</button>
                <button onClick={() => onPause('tomorrow')}>Until tomorrow</button>
              </div>
            )}
          </div>

          <button className="vf-ov-link" onClick={onDisableSite} title={`Never on ${host}`}>
            Disable on {host}
          </button>
        </div>
      </div>
    </div>
  );
}
