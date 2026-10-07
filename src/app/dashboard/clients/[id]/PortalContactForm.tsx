'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Sets who at the client's business can sign into their Client Portal
// (/portal) — magic-link only, no password. Without this set, the portal is
// simply inert for this client: no monthly-input reminders, no plan-ready
// emails, nobody can sign in. See lib/clientPortalAuth.ts.
export default function PortalContactForm({
  clientId,
  initialName,
  initialEmail,
  readOnly,
}: {
  clientId: string;
  initialName: string | null;
  initialEmail: string | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { tr, t } = useI18n();
  const [name, setName] = useState(initialName ?? '');
  const [email, setEmail] = useState(initialEmail ?? '');
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
        body: JSON.stringify({ portalContactName: name, portalContactEmail: email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `${t('cards.saveFailed')} (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? t('cards.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>{t('cards.portalTitle')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        {t('cards.portalHelp')}
      </p>
      <label>{t('cards.contactName')}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Jane Doe")} disabled={readOnly} />
      <label>{t('cards.contactEmail')}</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={tr("jane@clientcompany.com")}
        disabled={readOnly}
      />
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
          {saved && <span style={{ color: 'var(--accent2)', fontSize: '0.82rem' }}>{t('cards.saved')}</span>}
          {error && <span style={{ color: '#ef4444', fontSize: '0.82rem' }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
