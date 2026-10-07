'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Admin-only card for the hard spend-ceiling guardrail (see
// lib/spendGuardrail.ts): auto-pauses every LIVE campaign for this client if
// projected month-end spend runs 15%+ over their monthly budget, checked
// every scheduler cycle. This card shows whether it's on, and the most
// recent time it actually fired (if ever) — a non-admin never sees this at
// all, same as AccessManager/Action log.
export default function SpendGuardrailCard({
  clientId,
  initialEnabled,
  hasMonthlyBudget,
  lastTriggered,
}: {
  clientId: string;
  initialEnabled: boolean;
  hasMonthlyBudget: boolean;
  lastTriggered: { summary: string; createdAt: string } | null;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spendGuardrailEnabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t('cards.updateFailed'));
      }
      setEnabled(next);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{t('cards.guardrailTitle')}</h2>
        <span className={`badge ${enabled ? 'badge-approved' : 'badge-draft'}`}>{enabled ? t('cards.enabled') : t('cards.disabled')}</span>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 12 }}>
        {t('cards.guardrailHelp')}
      </p>
      {!hasMonthlyBudget && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 12 }}>
          {t('cards.guardrailNoBudget')}
        </p>
      )}
      {lastTriggered && (
        <div
          style={{
            border: '1px solid #ef4444',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: '0.82rem',
          }}
        >
          <strong style={{ color: '#ef4444' }}>{t('cards.lastTriggered')}</strong> {lastTriggered.summary}
          <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>
            {new Date(lastTriggered.createdAt).toLocaleString()}
          </div>
        </div>
      )}
      <button className="btn btn-secondary" onClick={toggle} disabled={saving} style={{ fontSize: '0.8rem' }}>
        {saving ? t('common.loading') : enabled ? t('cards.disableGuardrail') : t('cards.enableGuardrail')}
      </button>
      {error && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
