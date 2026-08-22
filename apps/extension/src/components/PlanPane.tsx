import React, { useState } from 'react';
import { Icon } from './icons';
import type { Word } from '../lib/storage/types';
import { FREE_WORD_CAP } from '../lib/plan';

export type PlanState = 'beta' | 'free' | 'premium';

interface Props {
  words: Word[];
  planState: PlanState;
  /** Opens the external checkout page (Ko-fi) — payment never happens
   *  inside the extension itself. */
  onBuy: () => void;
  /** Validates a pasted key against the API. This — and ONLY this — is
   *  allowed to grant Premium; there is deliberately no "just set the state"
   *  escape hatch in this component, since that would make the whole word
   *  cap a click away from being bypassed by anyone. */
  onActivateLicense: (key: string) => Promise<{ ok: boolean; message: string }>;
  /** Forgets this browser's stored license key and drops back to Free. */
  onDeactivate: () => void;
}

// Plan tab — three real states. planState only ever changes via a genuine
// license check (onActivateLicense) or explicit deactivation; nothing in
// here can self-assign Premium.
export function PlanPane({ words, planState, onBuy, onActivateLicense, onDeactivate }: Props) {
  if (planState === 'premium') return <PremiumActiveView onDeactivate={onDeactivate} />;
  if (planState === 'free') return <UpgradeView words={words} onBuy={onBuy} onActivateLicense={onActivateLicense} />;
  return <BetaView />;
}

function BetaView() {
  return (
    <div className="plan-pane">
      <div className="info-card info-tip">
        <h4>Beta access</h4>
        <div className="beta-line">
          <span className="serif-italic">All features unlocked.</span>
          <span> No word cap, for now.</span>
        </div>
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
    </div>
  );
}

function UpgradeView({
  words,
  onBuy,
  onActivateLicense,
}: {
  words: Word[];
  onBuy: () => void;
  onActivateLicense: (key: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [licenseMsg, setLicenseMsg] = useState<null | { ok: boolean; text: string }>(null);
  const used = words.length;
  const pct = Math.min(100, Math.round((used / FREE_WORD_CAP) * 100));
  const nearCap = used >= FREE_WORD_CAP * 0.8;

  // Only ONE thing is actually different today: the word cap. Everything
  // else in the app (both algorithms, typed review, dictionary lookups) is
  // already free for everyone — this list only promises what's real.
  const features = [
    { free: `${FREE_WORD_CAP} words max`, pro: 'Unlimited words' },
    { free: 'Free, forever', pro: 'Supports ongoing development' },
  ];

  async function tryActivate() {
    setActivating(true);
    setLicenseMsg(null);
    const result = await onActivateLicense(licenseKey);
    setActivating(false);
    setLicenseMsg({ ok: result.ok, text: result.message });
  }

  return (
    <div className="plan-pane">
      <div className="pricing-card">
        <div className="pricing-head">
          <div>
            <div className="overline">Vocably</div>
            <div className="pricing-name">Premium</div>
          </div>
          <div className="pricing-price">
            <div className="amount">Pay what you want<span className="suffix"></span></div>
            <div className="price-note">one-time, via Ko-fi</div>
          </div>
        </div>

        <button className="cta-btn" onClick={onBuy}>
          <span>Support &amp; get Premium</span>
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
              placeholder="VF-XXXX-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              spellCheck={false}
            />
            <button className="license-activate" onClick={tryActivate} disabled={!licenseKey.trim() || activating}>
              {activating ? 'Checking…' : 'Activate'}
            </button>
            {licenseMsg && (
              <div className={`license-msg ${licenseMsg.ok ? 'ok' : 'err'}`}>{licenseMsg.text}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PremiumActiveView({ onDeactivate }: { onDeactivate: () => void }) {
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <div className="plan-pane">
      <div className="active-card">
        <div className="active-mark"><Icon name="check" size={16} /></div>
        <div className="overline">Plan</div>
        <div className="active-title"><span className="serif-italic">Premium</span> {'·'} Active</div>
        <div className="active-sub">Thank you for supporting Vocably.</div>
        <div className="active-meta">
          <div className="meta-row"><span className="meta-k">Words saved</span><span className="meta-v">{'∞'}</span></div>
        </div>
      </div>

      <div className="active-perks">
        <div className="overline">What&rsquo;s unlocked</div>
        <div className="perk"><Icon name="check" size={11} /> Unlimited words</div>
      </div>

      {!confirmOff ? (
        <button className="ghost-btn danger" onClick={() => setConfirmOff(true)}>Deactivate license</button>
      ) : (
        <div className="deact-confirm">
          <div className="deact-msg">Sure? You&rsquo;ll drop back to the free word cap on this browser.</div>
          <div className="deact-row">
            <button className="ghost-btn" onClick={() => setConfirmOff(false)}>Keep Premium</button>
            <button className="ghost-btn danger" onClick={() => { setConfirmOff(false); onDeactivate(); }}>Yes, deactivate</button>
          </div>
        </div>
      )}
    </div>
  );
}
