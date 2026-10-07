'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DISPLAY_CURRENCIES } from '@/lib/currency';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Per-client language + currency settings: the display currency every money
// figure is shown in (stored amounts stay USD cents — see lib/currency.ts),
// and the language of the client's portal and emails.
export default function ClientLocaleForm({
  clientId,
  initialCurrency,
  initialPortalLocale,
  readOnly,
}: {
  clientId: string;
  initialCurrency: string | null;
  initialPortalLocale: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [currency, setCurrency] = useState(initialCurrency ?? 'USD');
  const [portalLocale, setPortalLocale] = useState(initialPortalLocale || 'en');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayCurrency: currency, portalContactLocale: portalLocale }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `${t('clientLocale.failed')} (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? t('clientLocale.failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>{t('clientLocale.title')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>{t('clientLocale.help')}</p>
      <label>{t('clientLocale.currency')}</label>
      <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={readOnly}>
        {DISPLAY_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <label>{t('clientLocale.portalLanguage')}</label>
      <select value={portalLocale} onChange={(e) => setPortalLocale(e.target.value)} disabled={readOnly}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
          {saved && <span style={{ color: 'var(--accent2)', fontSize: '0.82rem' }}>{t('clientLocale.saved')}</span>}
          {error && <span style={{ color: '#ef4444', fontSize: '0.82rem' }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
