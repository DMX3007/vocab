import React, { useState } from 'react';
import { Icon } from './icons';
import type { Word } from '../lib/storage/types';

export type PlanState = 'beta' | 'free' | 'premium';

// Mirrors apps/api's PLANS.free.maxWords (see plans.config.ts). Duplicated as
// a plain number here rather than importing the NestJS package into the
// extension bundle — this tab is presentational only; nothing here is
// actually enforced yet, so a real backend can adopt this seam later.
const FREE_WORD_CAP = 500;

interface Props {
  words: Word[];
  planState: PlanState;
  onPlanState: (state: PlanState) => void;
}

// Plan tab — three states, matching the approved redesign. Nothing here is
// enforced: "Get Premium" / "Activate" just flip the locally-stored
// planState so the UI can be demoed end-to-end ahead of real billing.
export function PlanPane({ words, planState, onPlanState }: Props) {
  if (planState === 'premium') return <PremiumActiveView onPlanState={onPlanState} />;
  if (planState === 'free') return <UpgradeView words={words} onPlanState={onPlanState} />;
  return <BetaView onPlanState={onPlanState} />;
}

function BetaView({ onPlanState }: { onPlanState: (s: PlanState) => void }) {
  return (
    <div className="plan-pane">
      <div className="info-card info-tip">
        <h4>Beta access</h4>
        <div className="beta-line">
          <span className="serif-italic">All features unlocked.</span>
          <span> No word cap, for now.</span>
        </div>
        <button className="link-btn" onClick={() => onPlanState('free')}>
          Preview the post-beta plan →
        </button>
      </div>

      <div className="info-card">
        <h4>Current algorithm</h4>
        <div className="name">SM-2 (SuperMemo)</div>
        <p>Classic SuperMemo-2 algorithm. Reviews are spaced using an ease factor updated after each answer.</p>
      </div>

      <div className="tips">
        <h4>Tips for faster learning</h4>
        <div className="tip-item"><div className="num">1</div><div>Review in the morning — retention is higher after sleep.</div></div>
        <div className="tip-item"><div className="num">2</div><div>Say the word aloud when reviewing.</div></div>
        <div className="tip-item"><div className="num">3</div><div>Save words in context — a sentence beats a single word.</div></div>
      </div>

      <div className="plan-foot">Preview state {'·'} <button className="link-btn inline" onClick={() => onPlanState('premium')}>Premium active</button></div>
    </div>
  );
}

function UpgradeView({ words, onPlanState }: { words: Word[]; onPlanState: (s: PlanState) => void }) {
  const [billing, setBilling] = useState<'year' | 'lifetime'>('year');
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseMsg, setLicenseMsg] = useState<null | string | { ok: boolean; text: string }>(null);
  const used = words.length;
  const pct = Math.min(100, Math.round((used / FREE_WORD_CAP) * 100));
  const nearCap = used >= FREE_WORD_CAP * 0.8;

  const features = [
    { free: `${FREE_WORD_CAP} words max`, pro: 'Unlimited words' },
    { free: 'Fixed review schedule', pro: 'Custom review interval' },
    { free: 'SM-2 only', pro: 'FSRS · Leitner · more' },
    { free: 'Typed review only', pro: 'Card flip · voice review' },
  ];

  const price = billing === 'year'
    ? { amount: '$19', suffix: '/ year', note: 'billed annually' }
    : { amount: '$49', suffix: 'once', note: 'lifetime · all future updates' };

  function tryActivate() {
    setLicenseMsg('Validating…');
    setTimeout(() => {
      if (licenseKey.replace(/-/g, '').length >= 12) {
        setLicenseMsg({ ok: true, text: 'License accepted. Welcome to Premium.' });
        setTimeout(() => onPlanState('premium'), 900);
      } else {
        setLicenseMsg({ ok: false, text: "That key doesn't look right. Check the format XXXX-XXXX-XXXX-XXXX." });
      }
    }, 500);
  }

  return (
    <div className="plan-pane">
      <div className="pricing-card">
        <div className="pricing-head">
          <div>
            <div className="overline">VocabFlow</div>
            <div className="pricing-name">Premium</div>
          </div>
          <div className="pricing-price">
            <div className="amount">{price.amount}<span className="suffix">{price.suffix}</span></div>
            <div className="price-note">{price.note}</div>
          </div>
        </div>

        <div className="billing-toggle" role="tablist">
          <button role="tab" aria-selected={billing === 'year'} className={`bt-opt ${billing === 'year' ? 'on' : ''}`} onClick={() => setBilling('year')}>
            Yearly
          </button>
          <button role="tab" aria-selected={billing === 'lifetime'} className={`bt-opt ${billing === 'lifetime' ? 'on' : ''}`} onClick={() => setBilling('lifetime')}>
            Lifetime <span className="bt-tag">save 60%</span>
          </button>
        </div>

        <button className="cta-btn" onClick={() => onPlanState('premium')}>
          <span>Get Premium</span>
          <span className="cta-arrow">→</span>
        </button>
      </div>

      <div className={`quota-strip ${nearCap ? 'warn' : ''}`}>
        <div className="quota-row">
          <span className="quota-label">Your library</span>
          <span className="quota-count"><strong>{used}</strong> <span className="muted">/ {FREE_WORD_CAP}</span></span>
        </div>
        <div className="quota-track"><div className="quota-fill" style={{ width: `${pct}%` }} /></div>
        {nearCap && <div className="quota-msg">You&rsquo;re near the free cap. After {FREE_WORD_CAP}, new words pause until you upgrade.</div>}
      </div>

      <div className="features">
        <div className="features-head">
          <div />
          <div className="features-h-col free">Free</div>
          <div className="features-h-col pro">Premium</div>
        </div>
        {features.map((f, i) => (
          <div className="feature-row" key={i}>
            <div className="feature-num">{String(i + 1).padStart(2, '0')}</div>
            <div className="feature-cell free"><Icon name="close" size={11} /><span>{f.free}</span></div>
            <div className="feature-cell pro"><Icon name="check" size={11} /><span>{f.pro}</span></div>
          </div>
        ))}
      </div>

      <div className="license-block">
        <button className="license-toggle" aria-expanded={licenseOpen} onClick={() => setLicenseOpen(!licenseOpen)}>
          <span>Already have a license key?</span>
          <span className={`chev ${licenseOpen ? 'open' : ''}`}>{'›'}</span>
        </button>
        {licenseOpen && (
          <div className="license-form">
            <input
              type="text"
              className="license-input"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              spellCheck={false}
            />
            <button className="license-activate" onClick={tryActivate} disabled={!licenseKey.trim()}>Activate</button>
            {licenseMsg && (
              <div className={`license-msg ${typeof licenseMsg === 'object' ? (licenseMsg.ok ? 'ok' : 'err') : ''}`}>
                {typeof licenseMsg === 'object' ? licenseMsg.text : licenseMsg}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="plan-foot">
        Preview state {'·'} <button className="link-btn inline" onClick={() => onPlanState('beta')}>Beta</button>
        {' · '}<button className="link-btn inline" onClick={() => onPlanState('premium')}>Active</button>
      </div>
    </div>
  );
}

function PremiumActiveView({ onPlanState }: { onPlanState: (s: PlanState) => void }) {
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <div className="plan-pane">
      <div className="active-card">
        <div className="active-mark"><Icon name="check" size={16} /></div>
        <div className="overline">Plan</div>
        <div className="active-title"><span className="serif-italic">Premium</span> {'·'} Active</div>
        <div className="active-sub">Thank you for supporting VocabFlow. Every feature unlocked, on every browser you sign into.</div>
        <div className="active-meta">
          <div className="meta-row"><span className="meta-k">Words saved</span><span className="meta-v">{'∞'}</span></div>
        </div>
      </div>

      <div className="active-perks">
        <div className="overline">What&rsquo;s unlocked</div>
        <div className="perk"><Icon name="check" size={11} /> Unlimited words</div>
        <div className="perk"><Icon name="check" size={11} /> Custom review intervals</div>
        <div className="perk"><Icon name="check" size={11} /> All spacing algorithms, as they ship</div>
      </div>

      {!confirmOff ? (
        <button className="ghost-btn danger" onClick={() => setConfirmOff(true)}>Deactivate license</button>
      ) : (
        <div className="deact-confirm">
          <div className="deact-msg">Sure? You&rsquo;ll drop back to the free word cap.</div>
          <div className="deact-row">
            <button className="ghost-btn" onClick={() => setConfirmOff(false)}>Keep Premium</button>
            <button className="ghost-btn danger" onClick={() => { setConfirmOff(false); onPlanState('free'); }}>Yes, deactivate</button>
          </div>
        </div>
      )}

      <div className="plan-foot">
        Preview state {'·'} <button className="link-btn inline" onClick={() => onPlanState('beta')}>Beta</button>
        {' · '}<button className="link-btn inline" onClick={() => onPlanState('free')}>Upgrade pitch</button>
      </div>
    </div>
  );
}
