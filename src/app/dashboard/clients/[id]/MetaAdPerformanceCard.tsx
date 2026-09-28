'use client';

import { useState, useEffect, useCallback } from 'react';

interface AdSetRow {
  adSetName: string;
  status: string;
  dailyBudgetCents: number | null;
  targetingSummary: string | null;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

interface AdRow {
  name: string;
  status: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusColor(status: string) {
  switch (status) {
    case 'ACTIVE':
      return '#22c55e';
    case 'PAUSED':
      return '#f59e0b';
    case 'DELETED':
    case 'ARCHIVED':
      return '#ef4444';
    default:
      return 'var(--text-dim)';
  }
}

const TABS = ['Ad sets', 'Ads'] as const;
type Tab = (typeof TABS)[number];

// Ad-set and ad (creative) level breakdowns — the detail one/two levels
// below the campaign totals in MetaReportingDashboard. Same tabbed-card
// pattern as KeywordAdPerformanceCard on the Google Ads side, scaled down to
// the two levels Meta actually has (no keywords/search terms there).
export default function MetaAdPerformanceCard({
  metaAdAccountId,
  campaignId,
}: {
  metaAdAccountId: string;
  campaignId?: string | null;
}) {
  const [tab, setTab] = useState<Tab>('Ad sets');
  const [days, setDays] = useState(30);
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | null>(null);
  const [sinceInput, setSinceInput] = useState('');
  const [untilInput, setUntilInput] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [adSets, setAdSets] = useState<AdSetRow[] | null>(null);
  const [ads, setAds] = useState<AdRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeQuery = customRange ? `since=${customRange.since}&until=${customRange.until}` : `days=${days}`;
  const campaignQuery = campaignId ? `&campaignId=${campaignId}` : '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meta-metrics/ad-performance?metaAdAccountId=${metaAdAccountId}&${rangeQuery}${campaignQuery}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? 'Failed to load ad set/ad performance data');
        return;
      }
      const data = await res.json();
      setAdSets(data.adSets);
      setAds(data.ads);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load ad set/ad performance data — network error');
    } finally {
      setLoading(false);
    }
  }, [metaAdAccountId, rangeQuery, campaignQuery]);

  useEffect(() => {
    load();
  }, [load]);

  function selectPreset(presetDays: number) {
    setCustomRange(null);
    setDays(presetDays);
  }

  function applyCustomRange() {
    setDateError(null);
    if (!sinceInput || !untilInput) {
      setDateError('Pick both a start and end date.');
      return;
    }
    if (sinceInput > untilInput) {
      setDateError('Start date must be before end date.');
      return;
    }
    setCustomRange({ since: sinceInput, until: untilInput });
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Ad set &amp; ad performance</h2>
        <div style={{ display: 'flex', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => selectPreset(r.days)}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                border: 'none',
                cursor: 'pointer',
                background: !customRange && days === r.days ? 'var(--accent-grad)' : 'transparent',
                color: !customRange && days === r.days ? '#0a0b10' : 'var(--text-dim)',
                fontWeight: !customRange && days === r.days ? 700 : 400,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Custom range:</span>
        <input
          type="date"
          value={sinceInput}
          onChange={(e) => setSinceInput(e.target.value)}
          style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
        />
        <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>to</span>
        <input
          type="date"
          value={untilInput}
          onChange={(e) => setUntilInput(e.target.value)}
          style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
        />
        <button className="btn btn-secondary" onClick={applyCustomRange} style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
          Apply
        </button>
        {customRange && (
          <span style={{ fontSize: '0.78rem', color: 'var(--accent2)' }}>
            Showing {customRange.since} → {customRange.until}
          </span>
        )}
        {dateError && <span style={{ fontSize: '0.78rem', color: '#ef4444' }}>{dateError}</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? 'btn' : 'btn btn-secondary'}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      {loading && !adSets && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

      {tab === 'Ad sets' && adSets && (
        adSets.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>No ad-set data yet for this period. Click "Sync now" above once campaigns have been live for a day.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>Ad set</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px' }}>Targeting</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Daily budget</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Spend</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Clicks</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Impr.</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Conversions</th>
                </tr>
              </thead>
              <tbody>
                {adSets.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{s.adSetName}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 700, color: statusColor(s.status), fontSize: '0.78rem' }}>{s.status}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{s.targetingSummary ?? '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.dailyBudgetCents != null ? money(s.dailyBudgetCents) : '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(s.costCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.clicks.toLocaleString()}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.impressions.toLocaleString()}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.conversions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'Ads' && ads && (
        ads.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>No ad-level data yet for this period.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>Ad (creative)</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Spend</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Clicks</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Conversions</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((a, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{a.name}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 700, color: statusColor(a.status), fontSize: '0.78rem' }}>{a.status}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(a.costCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{a.clicks.toLocaleString()}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{a.conversions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
