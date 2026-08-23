import React from 'react';
import { useI18n } from '../lib/i18n';

interface Props {
  onClick: () => void;
}

// Quiet dashed chip left behind when the user skips a selection instead of
// saving it. Clicking it brings the add-to-dictionary trigger back.
export default function SkippedChip({ onClick }: Props) {
  const { t } = useI18n();
  return (
    <button className="vfst-ghost" onClick={onClick} title={t('chip.showAgain')}>
      <span className="vfst-ghost-dot" /> {t('chip.skipped')}
    </button>
  );
}
