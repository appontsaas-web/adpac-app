'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

const PLATFORMS = [
  { key: 'google', label: 'Google Ads' },
  { key: 'meta', label: 'Meta Ads (Facebook & Instagram)' },
  { key: 'snapchat', label: 'Snapchat Ads' },
  { key: 'tiktok', label: 'TikTok Ads' },
];

export default function ConnectAccount() {
  const { tr } = useI18n();
  const [customerId, setCustomerId] = useState('');
  const [showGoogle, setShowGoogle] = useState(false);

  function go(key: string) {
    if (key === 'google') {
      setShowGoogle(true);
      return;
    }
    window.location.href = `/api/portal/analysis/connect?platform=${key}`;
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 6 }}>{tr('Connect one ad account')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 14 }}>
        {tr('Connect one of your ad accounts and we will instantly analyse the last 30 days and prepare an action plan, including what we would improve if we managed it. Access is read-only: we never change anything in your account.')}
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {PLATFORMS.map((p) => (
          <button key={p.key} className="btn btn-secondary" onClick={() => go(p.key)}>
            {tr('Connect')} {p.label}
          </button>
        ))}
      </div>
      {showGoogle && (
        <form
          style={{ marginTop: 14, display: 'grid', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = `/api/portal/analysis/connect?platform=google&customerId=${encodeURIComponent(customerId)}`;
          }}
        >
          <label style={{ fontSize: '0.85rem' }}>{tr('Your Google Ads Customer ID (10 digits, top right of Google Ads)')}</label>
          <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="123-456-7890" required />
          <button className="btn" type="submit">{tr('Continue to Google')}</button>
        </form>
      )}
    </div>
  );
}
