'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';

import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Totals {
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
  ctr: number;
  avgCpcCents: number;
  costPerConversionCents: number;
  roas: number;
}

interface DailyPoint {
  date: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
}

interface CampaignRow {
  campaignId: string;
  name: string;
  status: string;
  objective: string;
  dailyBudgetCents: number | null;
  hiddenFromList: boolean;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

interface MetricsResponse {
  totals: Totals;
  daily: DailyPoint[];
  campaigns: CampaignRow[];
  hiddenCount: number;
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
];

type CompareMode = 'none' | 'previous_period' | 'previous_month' | 'previous_year' | 'custom';

const COMPARE_OPTIONS: { mode: CompareMode; label: string }[] = [
  { mode: 'none', label: 'None' },
  { mode: 'previous_period', label: 'Previous period' },
  { mode: 'previous_month', label: 'Previous month' },
  { mode: 'previous_year', label: 'Previous year' },
  { mode: 'custom', label: 'Custom' },
];


function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// The TikTok counterpart to SnapReportingDashboard/MetaReportingDashboard/
// ReportingDashboard — same KPI-cards + trend-chart + comparison-period +
// campaign-filter + per-campaign-table shape as the other platforms. No
// audience/placement breakdown yet (TikTok's Reporting API supports it via
// additional dimensions — see lib/tiktok.ts — just not wired into the sync
// yet, a natural follow-up matching what Meta got in a second pass).
export default function TikTokReportingDashboard({
  tiktokAdAccountId,
  isAdmin,
}: {
  tiktokAdAccountId: string;
  isAdmin?: boolean;
}) {
  const { tr, money, t, num } = useI18n();
  const [days, setDays] = useState(30);
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | null>(null);
  const [sinceInput, setSinceInput] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return fmtDate(d);
  });
  const [untilInput, setUntilInput] = useState(() => fmtDate(new Date()));
  const [dateError, setDateError] = useState<string | null>(null);

  const [hiddenMetrics, setHiddenMetrics] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch('/api/metric-visibility?platform=tiktok')
      .then((res) => (res.ok ? res.json() : { hidden: [] }))
      .then((d) => setHiddenMetrics(new Set(d.hidden ?? [])))
      .catch(() => {});
  }, []);

  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showHiddenCampaigns, setShowHiddenCampaigns] = useState(false);
  const [togglingHiddenId, setTogglingHiddenId] = useState<string | null>(null);

  const [compareMode, setCompareMode] = useState<CompareMode>('none');
  const [compareSinceInput, setCompareSinceInput] = useState('');
  const [compareUntilInput, setCompareUntilInput] = useState('');
  const [compareRangeLabel, setCompareRangeLabel] = useState<string | null>(null);
  const [compareTotals, setCompareTotals] = useState<Totals | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [campaignFilter, setCampaignFilter] = useState('');
  const [campaignOptions, setCampaignOptions] = useState<{ id: string; name: string }[]>([]);

  function resolveCurrentRange(): { since: Date; until: Date } {
    if (customRange) {
      return { since: new Date(customRange.since), until: new Date(customRange.until) };
    }
    const until = new Date();
    const since = new Date();
    since.setDate(since.getDate() - days);
    return { since, until };
  }

  function resolveCompareRange(): { since: string; until: string } | null {
    if (compareMode === 'none') return null;
    if (compareMode === 'custom') {
      if (!compareSinceInput || !compareUntilInput) return null;
      return { since: compareSinceInput, until: compareUntilInput };
    }
    const { since, until } = resolveCurrentRange();
    const lengthMs = until.getTime() - since.getTime();
    if (compareMode === 'previous_period') {
      const newUntil = new Date(since.getTime() - 24 * 60 * 60 * 1000);
      const newSince = new Date(newUntil.getTime() - lengthMs);
      return { since: fmtDate(newSince), until: fmtDate(newUntil) };
    }
    if (compareMode === 'previous_month') {
      const newSince = new Date(since);
      newSince.setMonth(newSince.getMonth() - 1);
      const newUntil = new Date(until);
      newUntil.setMonth(newUntil.getMonth() - 1);
      return { since: fmtDate(newSince), until: fmtDate(newUntil) };
    }
    const newSince = new Date(since);
    newSince.setFullYear(newSince.getFullYear() - 1);
    const newUntil = new Date(until);
    newUntil.setFullYear(newUntil.getFullYear() - 1);
    return { since: fmtDate(newSince), until: fmtDate(newUntil) };
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCompareError(null);
    try {
      const rangeQuery = customRange ? `since=${customRange.since}&until=${customRange.until}` : `days=${days}`;
      const hiddenQuery = isAdmin && showHiddenCampaigns ? '&includeHidden=1' : '';
      const campaignQuery = campaignFilter ? `&campaignId=${campaignFilter}` : '';
      const metricsRes = await fetch(`/api/tiktok-metrics?tiktokAdAccountId=${tiktokAdAccountId}&${rangeQuery}${hiddenQuery}${campaignQuery}`);
      if (!metricsRes.ok) {
        const d = await metricsRes.json().catch(() => ({}));
        setError(d.error ?? `Failed to load metrics (${metricsRes.status})`);
        return;
      }
      const metricsData: MetricsResponse = await metricsRes.json();
      setData(metricsData);
      if (!campaignFilter) {
        setCampaignOptions(metricsData.campaigns.map((c) => ({ id: c.campaignId, name: c.name })));
      }

      const compareRange = resolveCompareRange();
      if (!compareRange) {
        setCompareTotals(null);
        setCompareRangeLabel(null);
      } else {
        const compareRes = await fetch(
          `/api/tiktok-metrics?tiktokAdAccountId=${tiktokAdAccountId}&since=${compareRange.since}&until=${compareRange.until}${campaignQuery}`
        );
        if (!compareRes.ok) {
          const d = await compareRes.json().catch(() => ({}));
          setCompareError(d.error ?? 'Failed to load comparison period');
          setCompareTotals(null);
          setCompareRangeLabel(null);
        } else {
          const compareData: MetricsResponse = await compareRes.json();
          setCompareTotals(compareData.totals);
          setCompareRangeLabel(`${compareRange.since} → ${compareRange.until}`);
        }
      }
    } catch (err: any) {
      setError(err.message ?? tr("Failed to load metrics — network error"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiktokAdAccountId, days, customRange, isAdmin, showHiddenCampaigns, compareMode, compareSinceInput, compareUntilInput, campaignFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleHidden(campaignId: string, currentlyHidden: boolean) {
    setTogglingHiddenId(campaignId);
    setError(null);
    try {
      const res = await fetch(`/api/tiktok-campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenFromList: !currentlyHidden }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to update"));
        return;
      }
      await load();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to update — network error"));
    } finally {
      setTogglingHiddenId(null);
    }
  }

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

  async function runSync(rangeQuery: string, label: string) {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/tiktok/sync?accountId=${tiktokAdAccountId}&${rangeQuery}`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `Sync failed (${res.status})`);
        return;
      }
      if (d.errors?.length) {
        setError(d.errors.join('; '));
      } else {
        setSyncMessage(`${label}: synced ${d.campaignsSynced ?? 0} campaign(s) and ${d.metricsSynced ?? 0} metric row(s) from TikTok.`);
      }
      await load();
    } catch (err: any) {
      setError(err.message ?? tr("Sync failed — network error"));
    } finally {
      setSyncing(false);
    }
  }

  const handleSync = () => runSync(customRange ? `since=${customRange.since}&until=${customRange.until}` : `days=${days}`, 'Sync');
  const handleBackfill = () => runSync('days=365', 'Backfill (12 months)');

  const chartData =
    data?.daily.map((d) => ({
      date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      spend: d.costCents / 100,
      conversions: d.conversions,
    })) ?? [];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr("Performance")}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                {tr(r.label)}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? tr("Syncing…") : tr("Sync now")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleBackfill}
            disabled={syncing}
            title={tr("Pull a full year of history from TikTok, not just the currently viewed period")}
          >
            {syncing ? tr("Syncing…") : tr("Backfill 12 months")}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{tr("Custom range:")}</span>
        <input
          type="date"
          value={sinceInput}
          onChange={(e) => setSinceInput(e.target.value)}
          style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
        />
        <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{tr("to")}</span>
        <input
          type="date"
          value={untilInput}
          onChange={(e) => setUntilInput(e.target.value)}
          style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
        />
        <button className="btn btn-secondary" onClick={applyCustomRange} style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
          {tr("Apply")}
        </button>
        {customRange && (
          <span style={{ fontSize: '0.78rem', color: 'var(--accent2)' }}>
            {tr("Showing")}{' '}{customRange.since} → {customRange.until}
          </span>
        )}
      </div>
      {dateError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: 10 }}>{dateError}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{tr("Compare to:")}</span>
        <div style={{ display: 'flex', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
          {COMPARE_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => setCompareMode(opt.mode)}
              style={{
                padding: '5px 10px',
                fontSize: '0.78rem',
                border: 'none',
                cursor: 'pointer',
                background: compareMode === opt.mode ? 'var(--accent-grad)' : 'transparent',
                color: compareMode === opt.mode ? '#0a0b10' : 'var(--text-dim)',
                fontWeight: compareMode === opt.mode ? 700 : 400,
              }}
            >
              {tr(opt.label)}
            </button>
          ))}
        </div>
        {compareMode === 'custom' && (
          <>
            <input
              type="date"
              value={compareSinceInput}
              onChange={(e) => setCompareSinceInput(e.target.value)}
              style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
            />
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{tr("to")}</span>
            <input
              type="date"
              value={compareUntilInput}
              onChange={(e) => setCompareUntilInput(e.target.value)}
              style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
            />
          </>
        )}
        {compareRangeLabel && <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{tr("vs")}{' '}{compareRangeLabel}</span>}
      </div>
      {compareError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: 10 }}>{compareError}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{tr("Filter:")}</span>
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
        >
          <option value="">{tr("All campaigns")}</option>
          {campaignOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {campaignFilter && (
          <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => setCampaignFilter('')}>
            {tr("Clear filter")}
          </button>
        )}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      {syncMessage && <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginBottom: 10 }}>{syncMessage}</p>}

      {loading && !data && <p style={{ color: 'var(--text-dim)' }}>{tr("Loading…")}</p>}

      {data && data.daily.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>
          {tr("No performance data yet for this period. Click \"Sync now\" once a campaign has been live for at least a day, or wait for the next scheduled sync.")}
        </p>
      )}

      {data && data.daily.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
            {!hiddenMetrics.has('spend') && <KpiCard label={t('metrics.spend')} value={money(data.totals.costCents)} delta={compareTotals && pctChange(data.totals.costCents, compareTotals.costCents)} />}
            {!hiddenMetrics.has('clicks') && <KpiCard label={t('metrics.clicks')} value={num(data.totals.clicks)} delta={compareTotals && pctChange(data.totals.clicks, compareTotals.clicks)} />}
            {!hiddenMetrics.has('impressions') && <KpiCard label={t('metrics.impressions')} value={num(data.totals.impressions)} delta={compareTotals && pctChange(data.totals.impressions, compareTotals.impressions)} />}
            {!hiddenMetrics.has('ctr') && <KpiCard label={t('metrics.ctr')} value={`${(data.totals.ctr * 100).toFixed(2)}%`} delta={compareTotals && pctChange(data.totals.ctr, compareTotals.ctr)} />}
            {!hiddenMetrics.has('avgCpc') && <KpiCard label={t('metrics.avgCpc')} value={money(data.totals.avgCpcCents)} delta={compareTotals && pctChange(data.totals.avgCpcCents, compareTotals.avgCpcCents)} />}
            {!hiddenMetrics.has('conversions') && <KpiCard label={t('metrics.conversions')} value={num(data.totals.conversions)} delta={compareTotals && pctChange(data.totals.conversions, compareTotals.conversions)} />}
            {!hiddenMetrics.has('costPerConversion') && (
              <KpiCard
                label={t('metrics.costPerConversion')}
                value={data.totals.conversions > 0 ? money(data.totals.costPerConversionCents) : '—'}
                delta={compareTotals && pctChange(data.totals.costPerConversionCents, compareTotals.costPerConversionCents)}
              />
            )}
            {!hiddenMetrics.has('conversionValue') && <KpiCard label={t('metrics.conversionValue')} value={money(data.totals.conversionValueCents)} delta={compareTotals && pctChange(data.totals.conversionValueCents, compareTotals.conversionValueCents)} />}
            {!hiddenMetrics.has('roas') && <KpiCard label={t('metrics.roas')} value={data.totals.costCents > 0 ? `${data.totals.roas.toFixed(2)}x` : '—'} delta={compareTotals && pctChange(data.totals.roas, compareTotals.roas)} />}
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2230" />
              <XAxis dataKey="date" stroke="#9aa0b4" fontSize={12} />
              <YAxis stroke="#9aa0b4" fontSize={12} />
              <Tooltip contentStyle={{ background: '#12141d', border: '1px solid #1f2230', borderRadius: 8 }} />
              <Line type="monotone" dataKey="spend" name="Spend ($)" stroke="#6d5efc" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversions" name="Conversions" stroke="#22d3c9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>

          {(data.campaigns.length > 0 || (isAdmin && data.hiddenCount > 0)) && (
            <div style={{ marginTop: 20, overflowX: 'auto' }}>
              {isAdmin && data.hiddenCount > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowHiddenCampaigns(!showHiddenCampaigns)}
                  style={{ fontSize: '0.78rem', marginBottom: 10 }}
                >
                  {showHiddenCampaigns ? tr("Hide") : tr("Show")} {tr("hidden campaigns (")}{data.hiddenCount})
                </button>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '8px 6px' }}>{tr("Campaign")}</th>
                    <th style={{ padding: '8px 6px' }}>{tr("Objective")}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Daily budget")}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Spend")}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Clicks")}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Impr.")}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                    {isAdmin && <th style={{ padding: '8px 6px' }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.campaignId} style={{ borderBottom: '1px solid var(--card-border)', opacity: c.hiddenFromList ? 0.6 : 1 }}>
                      <td style={{ padding: '8px 6px' }}>{c.name}</td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{c.objective.replaceAll('_', ' ').toLowerCase()}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{c.dailyBudgetCents != null ? money(c.dailyBudgetCents) : '—'}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(c.costCents)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(c.clicks)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(c.impressions)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(c.conversions)}</td>
                      {isAdmin && (
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                            onClick={() => handleToggleHidden(c.campaignId, c.hiddenFromList)}
                            disabled={togglingHiddenId === c.campaignId}
                          >
                            {togglingHiddenId === c.campaignId ? tr("Working…") : c.hiddenFromList ? tr("Unhide") : tr("Hide")}
                          </button>
                        </td>
                      )}
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

function KpiCard({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  const { tr } = useI18n();
  return (
    <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{value}</div>
      {delta !== undefined && delta !== null && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '–'} {Math.abs(delta).toFixed(1)}{tr("% vs. previous")}
        </div>
      )}
    </div>
  );
}
