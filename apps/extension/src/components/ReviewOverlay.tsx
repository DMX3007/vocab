import React, { useState } from 'react';
import { ReviewCard } from './ReviewCard';
import type { ReviewSession } from '../lib/review/session';
import type { PausePreset } from '../lib/review/overlay-policy';
import type { Word } from '../lib/storage/types';
import { useI18n } from '../lib/i18n';

interface Props {
  session: ReviewSession;
  host: string;
  onClose: () => void;
  onSnooze: () => void;
  onPause: (preset: PausePreset) => void;
  onDisableSite: () => void;
  onLookupDictionary: (wordId: string) => Promise<Word>;
}

// The full-page review overlay: a dimmed backdrop with the review card
// centered, plus the "leave me alone" controls (snooze / pause / disable
// on this site). Rendered into a Shadow DOM by the content script so the
// host page can't style or break it.
export function ReviewOverlay({ session, host, onClose, onSnooze, onPause, onDisableSite, onLookupDictionary }: Props) {
  const { t } = useI18n();
  const [showPause, setShowPause] = useState(false);

  return (
    <div className="vf-ov-backdrop">
      <div className="vf-ov-card">
        <ReviewCard session={session} onFinished={onClose} onLookupDictionary={onLookupDictionary} />

        <div className="vf-ov-controls">
          <button className="vf-ov-link" onClick={onSnooze}>{t('overlay.later')}</button>

          <div className="vf-ov-pause">
            <button className="vf-ov-link" onClick={() => setShowPause((v) => !v)}>
              {t('overlay.pause')} {'▾'}
            </button>
            {showPause && (
              <div className="vf-ov-menu">
                <button onClick={() => onPause('15m')}>{t('overlay.pause15m')}</button>
                <button onClick={() => onPause('1h')}>{t('overlay.pause1h')}</button>
                <button onClick={() => onPause('tomorrow')}>{t('overlay.pauseTomorrow')}</button>
              </div>
            )}
          </div>

          <button className="vf-ov-link" onClick={onDisableSite} title={t('overlay.neverOnHost', { host })}>
            {t('overlay.disableOnHost', { host })}
          </button>
        </div>
      </div>
    </div>
  );
}
