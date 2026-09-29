'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
        setError(data.error ?? `Save failed (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Save failed — network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Client portal contact</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Who at this client can sign into their portal (magic-link email, no password) to fill the monthly
        goals/audience form and review &amp; approve plans. Leave blank to keep the portal off for this client.
        Saving a new or changed email sends them a sign-in link right away.
      </p>
      <label>Contact name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" disabled={readOnly} />
      <label>Contact email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="jane@clientcompany.com"
        disabled={readOnly}
      />
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span style={{ color: 'var(--accent2)', fontSize: '0.82rem' }}>Saved.</span>}
          {error && <span style={{ color: '#ef4444', fontSize: '0.82rem' }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
