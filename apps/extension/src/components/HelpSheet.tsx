import React from 'react';
import { Icon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TIPS = [
  'Select any word or phrase on a page — a small trigger appears so you can add it to your dictionary, or skip it.',
  'Words you save get reviewed on a spaced schedule: often at first, less often once you know them well.',
  'Reviews quiz you both ways — sometimes showing the English word, sometimes the translation — so the direction indicator (EN → RU / RU → EN) tells you which one to type back.',
  'In Library, tap Add word for a manual entry, a pasted list, or an import from a public Google Sheet.',
  'Progress tracks your streak, accuracy, and achievements as you review.',
];

// A lightweight "how this app works" sheet, opened from the header's Help
// button. Reuses the same scrim/sheet chrome as the Add Word modal.
export function HelpSheet({ open, onClose }: Props) {
  return (
    <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">How VocabFlow works</div>
        <div className="sheet-sub">A quick tour, any time you need it.</div>

        <div className="tips">
          {TIPS.map((tip, i) => (
            <div className="tip-item" key={i}>
              <div className="num">{i + 1}</div>
              <div>{tip}</div>
            </div>
          ))}
        </div>

        <button className="btn-primary" onClick={onClose}>
          <Icon name="check" size={14} /> Got it
        </button>
      </div>
    </div>
  );
}
