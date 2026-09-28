'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Deployment {
  id: string;
  payloadJson: string;
  status: string;
  createdAt: string | Date;
  errorMessage: string | null;
}

const badgeClass: Record<string, string> = {
  PENDING_APPROVAL: 'badge-pending',
  EXECUTED: 'badge-live',
  FAILED: 'badge-failed',
  REJECTED: 'badge-failed',
};

const emptyForm = {
  type: 'GA4_CONFIG' as 'GA4_CONFIG' | 'GOOGLE_ADS_CONVERSION' | 'REMARKETING',
  name: '',
  measurementId: '',
  conversionId: '',
  conversionLabel: '',
};

// Requests and approves GTM tag deployments. Requesting only records what's
// wanted (PENDING_APPROVAL) — nothing touches the client's live site until
// someone with tagManager capability clicks "Approve & publish", which calls
// the real GTM API and publishes a new container version immediately (GTM
// has no "paused" state to stage changes in the way a Google Ads campaign
// does).
export default function TagManagerSection({ clientId, deployments }: { clientId: string; deployments: Deployment[] }) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/gtm-deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ...form }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to request deployment');
        return;
      }
      setForm(emptyForm);
      setRequesting(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to request deployment — network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(id: string) {
    if (!confirm('Approve and publish this tag? It will go live on the client\'s site immediately.')) return;
    setApprovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/gtm-deployments/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to approve deployment');
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to approve deployment — network error');
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Tag Manager</h2>
        <button className="btn btn-secondary" onClick={() => setRequesting(!requesting)}>
          {requesting ? 'Cancel' : '+ Request tag'}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Requesting only records what's wanted — nothing is created or published on the client's site until it's
        approved below.
      </p>

      {requesting && (
        <form onSubmit={handleRequest} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--card-border)' }}>
          <label>Tag type</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>
            <option value="GA4_CONFIG">GA4 Configuration</option>
            <option value="GOOGLE_ADS_CONVERSION">Google Ads Conversion Tracking</option>
            <option value="REMARKETING">Google Ads Remarketing</option>
          </select>
          <label>Tag name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. GA4 Config - Main site"
            required
          />
          {form.type === 'GA4_CONFIG' && (
            <>
              <label>Measurement ID</label>
              <input
                value={form.measurementId}
                onChange={(e) => setForm({ ...form, measurementId: e.target.value })}
                placeholder="G-XXXXXXXXXX"
                required
              />
            </>
          )}
          {(form.type === 'GOOGLE_ADS_CONVERSION' || form.type === 'REMARKETING') && (
            <>
              <label>Google Ads Conversion ID</label>
              <input
                value={form.conversionId}
                onChange={(e) => setForm({ ...form, conversionId: e.target.value })}
                placeholder="AW-XXXXXXXXX"
                required
              />
            </>
          )}
          {form.type === 'GOOGLE_ADS_CONVERSION' && (
            <>
              <label>Conversion label</label>
              <input
                value={form.conversionLabel}
                onChange={(e) => setForm({ ...form, conversionLabel: e.target.value })}
                placeholder="AbCdEfGhIjKlMnOp"
                required
              />
            </>
          )}
          <button className="btn" type="submit" disabled={saving} style={{ marginTop: 10 }}>
            {saving ? 'Requesting…' : 'Request deployment'}
          </button>
        </form>
      )}

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {deployments.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>No tag deployments yet.</p>
      ) : (
        deployments.map((d) => {
          const payload = JSON.parse(d.payloadJson);
          return (
            <div key={d.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span className={`badge ${badgeClass[d.status] ?? 'badge-draft'}`}>{d.status}</span>{' '}
                  <strong>{payload.name}</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>({payload.type.replaceAll('_', ' ').toLowerCase()})</span>
                </div>
                {d.status === 'PENDING_APPROVAL' && (
                  <button
                    className="btn"
                    style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                    onClick={() => handleApprove(d.id)}
                    disabled={approvingId === d.id}
                  >
                    {approvingId === d.id ? 'Publishing…' : 'Approve & publish'}
                  </button>
                )}
              </div>
              {d.errorMessage && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{d.errorMessage}</p>}
            </div>
          );
        })
      )}
    </div>
  );
}
