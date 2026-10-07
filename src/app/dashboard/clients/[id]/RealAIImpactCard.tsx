'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';

import { useState, useEffect, useCallback } from 'react';

interface MonthRow {
  monthKey: string;
  label: string;
  measuredImpactValueCents: number;
  insightsContributing: number;
}

interface RealImpactResponse {
  months: MonthRow[];
  totalMeasuredImpactValueCents: number;
  insightsMeasured: number;
  insightsPending: number;
  insightsUnmeasurable: number;
}


// The real-measured counterpart to AIImpactCard — see lib/realImpact.ts for
// the full methodology. Deliberately a SEPARATE card, not a replacement:
// this sums the actual before/after effect of every approved insight
// (same numbers AIInsightsPanel already shows per-insight) instead of
// applying a rate to total conversion value. Shown alongside the existing
// card so the two can be compared before deciding which one to keep.
export default function RealAIImpactCard({
  clientId,
  isAdmin,
  initialVisibleToStaff,
}: {
  clientId: string;
  isAdmin?: boolean;
  initialVisibleToStaff?: boolean;
}) {
  const { money: fmtMoney } = useI18n();
  const money = (cents: number) => (cents < 0 ? `-${fmtMoney(-cents)}` : fmtMoney(cents));
  const [data, setData] = useState<RealImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleToStaff, setVisibleToStaff] = useState(!!initialVisibleToStaff);
  const [savingVisibility, setSavingVisibility] = useState(false);

  async function toggleVisibleToStaff() {
    const next = !visibleToStaff;
    setSavingVisibility(true);
    setError(null);
    try {
      const res = await fetch('/api/app-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realImpactVisibleToStaff: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to update');
      }
      setVisibleToStaff(next);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingVisibility(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-insights/real-impact?clientId=${clientId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to load real impact data (${res.status})`);
        return;
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load real impact data — network error');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.months ?? [];
  const monthsWithData = rows.filter((r) => r.insightsContributing > 0);
  const maxAbsImpact = Math.max(...rows.map((r) => Math.abs(r.measuredImpactValueCents)), 1);

  return (
    <div className="card" style={{ borderColor: 'var(--accent2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: '1.1rem' }}>AI optimization impact — measured (beta)</h2>
          <span className="badge badge-approved">real data</span>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`badge ${visibleToStaff ? 'badge-approved' : 'badge-draft'}`}>
              {visibleToStaff ? 'Visible to staff' : 'Admin-only'}
            </span>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.72rem', padding: '4px 10px' }}
              onClick={toggleVisibleToStaff}
              disabled={savingVisibility}
            >
              {savingVisibility ? 'Saving…' : visibleToStaff ? 'Hide from staff' : 'Show to staff'}
            </button>
          </div>
        )}
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 12 }}>
        Sums the actual before/after effect of every approved AI insight — the same per-insight numbers shown in AI
        Insights below, not a rate applied to total conversion value. Each insight is credited daily conversions
        above its pre-approval baseline, valued at that campaign's own average revenue per conversion, only for the
        days before the next change was made to that campaign (to avoid double-counting overlapping changes). This
        can go negative if a change measurably didn't help — that's shown here on purpose, unlike the estimate card.
      </p>
      {isAdmin && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginBottom: 12, fontStyle: 'italic' }}>
          This visibility toggle applies app-wide, not just this client — it controls whether ANY non-admin staff
          member can see this card on ANY client.
        </p>
      )}

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      {loading && !data && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>Total measured impact</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: data.totalMeasuredImpactValueCents >= 0 ? 'var(--accent2)' : '#ef4444' }}>
                {money(data.totalMeasuredImpactValueCents)}
              </div>
            </div>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>Insights measured</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{data.insightsMeasured}</div>
            </div>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>Still gathering data</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-dim)' }}>{data.insightsPending}</div>
            </div>
            <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>Not measurable</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-dim)' }}>{data.insightsUnmeasurable}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 2 }}>approved before this tracking existed</div>
            </div>
          </div>

          {monthsWithData.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              No approved insights have measurable post-approval data yet. This fills in as insights get approved
              and metrics sync in afterward.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '8px 6px' }}>Month</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Measured impact</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Insights contributing</th>
                    <th style={{ padding: '8px 6px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.insightsContributing > 0)
                    .map((r) => (
                      <tr key={r.monthKey} style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td style={{ padding: '8px 6px' }}>{r.label}</td>
                        <td
                          style={{
                            padding: '8px 6px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: r.measuredImpactValueCents >= 0 ? 'var(--text)' : '#ef4444',
                          }}
                        >
                          {money(r.measuredImpactValueCents)}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{r.insightsContributing}</td>
                        <td style={{ padding: '8px 6px', width: 120 }}>
                          <div style={{ background: 'var(--bg-alt)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.max(4, (Math.abs(r.measuredImpactValueCents) / maxAbsImpact) * 100)}%`,
                                background: r.measuredImpactValueCents >= 0 ? 'var(--accent-grad, #6d5efc)' : '#ef4444',
                                height: '100%',
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
