import { PracticeCard } from './PracticeCard';
import { useI18n } from '../lib/i18n';

// PRACTICE MODE — the same dimmed full-page treatment ReviewOverlay uses, so
// practising and reviewing feel like two modes of one thing rather than two
// different apps. Rendered into a Shadow DOM by the content script.
//
// Fewer controls than ReviewOverlay on purpose: snooze / pause / disable-site
// exist because the review overlay INTERRUPTS you. Practice is something you
// opened yourself, so the only thing to offer is closing it.

interface Props {
  targetLang: string;
  onClose: () => void;
}

export function PracticeOverlay({ targetLang, onClose }: Props) {
  const { t } = useI18n();
  return (
    <div className="vf-ov-backdrop">
      <div className="vf-ov-card">
        <PracticeCard targetLang={targetLang} onClose={onClose} />
        <div className="vf-ov-controls">
          <button className="vf-ov-link" onClick={onClose}>{t('practice.exit')}</button>
        </div>
      </div>
    </div>
  );
}
