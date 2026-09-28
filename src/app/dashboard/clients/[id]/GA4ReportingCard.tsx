'use client';

import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DailyPoint {
  date: string;
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  averageEngagementTimeSeconds: number;
  conversions: number;
  totalRevenue: number;
}

interface ChannelRow {
  channel: string;
  sessions: number;
  conversions: number;
}

interface AnalyticsResponse {
  daily: DailyPoint[];
  channels: ChannelRow[];
}

interface LandingPageRow {
  landingPage: string;
  sessions: number;
  engagedSessions: number;
  bounceRate: number;
  conversions: number;
}

interface EventRow {
  eventName: string;
  eventCount: number;
}

interface FunnelResponse {
  landingPages: LandingPageRow[];
  events: EventRow[];
}

interface EcommerceSummary {
  transactions: number;
  purchaseRevenue: number;
  averageOrderValue: number;
}

interface SourceMediumRow {
  sourceMedium: string;
  sessions: number;
  activeUsers: number;
  conversions: number;
}

interface EngagementSummary {
  engagementRate: number;
  averageEngagementTimeSeconds: number;
  totalUsers: number;
  newUsers: number;
  returningUsers: number;
}

interface GrowthResponse {
  ecommerce: EcommerceSummary;
  sourceMedium: SourceMediumRow[];
  engagement: EngagementSummary;
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function sum(rows: DailyPoint[], key: keyof DailyPoint): number {
  return rows.reduce((total, r) => total + (r[key] as number), 0);
}

// GA4's own website behavior alongside the ad-spend numbers above — sessions,
// engagement, and channel comparison (paid vs organic vs direct), the part
// Google Ads' own reporting can't show since it only knows about the click,
// not what happened after it.
export default function GA4ReportingCard({ clientId }: { clientId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [growth, setGrowth] = useState<GrowthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, funnelRes, growthRes] = await Promise.all([
        fetch(`/api/analytics?clientId=${clientId}&days=${days}`),
        fetch(`/api/analytics/funnel?clientId=${clientId}&days=${days}`),
        fetch(`/api/analytics/growth?clientId=${clientId}&days=${days}`),
      ]);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to load GA4 data (${res.status})`);
        return;
      }
      setData(await res.json());
      if (funnelRes.ok) {
        setFunnel(await funnelRes.json());
      }
      if (growthRes.ok) {
        setGrowth(await growthRes.json());
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load GA4 data — network error');
    } finally {
      setLoading(false);
    }
  }, [clientId, days]);

  useEffect(() => {
    load();
  }, [load]);

  const chartData =
    data?.daily.map((d) => ({
      date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      sessions: d.sessions,
      conversions: d.conversions,
    })) ?? [];

  const totalSessions = data ? sum(data.daily, 'sessions') : 0;
  const totalUsers = data ? sum(data.daily, 'activeUsers') : 0;
  const totalEngaged = data ? sum(data.daily, 'engagedSessions') : 0;
  const totalConversions = data ? sum(data.daily, 'conversions') : 0;
  const totalRevenue = data ? sum(data.daily, 'totalRevenue') : 0;
  const engagementRate = totalSessions > 0 ? (totalEngaged / totalSessions) * 100 : 0;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Website analytics (GA4)</h2>
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
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      {loading && !data && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

      {data && data.daily.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>No GA4 data yet for this period.</p>
      )}

      {data && data.daily.length > 0 && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <KpiCard label="Sessions" value={totalSessions.toLocaleString()} />
            <KpiCard label="Active users" value={totalUsers.toLocaleString()} />
            <KpiCard label="Engagement rate" value={`${engagementRate.toFixed(1)}%`} />
            <KpiCard label="Conversions" value={totalConversions.toLocaleString()} />
            <KpiCard label="Revenue" value={`$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            {growth && (
              <>
                <KpiCard label="New users" value={growth.engagement.newUsers.toLocaleString()} />
                <KpiCard label="Returning users" value={growth.engagement.returningUsers.toLocaleString()} />
                <KpiCard
                  label="Avg. engagement time"
                  value={`${Math.round(growth.engagement.averageEngagementTimeSeconds)}s`}
                />
                {growth.ecommerce.transactions > 0 ? (
                  <>
                    <KpiCard label="Transactions" value={growth.ecommerce.transactions.toLocaleString()} />
                    <KpiCard
                      label="Purchase revenue"
                      value={`$${growth.ecommerce.purchaseRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    />
                    <KpiCard
                      label="Avg. order value"
                      value={`$${growth.ecommerce.averageOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    />
                  </>
                ) : null}
              </>
            )}
          </div>
          {growth && growth.ecommerce.transactions === 0 && (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginBottom: 20 }}>
              No ecommerce transactions reported for this period — either nothing sold, or this GA4 property doesn't
              have ecommerce tracking configured.
            </p>
          )}

          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2230" />
              <XAxis dataKey="date" stroke="#9aa0b4" fontSize={12} />
              <YAxis stroke="#9aa0b4" fontSize={12} />
              <Tooltip contentStyle={{ background: '#12141d', border: '1px solid #1f2230', borderRadius: 8 }} />
              <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#6d5efc" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversions" name="Conversions" stroke="#22d3c9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>

          {data.channels.length > 0 && (
            <div style={{ marginTop: 20, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '8px 6px' }}>Channel</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Sessions</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((c) => (
                    <tr key={c.channel} style={{ borderBottom: '1px solid var(--card-border)' }}>
                      <td style={{ padding: '8px 6px' }}>{c.channel}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{c.sessions.toLocaleString()}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{c.conversions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {growth && growth.sourceMedium.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Traffic by source / medium</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                      <th style={{ padding: '8px 6px' }}>Source / medium</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Sessions</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Users</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Conversions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {growth.sourceMedium.map((s) => (
                      <tr key={s.sourceMedium} style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td style={{ padding: '8px 6px' }}>{s.sourceMedium}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.sessions.toLocaleString()}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.activeUsers.toLocaleString()}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{s.conversions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {funnel && funnel.landingPages.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Landing pages</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                      <th style={{ padding: '8px 6px' }}>Landing page</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Sessions</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Engaged</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Bounce rate</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Conversions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.landingPages.slice(0, 15).map((p) => (
                      <tr key={p.landingPage} style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td style={{ padding: '8px 6px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.landingPage}>
                          {p.landingPage}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p.sessions.toLocaleString()}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p.engagedSessions.toLocaleString()}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{(p.bounceRate * 100).toFixed(1)}%</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p.conversions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {funnel && funnel.events.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Events &amp; goal completions</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                      <th style={{ padding: '8px 6px' }}>Event</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.events.slice(0, 15).map((e) => (
                      <tr key={e.eventName} style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td style={{ padding: '8px 6px' }}>{e.eventName}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{e.eventCount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
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
