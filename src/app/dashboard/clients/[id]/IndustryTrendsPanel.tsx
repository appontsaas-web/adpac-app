'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';

import { useState } from 'react';

interface PlatformTotals {
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  ctr: number | null;
  cpcCents: number | null;
  conversionRate: number | null;
  cpaCents: number | null;
}

interface IndustryBenchmark {
  industry: string;
  peerCount: number;
  windowDays: number;
  client: PlatformTotals;
  peerAverage: {
    ctr: number | null;
    cpcCents: number | null;
    conversionRate: number | null;
    cpaCents: number | null;
  };
}

interface IndustryTrendResult {
  benchmark: IndustryBenchmark;
  narrative: string;
}

function pct(n: number | null) {
  return n === null ? '—' : `${(n * 100).toFixed(2)}%`;
}


function diffLabel(clientVal: number | null, peerVal: number | null, higherIsBetter: boolean) {
  if (clientVal === null || peerVal === null || peerVal === 0) return null;
  const diffPct = ((clientVal - peerVal) / peerVal) * 100;
  const good = higherIsBetter ? diffPct > 0 : diffPct < 0;
  const color = Math.abs(diffPct) < 3 ? 'var(--text-dim)' : good ? 'var(--accent2)' : '#ef4444';
  return (
    <span style={{ color, fontSize: '0.75rem' }}>
      {diffPct > 0 ? '+' : ''}
      {diffPct.toFixed(0)}% vs. peers
    </span>
  );
}

// Admin-only: compares this client's last-30-day CTR/CPC/conversion rate/CPA
// against the average of AdPac's other clients in the same industry (see
// lib/industryTrends.ts). Computed live on click — no stored history, always
// reflects whatever's currently synced.
export default function IndustryTrendsPanel({ clientId }: { clientId: string }) {
  const { money: fmtMoney } = useI18n();
  const money = (cents: number | null) => (cents === null ? '—' : fmtMoney(cents));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IndustryTrendResult | null | undefined>(undefined);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/industry-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Failed to generate industry analysis');
        return;
      }
      setResult(d.result);
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate industry analysis — network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Industry trend &amp; analysis</h2>
        <button className="btn btn-secondary" onClick={handleGenerate} disabled={loading}>
          {loading ? 'Analyzing…' : 'Generate analysis'}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Compares this client's last 30 days against the average of AdPac's other clients in the same industry —
        based on AdPac's own client portfolio, not external market research.
      </p>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {result === null && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Not enough data for a comparison yet — this client needs an industry set, real ad spend in the last 30
          days, and at least 2 other clients in the same industry with spend to compare against.
        </p>
      )}

      {result && (
        <>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 10 }}>
            {result.benchmark.industry} — compared against {result.benchmark.peerCount} other client
            {result.benchmark.peerCount === 1 ? '' : 's'}, last {result.benchmark.windowDays} days
          </p>
          {result.narrative && <p style={{ fontSize: '0.88rem', marginBottom: 14 }}>{result.narrative}</p>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>CTR</div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>{pct(result.benchmark.client.ctr)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 2 }}>peers: {pct(result.benchmark.peerAverage.ctr)}</div>
              {diffLabel(result.benchmark.client.ctr, result.benchmark.peerAverage.ctr, true)}
            </div>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>CPC</div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>{money(result.benchmark.client.cpcCents)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 2 }}>peers: {money(result.benchmark.peerAverage.cpcCents)}</div>
              {diffLabel(result.benchmark.client.cpcCents, result.benchmark.peerAverage.cpcCents, false)}
            </div>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Conversion rate</div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>{pct(result.benchmark.client.conversionRate)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 2 }}>
                peers: {pct(result.benchmark.peerAverage.conversionRate)}
              </div>
              {diffLabel(result.benchmark.client.conversionRate, result.benchmark.peerAverage.conversionRate, true)}
            </div>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>CPA</div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>{money(result.benchmark.client.cpaCents)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 2 }}>peers: {money(result.benchmark.peerAverage.cpaCents)}</div>
              {diffLabel(result.benchmark.client.cpaCents, result.benchmark.peerAverage.cpaCents, false)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
