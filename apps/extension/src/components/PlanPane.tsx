import React, { useState } from 'react';
import { Icon } from './icons';
import { useI18n } from '../lib/i18n';
import type { Word } from '../lib/storage/types';
import { FREE_WORD_CAP } from '../lib/plan';
import { getAlgoInfo, formatChain } from '../lib/review/algo-info';
import { PACE_KEY } from '../lib/review/algo';
import type { AlgoId, Pace } from '@vocably/core';

export type PlanState = 'beta' | 'free' | 'premium';

interface Props {
  words: Word[];
  planState: PlanState;
  /** the algorithm+pace new words are currently saved with (ReviewPane's
   *  selector) — the info card below always describes this exact
   *  combination, not a fixed one, since a word saved under Leitner (or
   *  under a different pace) works nothing like this one. */
  defaultAlgo: AlgoId;
  defaultPace: Pace;
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
export function PlanPane({ words, planState, defaultAlgo, defaultPace, onBuy, onActivateLicense, onDeactivate }: Props) {
  if (planState === 'premium') {
    return <PremiumActiveView defaultAlgo={defaultAlgo} defaultPace={defaultPace} onDeactivate={onDeactivate} />;
  }
  if (planState === 'free') {
    return (
      <UpgradeView
        words={words} defaultAlgo={defaultAlgo} defaultPace={defaultPace}
        onBuy={onBuy} onActivateLicense={onActivateLicense}
      />
    );
  }
  return <BetaView defaultAlgo={defaultAlgo} defaultPace={defaultPace} />;
}

/** Everything the app actually knows about the currently-selected
 *  algorithm+pace, pulled live from the scheduler config (see
 *  algo-info.ts) so this can never go stale the way a hand-typed
 *  description would. `pace` is ignored for leitner (see algo-info.ts). */
function AlgorithmInfoCard({ algo, pace }: { algo: AlgoId; pace: Pace }) {
  const { t } = useI18n();
  const info = getAlgoInfo(algo, pace);
  const chain = formatChain(info.chainSeconds);

  return (
    <div className="info-card">
      <h4>{t('algoInfo.heading')}</h4>
      <div className="name">
        {algo === 'leitner' ? t('algoInfo.leitnerName') : `${t('algoInfo.sm2Name')} · ${t(PACE_KEY[pace])}`}
      </div>
      <p>{algo === 'leitner' ? t('algoInfo.leitnerCore') : t('algoInfo.sm2Core')}</p>

      <div className="algo-chain-label">{t('algoInfo.chainLabel')}</div>
      <div className="algo-chain">
        {chain}
        {info.growsPastChain && <span className="algo-chain-grows"> → {t('algoInfo.chainGrows')}</span>}
      </div>

      <ul className="algo-details">
        {algo === 'leitner' ? (
          <>
            <li>{t('algoInfo.leitnerDetail1')}</li>
            <li>{t('algoInfo.leitnerDetail2')}</li>
          </>
        ) : (
          <>
            <li>{t('algoInfo.sm2Detail1')}</li>
            <li>{t('algoInfo.sm2Detail2')}</li>
            <li>{t('algoInfo.sm2Detail3')}</li>
          </>
        )}
      </ul>
    </div>
  );
}

function BetaView({ defaultAlgo, defaultPace }: { defaultAlgo: AlgoId; defaultPace: Pace }) {
  const { t } = useI18n();
  return (
    <div className="plan-pane">
      <div className="info-card info-tip">
        <h4>{t('plan.betaAccessTitle')}</h4>
        <div className="beta-line">
          <span className="serif-italic">{t('plan.betaAllUnlocked')}</span>
          <span>{t('plan.betaNoCap')}</span>
        </div>
      </div>

      <AlgorithmInfoCard algo={defaultAlgo} pace={defaultPace} />

      <div className="tips">
        <h4>{t('plan.tipsTitle')}</h4>
        <div className="tip-item"><div className="num">1</div><div>{t('plan.tip1')}</div></div>
        <div className="tip-item"><div className="num">2</div><div>{t('plan.tip2')}</div></div>
        <div className="tip-item"><div className="num">3</div><div>{t('plan.tip3')}</div></div>
      </div>
    </div>
  );
}

function UpgradeView({
  words,
  defaultAlgo,
  defaultPace,
  onBuy,
  onActivateLicense,
}: {
  words: Word[];
  defaultAlgo: AlgoId;
  defaultPace: Pace;
  onBuy: () => void;
  onActivateLicense: (key: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const { t } = useI18n();
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
    { free: t('plan.featWordsCapFree', { cap: FREE_WORD_CAP }), pro: t('plan.featWordsCapPremium') },
    { free: t('plan.featForeverFree'), pro: t('plan.featForeverPremium') },
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
            <div className="overline">{t('plan.brand')}</div>
            <div className="pricing-name">{t('plan.premium')}</div>
          </div>
          <div className="pricing-price">
            <div className="amount">{t('plan.payWhatYouWant')}<span className="suffix"></span></div>
            <div className="price-note">{t('plan.oneTimeKofi')}</div>
          </div>
        </div>

        <button className="cta-btn" onClick={onBuy}>
          <span>{t('plan.supportGetPremium')}</span>
          <span className="cta-arrow">→</span>
        </button>
      </div>

      <div className={`quota-strip ${nearCap ? 'warn' : ''}`}>
        <div className="quota-row">
          <span className="quota-label">{t('plan.yourLibrary')}</span>
          <span className="quota-count"><strong>{used}</strong> <span className="muted">/ {FREE_WORD_CAP}</span></span>
        </div>
        <div className="quota-track"><div className="quota-fill" style={{ width: `${pct}%` }} /></div>
        {nearCap && <div className="quota-msg">{t('plan.nearCapMsg', { cap: FREE_WORD_CAP })}</div>}
      </div>

      <div className="features">
        <div className="features-head">
          <div />
          <div className="features-h-col free">{t('plan.featFree')}</div>
          <div className="features-h-col pro">{t('plan.featPremium')}</div>
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
          <span>{t('plan.haveLicense')}</span>
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
              {activating ? t('plan.checking') : t('plan.activate')}
            </button>
            {licenseMsg && (
              <div className={`license-msg ${licenseMsg.ok ? 'ok' : 'err'}`}>{licenseMsg.text}</div>
            )}
          </div>
        )}
      </div>

      <AlgorithmInfoCard algo={defaultAlgo} pace={defaultPace} />
    </div>
  );
}

function PremiumActiveView({
  defaultAlgo,
  defaultPace,
  onDeactivate,
}: {
  defaultAlgo: AlgoId;
  defaultPace: Pace;
  onDeactivate: () => void;
}) {
  const { t } = useI18n();
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <div className="plan-pane">
      <div className="active-card">
        <div className="active-mark"><Icon name="check" size={16} /></div>
        <div className="overline">{t('plan.planOverline')}</div>
        <div className="active-title"><span className="serif-italic">{t('plan.premium')}</span> {'·'} {t('plan.active')}</div>
        <div className="active-sub">{t('plan.thanksSupporting')}</div>
        <div className="active-meta">
          <div className="meta-row"><span className="meta-k">{t('plan.wordsSaved')}</span><span className="meta-v">{'∞'}</span></div>
        </div>
      </div>

      <div className="active-perks">
        <div className="overline">{t('plan.whatsUnlocked')}</div>
        <div className="perk"><Icon name="check" size={11} /> {t('plan.unlimitedWords')}</div>
      </div>

      {!confirmOff ? (
        <button className="ghost-btn danger" onClick={() => setConfirmOff(true)}>{t('plan.deactivate')}</button>
      ) : (
        <div className="deact-confirm">
          <div className="deact-msg">{t('plan.deactivateConfirm')}</div>
          <div className="deact-row">
            <button className="ghost-btn" onClick={() => setConfirmOff(false)}>{t('plan.keepPremium')}</button>
            <button className="ghost-btn danger" onClick={() => { setConfirmOff(false); onDeactivate(); }}>{t('plan.yesDeactivate')}</button>
          </div>
        </div>
      )}

      <AlgorithmInfoCard algo={defaultAlgo} pace={defaultPace} />
    </div>
  );
}
