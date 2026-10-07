'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';

import { useState, useEffect, useCallback } from 'react';

interface MonthRow {
  monthKey: string;
  label: string;
  totalConversionValueCents: number;
  optimizationRatePercent: number;
  impactValueCents: number;
  isOverride: boolean;
  tokensSpent: number;
}

interface ImpactResponse {
  months: MonthRow[];
}


function fmtTokens(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Showcase card — see /api/ai-insights/impact for the important caveat: the
// optimization rate is a placeholder, not a measured figure, unless an admin
// has set an explicit override for that month (see /override route). Always
// runs from July 2026 (when this showcase's tracking starts) through the
// current month — broken down by calendar month so months can be compared
// side by side.
export default function AIImpactCard({ clientId, isAdmin }: { clientId: string; isAdmin?: boolean }) {
  const { moneyUsd: money } = useI18n();
  const [data, setData] = useState<ImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingMonth, setSavingMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-insights/impact?clientId=${clientId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to load impact data (${res.status})`);
        return;
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load impact data — network error');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(r: MonthRow) {
    setEditingMonth(r.monthKey);
    setEditValue(r.optimizationRatePercent.toFixed(2));
    setError(null);
  }

  async function saveEdit(monthKey: string) {
    const rate = Number(editValue);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError('Enter a valid rate between 0 and 100.');
      return;
    }
    setSavingMonth(monthKey);
    setError(null);
    try {
      const res = await fetch('/api/ai-insights/impact/override', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, monthKey, optimizationRatePercent: rate }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to save override');
        return;
      }
      setEditingMonth(null);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save override — network error');
    } finally {
      setSavingMonth(null);
    }
  }

  async function resetToPlaceholder(monthKey: string) {
    setSavingMonth(monthKey);
    setError(null);
    try {
      const res = await fetch(`/api/ai-insights/impact/override?clientId=${clientId}&monthKey=${monthKey}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to reset month');
        return;
      }
      setEditingMonth(null);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to reset month — network error');
    } finally {
      setSavingMonth(null);
    }
  }

  const rows = data?.months ?? [];
  const maxImpact = Math.max(...rows.map((r) => r.impactValueCents), 1);
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const rateDelta = latest && previous ? latest.optimizationRatePercent - previous.optimizationRatePercent : null;

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>AI optimization impact</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 12 }}>
        Estimated impact of AI-approved optimizations on conversion value, by month, since July 2026. Tokens spent
        (1 token per $0.50 of impact value) is drawn from that same impact figure, but locked in daily rather than
        once a month — each day's tokens are that day's share of month-to-date ad spend, applied to the
        month-to-date impact value, as each day syncs.
        {isAdmin && ' Click Edit on a month to set a specific rate.'}
      </p>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      {loading && !data && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
          <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{latest.label} rate</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent2)' }}>
              {latest.optimizationRatePercent.toFixed(2)}%
            </div>
            {rateDelta !== null && (
              <div style={{ fontSize: '0.75rem', color: rateDelta >= 0 ? 'var(--accent2)' : '#ef4444', marginTop: 2 }}>
                {rateDelta >= 0 ? '+' : ''}
                {rateDelta.toFixed(2)}pp vs {previous!.label}
              </div>
            )}
          </div>
          <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{latest.label} impact value</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{money(latest.impactValueCents)}</div>
          </div>
          <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{latest.label} tokens spent</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ef4444' }}>-{fmtTokens(latest.tokensSpent)}</div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                <th style={{ padding: '8px 6px' }}>Month</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Optimization rate</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Impact value</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Tokens spent</th>
                <th style={{ padding: '8px 6px' }}></th>
                {isAdmin && <th style={{ padding: '8px 6px' }}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isEditing = editingMonth === r.monthKey;
                return (
                  <tr key={r.monthKey} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>
                      {r.label}
                      {r.isOverride && (
                        <span
                          className="badge badge-draft"
                          style={{ marginLeft: 6, fontSize: '0.65rem', verticalAlign: 'middle' }}
                          title="Manually set by an admin"
                        >
                          set
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          style={{ margin: 0, width: 80, textAlign: 'right', display: 'inline-block' }}
                          autoFocus
                        />
                      ) : (
                        `${r.optimizationRatePercent.toFixed(2)}%`
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{money(r.impactValueCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#ef4444' }}>-{fmtTokens(r.tokensSpent)}</td>
                    <td style={{ padding: '8px 6px', width: 120 }}>
                      <div style={{ background: 'var(--bg-alt)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.max(4, (r.impactValueCents / maxImpact) * 100)}%`,
                            background: 'var(--accent-grad, #6d5efc)',
                            height: '100%',
                          }}
                        />
                      </div>
                    </td>
                    {isAdmin && (
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <>
                            <button
                              className="btn"
                              style={{ fontSize: '0.72rem', padding: '3px 8px', marginRight: 4 }}
                              onClick={() => saveEdit(r.monthKey)}
                              disabled={savingMonth === r.monthKey}
                            >
                              {savingMonth === r.monthKey ? '…' : 'Save'}
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                              onClick={() => setEditingMonth(null)}
                              disabled={savingMonth === r.monthKey}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.72rem', padding: '3px 8px', marginRight: 4 }}
                              onClick={() => startEdit(r)}
                            >
                              Edit
                            </button>
                            {r.isOverride && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                onClick={() => resetToPlaceholder(r.monthKey)}
                                disabled={savingMonth === r.monthKey}
                                title="Clear the manual value and go back to the auto-generated placeholder"
                              >
                                Reset
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
