'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface MetaCampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string; // ACTIVE | PAUSED | DELETED | ARCHIVED
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  last7d: {
    impressions: number;
    clicks: number;
    costCents: number;
    conversions: number;
  };
}

const statusBadge: Record<string, string> = {
  ACTIVE: 'badge-live',
  PAUSED: 'badge-draft',
  DELETED: 'badge-failed',
  ARCHIVED: 'badge-failed',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// The Meta counterpart to BusinessProfileSection/ReportingDashboard — pulls
// campaigns imported from the connected Meta ad account, and their last-7-
// day performance. Read-only display; budget/pause changes happen via
// AI-approved MetaInsightsPanel below, never directly from this table.
export default function MetaCampaignsSection({
  clientId,
  accountId,
  currencyCode,
  campaigns,
}: {
  clientId: string;
  accountId: string;
  currencyCode: string | null;
  campaigns: MetaCampaignRow[];
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/meta/sync?accountId=${accountId}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Sync failed');
        return;
      }
      setMessage(`Synced ${data.campaignsSynced} campaign(s), ${data.metricsSynced} metric row(s).`);
      if (data.errors?.length) setError(data.errors.join('; '));
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Sync failed — network error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Meta campaigns</h2>
        <button className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Campaigns imported from the connected Meta ad account (Facebook &amp; Instagram share this one account),
        and their last-7-day performance{currencyCode ? ` — figures shown in USD, converted from the account's ${currencyCode} billing currency` : ''}.
      </p>

      {message && <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginBottom: 10 }}>{message}</p>}
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {campaigns.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>No campaigns yet. Click "Sync now" to pull them in.</p>
      ) : (
        campaigns.map((c) => (
          <div key={c.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{c.name}</strong>{' '}
                <span className={`badge ${statusBadge[c.status] ?? 'badge-draft'}`}>{c.status}</span>
              </div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                {c.objective}
                {c.dailyBudgetCents != null && ` · ${formatCents(c.dailyBudgetCents)}/day`}
                {c.lifetimeBudgetCents != null && ` · ${formatCents(c.lifetimeBudgetCents)} lifetime`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 6 }}>
              <span>Impressions: <strong style={{ color: 'var(--text)' }}>{c.last7d.impressions.toLocaleString()}</strong></span>
              <span>Clicks: <strong style={{ color: 'var(--text)' }}>{c.last7d.clicks.toLocaleString()}</strong></span>
              <span>Spend: <strong style={{ color: 'var(--text)' }}>{formatCents(c.last7d.costCents)}</strong></span>
              <span>Conversions: <strong style={{ color: 'var(--text)' }}>{c.last7d.conversions.toLocaleString()}</strong></span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
