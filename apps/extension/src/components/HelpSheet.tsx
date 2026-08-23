import React from 'react';
import { Icon } from './icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TIP_KEYS: TranslationKey[] = ['help.tip1', 'help.tip2', 'help.tip3', 'help.tip4', 'help.tip5'];

// A lightweight "how this app works" sheet, opened from the header's Help
// button. Reuses the same scrim/sheet chrome as the Add Word modal.
export function HelpSheet({ open, onClose }: Props) {
  const { t } = useI18n();
  return (
    <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">{t('help.howItWorks')}</div>
        <div className="sheet-sub">{t('help.quickTour')}</div>

        <div className="tips">
          {TIP_KEYS.map((key, i) => (
            <div className="tip-item" key={key}>
              <div className="num">{i + 1}</div>
              <div>{t(key)}</div>
            </div>
          ))}
        </div>

        <button className="btn-primary" onClick={onClose}>
          <Icon name="check" size={14} /> {t('help.gotIt')}
        </button>
      </div>
    </div>
  );
}
