'use client';

import { useState, useEffect, useCallback } from 'react';

interface PacingCampaignRow {
  campaignId: string;
  name: string;
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  monthToDateSpendCents: number;
  expectedSpendCents: number;
  projectedEndOfMonthCents: number;
  pacePct: number | null;
}

interface PacingResponse {
  monthLabel: string;
  daysElapsed: number;
  daysInMonth: number;
  campaigns: PacingCampaignRow[];
  totals: {
    monthlyBudgetCents: number;
    monthToDateSpendCents: number;
    expectedSpendCents: number;
    projectedEndOfMonthCents: number;
  };
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// >110% of expected pace = overspending, <90% = underspending, otherwise on track.
function paceColor(pct: number | null) {
  if (pct === null) return 'var(--text-dim)';
  if (pct > 110) return '#ef4444';
  if (pct < 90) return '#f59e0b';
  return '#22c55e';
}

function paceLabel(pct: number | null) {
  if (pct === null) return '—';
  if (pct > 110) return 'Overspending';
  if (pct < 90) return 'Underspending';
  return 'On track';
}

function ProgressBar({ pct }: { pct: number | null }) {
  const width = pct === null ? 0 : Math.min(pct, 150);
  return (
    <div style={{ background: 'var(--card-border)', borderRadius: 4, height: 6, width: '100%', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.min(width / 1.5, 100)}%`,
          background: paceColor(pct),
          borderRadius: 4,
        }}
      />
      {/* Marker at the 100%-of-expected-pace point (scaled the same way as the fill, since the bar itself represents 0–150% of expected pace). */}
      <div style={{ position: 'absolute', left: `${100 / 1.5}%`, top: -2, bottom: -2, width: 1, background: 'var(--text-dim)' }} />
    </div>
  );
}

// Month-to-date spend vs. budget pace for every live campaign with a daily
// budget set. Always reflects the current calendar month regardless of the
// dashboard's own date-range picker — pacing only means something relative
// to a real billing month, not an arbitrary rolling window.
export default function BudgetPacingCard({ googleAdsAccountId }: { googleAdsAccountId: string }) {
  const [data, setData] = useState<PacingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/metrics/pacing?googleAdsAccountId=${googleAdsAccountId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? 'Failed to load budget pacing');
        return;
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load budget pacing — network error');
    } finally {
      setLoading(false);
    }
  }, [googleAdsAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Budget pacing</h2>
        {data && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            {data.monthLabel} — day {data.daysElapsed} of {data.daysInMonth}
          </span>
        )}
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 14 }}>
        Month-to-date spend vs. what each campaign's daily budget implies it should have spent by today, plus a
        projection of where spend lands if the current daily rate holds through month-end.
      </p>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      {loading && !data && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

      {data && data.campaigns.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>No live campaigns with a daily budget set on this account.</p>
      )}

      {data && data.campaigns.length > 0 && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid var(--card-border)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Monthly budget</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(data.totals.monthlyBudgetCents)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>MTD spend</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(data.totals.monthToDateSpendCents)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Expected by today</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(data.totals.expectedSpendCents)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Projected month-end</div>
              <div
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color:
                    data.totals.projectedEndOfMonthCents > data.totals.monthlyBudgetCents * 1.1
                      ? '#ef4444'
                      : 'inherit',
                }}
              >
                {money(data.totals.projectedEndOfMonthCents)}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>Campaign</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Daily budget</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>MTD spend</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Expected</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Projected EOM</th>
                  <th style={{ padding: '8px 6px', minWidth: 140 }}>Pace</th>
                  <th style={{ padding: '8px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.campaignId} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{c.name}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(c.dailyBudgetCents)}/day</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(c.monthToDateSpendCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-dim)' }}>{money(c.expectedSpendCents)}</td>
                    <td
                      style={{
                        padding: '8px 6px',
                        textAlign: 'right',
                        color: c.projectedEndOfMonthCents > c.monthlyBudgetCents * 1.1 ? '#ef4444' : 'inherit',
                      }}
                    >
                      {money(c.projectedEndOfMonthCents)}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <ProgressBar pct={c.pacePct} />
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: '0.78rem', fontWeight: 600, color: paceColor(c.pacePct), whiteSpace: 'nowrap' }}>
                      {c.pacePct !== null ? `${Math.round(c.pacePct)}% · ${paceLabel(c.pacePct)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
