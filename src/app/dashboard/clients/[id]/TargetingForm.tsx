'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Lets the operator set/edit ad language and target locations for a client —
// these feed directly into AI campaign generation (see /api/campaigns/create-draft
// and src/lib/ai.ts). Without this, the AI has to guess a language from the
// business name alone, which is exactly what caused Louzan's ads to come
// back in Arabic unexpectedly.
export default function TargetingForm({
  clientId,
  initialAdLanguage,
  initialTargetLocations,
  readOnly,
}: {
  clientId: string;
  initialAdLanguage: string | null;
  initialTargetLocations: string | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [adLanguage, setAdLanguage] = useState(initialAdLanguage ?? 'English');
  const [targetLocations, setTargetLocations] = useState(initialTargetLocations ?? '');
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
        body: JSON.stringify({ adLanguage, targetLocations }),
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
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Ad language &amp; targeting</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Controls the language and location targeting used when generating campaign drafts for this client.
        Without these set, the AI has to guess.
      </p>
      <label>Ad language</label>
      <input value={adLanguage} onChange={(e) => setAdLanguage(e.target.value)} placeholder="English" disabled={readOnly} />
      <label>Target locations</label>
      <input
        value={targetLocations}
        onChange={(e) => setTargetLocations(e.target.value)}
        placeholder="e.g. Lebanon, UAE, Saudi Arabia"
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
