'use client';

import { useState, useEffect, useCallback } from 'react';
import MonthlyGoalCard from './MonthlyGoalCard';

interface PlatformTotals {
  platform: 'google' | 'meta' | 'snapchat';
  label: string;
  connected: boolean;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
  campaignCount: number;
}

interface Insight {
  id: string;
  platform: string;
  actionType: string;
  status: string;
  summary: string;
  createdAt: string;
}

interface SummaryResponse {
  clientName: string;
  since: string;
  until: string;
  totals: {
    impressions: number;
    clicks: number;
    costCents: number;
    conversions: number;
    conversionValueCents: number;
    ctr: number;
    avgCpcCents: number;
    costPerConversionCents: number;
    roas: number;
  };
  platforms: PlatformTotals[];
  insights: Insight[];
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const PLATFORM_LABELS: Record<string, string> = {
  google: 'Google Ads',
  meta: 'Meta Ads',
  snapchat: 'Snapchat Ads',
  businessProfile: 'Business Profile',
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Cross-platform rollup — the whole point is to answer "how is this client
// doing overall" without clicking through each platform tab separately.
// Deliberately reuses the same account totals each platform tab already
// computes (via the platform's own DailyMetric-family table) rather than
// re-deriving anything, so this can never drift from what those tabs show.
export default function SummaryReportDashboard({ clientId }: { clientId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/summary-metrics?clientId=${clientId}&days=${days}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to load summary (${res.status})`);
        return;
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load summary — network error');
    } finally {
      setLoading(false);
    }
  }, [clientId, days]);

  useEffect(() => {
    load();
  }, [load]);

  function handleExport() {
    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    window.open(`/api/reports/export?platform=summary&clientId=${clientId}&since=${fmt(since)}&until=${fmt(until)}`, '_blank');
  }

  return (
    <div>
      <MonthlyGoalCard clientId={clientId} />

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: '1.1rem' }}>Cross-platform summary</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    border: 'none',
                    cursor: 'pointer',
                    background: days === r.days ? 'var(--accent-grad)' : 'transparent',
                    color: days === r.days ? '#0a0b10' : 'var(--text-dim)',
                    fontWeight: days === r.days ? 700 : 400,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={handleExport} title="Download an AdPac-branded PDF combining every connected platform">
              Export PDF
            </button>
          </div>
        </div>

        {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
        {loading && !data && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
              <KpiCard label="Total spend" value={money(data.totals.costCents)} />
              <KpiCard label="Clicks" value={data.totals.clicks.toLocaleString()} />
              <KpiCard label="Impressions" value={data.totals.impressions.toLocaleString()} />
              <KpiCard label="CTR" value={`${(data.totals.ctr * 100).toFixed(2)}%`} />
              <KpiCard label="Avg. CPC" value={money(data.totals.avgCpcCents)} />
              <KpiCard label="Conversions" value={data.totals.conversions.toLocaleString()} />
              <KpiCard label="Cost / conversion" value={data.totals.conversions > 0 ? money(data.totals.costPerConversionCents) : '—'} />
              <KpiCard label="Conversion value" value={money(data.totals.conversionValueCents)} />
              <KpiCard label="ROAS" value={data.totals.costCents > 0 ? `${data.totals.roas.toFixed(2)}x` : '—'} />
            </div>

            <h3 style={{ fontSize: '0.95rem', marginBottom: 10 }}>Delivery by platform</h3>
            <div style={{ overflowX: 'auto', marginBottom: 24 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '8px 6px' }}>Platform</th>
                    <th style={{ padding: '8px 6px' }}>Campaigns</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Spend</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Clicks</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Impr.</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.platforms.map((p) => (
                    <tr key={p.platform} style={{ borderBottom: '1px solid var(--card-border)', opacity: p.connected ? 1 : 0.5 }}>
                      <td style={{ padding: '8px 6px' }}>{p.label}{!p.connected && ' (not connected)'}</td>
                      <td style={{ padding: '8px 6px' }}>{p.campaignCount.toLocaleString()}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(p.costCents)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p.clicks.toLocaleString()}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p.impressions.toLocaleString()}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p.conversions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '0.95rem', marginBottom: 10 }}>Recent AI insights</h3>
            {data.insights.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No AI insights generated yet for this client.</p>
            ) : (
              <div>
                {data.insights.map((i) => (
                  <div
                    key={i.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--card-border)',
                      fontSize: '0.82rem',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-dim)', marginRight: 8 }}>[{PLATFORM_LABELS[i.platform] ?? i.platform}]</span>
                      {i.summary}
                    </div>
                    <div style={{ whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                      <span className={`badge badge-${i.status.toLowerCase().replace('_approval', '')}`}>{i.status}</span>{' '}
                      {new Date(i.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
