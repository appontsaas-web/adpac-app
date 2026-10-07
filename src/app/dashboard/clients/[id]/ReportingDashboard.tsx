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
  purchases: number;
  storeVisits: number;
  mapClicks: number;
  localActionsDirections: number;
  businessProfileDirections: number;
  avgSearchImpressionSharePct: number | null;
  avgSearchBudgetLostSharePct: number | null;
  avgSearchRankLostSharePct: number | null;
  avgSearchTopImpressionSharePct: number | null;
  avgSearchAbsoluteTopImpressionSharePct: number | null;
}

interface AudienceBucket {
  value: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
}

interface AudienceResponse {
  device: AudienceBucket[];
  ageRange: AudienceBucket[];
  gender: AudienceBucket[];
  location: AudienceBucket[];
  region: AudienceBucket[];
  dayOfWeek: AudienceBucket[];
  hour: AudienceBucket[];
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
  hiddenFromList: boolean;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
  biddingStrategyType: string | null;
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

// % change from `previous` to `current`, or null when there's no meaningful
// baseline (previous period had nothing) — shown as "—" rather than a
// misleading "+∞%"/"0%".
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export default function ReportingDashboard({
  googleAdsAccountId,
  isAdmin,
}: {
  googleAdsAccountId: string;
  isAdmin?: boolean;
}) {
  const { tr, money, t, num } = useI18n();
  const [days, setDays] = useState(30);
  // A non-null customRange overrides `days` everywhere below — set by
  // typing dates and clicking Apply, cleared by picking a preset button.
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | null>(null);
  const [sinceInput, setSinceInput] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return fmtDate(d);
  });
  const [untilInput, setUntilInput] = useState(() => fmtDate(new Date()));
  const [dateError, setDateError] = useState<string | null>(null);

  // Which KPI cards an admin has hidden for this user's position (empty for
  // admins — see /api/metric-visibility's doc comment). Fetched once on
  // mount, independent of the main `load()` cycle below — it doesn't change
  // while the dashboard is open.
  const [hiddenMetrics, setHiddenMetrics] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch('/api/metric-visibility?platform=google')
      .then((res) => (res.ok ? res.json() : { hidden: [] }))
      .then((d) => setHiddenMetrics(new Set(d.hidden ?? [])))
      .catch(() => {});
  }, []);

  const [data, setData] = useState<MetricsResponse | null>(null);
  const [audience, setAudience] = useState<AudienceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showHiddenCampaigns, setShowHiddenCampaigns] = useState(false);
  const [togglingHiddenId, setTogglingHiddenId] = useState<string | null>(null);

  // Comparison period — "None" by default. previous_period/month/year are
  // computed automatically off whatever the current since/until resolve to;
  // "Custom" reveals its own pair of date inputs so any prior range can be
  // picked (e.g. a specific past campaign, not just an adjacent period).
  const [compareMode, setCompareMode] = useState<CompareMode>('none');
  const [compareSinceInput, setCompareSinceInput] = useState('');
  const [compareUntilInput, setCompareUntilInput] = useState('');
  const [compareRangeLabel, setCompareRangeLabel] = useState<string | null>(null);
  const [compareTotals, setCompareTotals] = useState<Totals | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Campaign + audience (age/gender/region) filters — narrow the KPI
  // totals, chart, and audience tables below to a single campaign and/or a
  // single audience segment. campaignOptions is populated once from the
  // first unfiltered load (a filtered response only contains the selected
  // campaign, which isn't enough to build the dropdown) and then left
  // alone. Audience filtering can only apply one dimension at a time — see
  // the comment on GET /api/metrics for why age+gender+region can't be
  // combined into a single AND filter with the current data model.
  const [campaignFilter, setCampaignFilter] = useState('');
  const [campaignOptions, setCampaignOptions] = useState<{ id: string; name: string }[]>([]);
  const [audienceDim, setAudienceDim] = useState<'' | 'age_range' | 'gender' | 'region'>('');
  const [audienceVal, setAudienceVal] = useState('');

  // Report builder — lets someone pick which blocks land in the exported
  // PDF instead of always getting the fixed, everything-included report.
  // Defaults to all sections checked so the common case (one click, get the
  // full report) still works exactly like before this existed.
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [reportSections, setReportSections] = useState({
    kpis: true,
    trend: true,
    campaigns: true,
    audience: true,
    comparison: true,
  });

  // The currently-viewed range as real Date objects, regardless of whether
  // it came from a preset (`days`) or a custom range — used both for the
  // fetch below and to derive the comparison range.
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
    // previous_year
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
      const rangeQuery = customRange
        ? `since=${customRange.since}&until=${customRange.until}`
        : `days=${days}`;
      const hiddenQuery = isAdmin && showHiddenCampaigns ? '&includeHidden=1' : '';
      const campaignQuery = campaignFilter ? `&campaignId=${campaignFilter}` : '';
      const audienceQuery = audienceDim && audienceVal ? `&audienceDimension=${audienceDim}&audienceValue=${encodeURIComponent(audienceVal)}` : '';
      const [metricsRes, audienceRes] = await Promise.all([
        fetch(`/api/metrics?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}${hiddenQuery}${campaignQuery}${audienceQuery}`),
        fetch(`/api/metrics/audience?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}${campaignQuery}`),
      ]);
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
      if (audienceRes.ok) {
        setAudience(await audienceRes.json());
      }

      const compareRange = resolveCompareRange();
      if (!compareRange) {
        setCompareTotals(null);
        setCompareRangeLabel(null);
      } else {
        const compareRes = await fetch(
          `/api/metrics?googleAdsAccountId=${googleAdsAccountId}&since=${compareRange.since}&until=${compareRange.until}${campaignQuery}${audienceQuery}`
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
  }, [googleAdsAccountId, days, customRange, isAdmin, showHiddenCampaigns, compareMode, compareSinceInput, compareUntilInput, campaignFilter, audienceDim, audienceVal]);

  useEffect(() => {
    load();
  }, [load]);

  // Admin-only: hides/unhides a campaign from this table (and the Campaigns
  // list elsewhere) — purely a local display preference, never touches
  // Google Ads or the underlying performance numbers above.
  async function handleToggleHidden(campaignId: string, currentlyHidden: boolean) {
    setTogglingHiddenId(campaignId);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
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
      const res = await fetch(`/api/metrics/sync?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}`, {
        method: 'POST',
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `Sync failed (${res.status})`);
        return;
      }
      if (d.errors?.length) {
        setError(d.errors.join('; '));
      } else {
        const statusNote = d.statusReconciled > 0 ? ` Updated status on ${d.statusReconciled} campaign(s) to match Google Ads.` : '';
        setSyncMessage(
          `${label}: synced ${d.synced ?? 0} performance rows and ${d.audienceSynced ?? 0} audience rows from Google Ads.${statusNote}`
        );
      }
      await load();
    } catch (err: any) {
      setError(err.message ?? tr("Sync failed — network error"));
    } finally {
      setSyncing(false);
    }
  }

  // "Sync now" refreshes whatever period is currently being viewed (preset
  // or custom range). "Backfill 12 months" is a separate, explicit pull of
  // a full year of history — useful once, e.g. right after connecting an
  // account that's had live campaigns running for a while, so the dashboard
  // isn't limited to only whatever's been synced day-by-day since you
  // started using AdPac.
  const handleSync = () =>
    runSync(customRange ? `since=${customRange.since}&until=${customRange.until}` : `days=${days}`, 'Sync');
  const handleBackfill = () => runSync('days=365', 'Backfill (12 months)');

  // Downloads the current view (same date range, campaign filter, and
  // audience filter as what's on screen — plus the active comparison range,
  // if any) as an AdPac-branded PDF via GET /api/reports/export. A plain
  // navigation (not fetch+blob) is enough since the route responds with
  // Content-Disposition: attachment and the browser is already
  // authenticated via its session cookie.
  function handleExport(sections?: typeof reportSections) {
    const { since, until } = resolveCurrentRange();
    const params = new URLSearchParams({
      platform: 'google',
      accountId: googleAdsAccountId,
      since: fmtDate(since),
      until: fmtDate(until),
    });
    if (campaignFilter) params.set('campaignId', campaignFilter);
    if (audienceDim && audienceVal) {
      params.set('audienceDimension', audienceDim);
      params.set('audienceValue', audienceVal);
    }
    const compareRange = resolveCompareRange();
    if (compareRange) {
      params.set('compareSince', compareRange.since);
      params.set('compareUntil', compareRange.until);
    }
    // Only send `sections` when the builder was actually used — omitting it
    // means "include everything" on the API side, so the quick one-click
    // "Export PDF (all)" button below keeps working exactly as before.
    if (sections) {
      const picked = Object.entries(sections).filter(([, v]) => v).map(([k]) => k);
      params.set('sections', picked.join(','));
    }
    window.open(`/api/reports/export?${params.toString()}`, '_blank');
  }

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
          <button className="btn btn-secondary" onClick={handleBackfill} disabled={syncing} title={tr("Pull a full year of history from Google Ads, not just the currently viewed period")}>
            {syncing ? tr("Syncing…") : tr("Backfill 12 months")}
          </button>
          <button className="btn btn-secondary" onClick={() => handleExport()} title={tr("Download an AdPac-branded PDF with every section included")}>
            {tr("Export PDF")}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowReportBuilder((v) => !v)}
              title={tr("Choose which sections to include before generating")}
            >
              {tr("Build report ▾")}
            </button>
            {showReportBuilder && (
              <div
                style={{
                  position: 'absolute',
                  top: '110%',
                  right: 0,
                  zIndex: 20,
                  background: 'var(--bg-alt)',
                  border: '1px solid var(--card-border)',
                  borderRadius: 10,
                  padding: 14,
                  width: 220,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>{tr("Include in report")}</div>
                {(
                  [
                    { key: 'kpis', label: 'KPI summary' },
                    { key: 'trend', label: 'Spend trend chart' },
                    { key: 'campaigns', label: 'Campaign breakdown' },
                    { key: 'audience', label: 'Audience & placement' },
                    { key: 'comparison', label: 'Period comparison', disabled: compareMode === 'none' },
                  ] as const
                ).map((s) => (
                  <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', marginBottom: 6, opacity: (s as any).disabled ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      checked={reportSections[s.key as keyof typeof reportSections]}
                      disabled={(s as any).disabled}
                      onChange={(e) => setReportSections((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                    />
                    {tr(s.label)}
                  </label>
                ))}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: 8, fontSize: '0.8rem', padding: '6px 0' }}
                  disabled={!Object.values(reportSections).some(Boolean)}
                  onClick={() => {
                    handleExport(reportSections);
                    setShowReportBuilder(false);
                  }}
                >
                  {tr("Generate PDF")}
                </button>
              </div>
            )}
          </div>
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
        {compareRangeLabel && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{tr("vs")}{' '}{compareRangeLabel}</span>
        )}
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
        <select
          value={audienceDim}
          onChange={(e) => {
            setAudienceDim(e.target.value as typeof audienceDim);
            setAudienceVal('');
          }}
          style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
        >
          <option value="">{tr("Any audience")}</option>
          <option value="age_range">{tr("Age")}</option>
          <option value="gender">{tr("Gender")}</option>
          <option value="region">{tr("Region")}</option>
        </select>
        {audienceDim && (
          <select
            value={audienceVal}
            onChange={(e) => setAudienceVal(e.target.value)}
            style={{ margin: 0, width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
          >
            <option value="">{tr("Select a value…")}</option>
            {(audienceDim === 'age_range' ? audience?.ageRange : audienceDim === 'gender' ? audience?.gender : audience?.region)?.map((b) => (
              <option key={b.value} value={b.value}>
                {prettifyLabel(b.value)}
              </option>
            ))}
          </select>
        )}
        {(campaignFilter || (audienceDim && audienceVal)) && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '5px 10px' }}
            onClick={() => {
              setCampaignFilter('');
              setAudienceDim('');
              setAudienceVal('');
            }}
          >
            {tr("Clear filters")}
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
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
            {!hiddenMetrics.has('purchases') && <KpiCard label={t('metrics.purchases')} value={num(data.totals.purchases)} delta={compareTotals && pctChange(data.totals.purchases, compareTotals.purchases)} />}
            {!hiddenMetrics.has('storeVisits') && <KpiCard label={t('metrics.storeVisits')} value={num(data.totals.storeVisits)} delta={compareTotals && pctChange(data.totals.storeVisits, compareTotals.storeVisits)} />}
            {!hiddenMetrics.has('mapClicks') && <KpiCard label={t('metrics.mapClicks')} value={num(data.totals.mapClicks)} delta={compareTotals && pctChange(data.totals.mapClicks, compareTotals.mapClicks)} />}
            {!hiddenMetrics.has('localActionsDirections') && <KpiCard label={t('metrics.localActionsDirections')} value={num(data.totals.localActionsDirections)} delta={compareTotals && pctChange(data.totals.localActionsDirections, compareTotals.localActionsDirections)} />}
            {!hiddenMetrics.has('businessProfileDirections') && <KpiCard label={t('metrics.businessProfileDirections')} value={num(data.totals.businessProfileDirections)} delta={compareTotals && pctChange(data.totals.businessProfileDirections, compareTotals.businessProfileDirections)} />}
            {!hiddenMetrics.has('searchImpressionShare') && data.totals.avgSearchImpressionSharePct !== null && (
              <KpiCard label={t('metrics.searchImpressionShare')} value={`${data.totals.avgSearchImpressionSharePct.toFixed(1)}%`} />
            )}
            {!hiddenMetrics.has('budgetLostShare') && data.totals.avgSearchBudgetLostSharePct !== null && (
              <KpiCard label={t('metrics.budgetLostShare')} value={`${data.totals.avgSearchBudgetLostSharePct.toFixed(1)}%`} />
            )}
            {!hiddenMetrics.has('rankLostShare') && data.totals.avgSearchRankLostSharePct !== null && (
              <KpiCard label={t('metrics.rankLostShare')} value={`${data.totals.avgSearchRankLostSharePct.toFixed(1)}%`} />
            )}
            {!hiddenMetrics.has('topImpressionRate') && data.totals.avgSearchTopImpressionSharePct !== null && (
              <KpiCard label={t('metrics.topImpressionRate')} value={`${data.totals.avgSearchTopImpressionSharePct.toFixed(1)}%`} />
            )}
            {!hiddenMetrics.has('absTopImpressionRate') && data.totals.avgSearchAbsoluteTopImpressionSharePct !== null && (
              <KpiCard label={t('metrics.absTopImpressionRate')} value={`${data.totals.avgSearchAbsoluteTopImpressionSharePct.toFixed(1)}%`} />
            )}
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
                    <th style={{ padding: '8px 6px' }}>{tr("Status")}</th>
                    <th style={{ padding: '8px 6px' }}>{tr("Bid strategy")}</th>
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
                      <td style={{ padding: '8px 6px' }}>
                        <span className={`badge badge-${c.status.toLowerCase().replace('_approval', '').replace('pending', 'pending')}`}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                        {c.biddingStrategyType ? c.biddingStrategyType.replaceAll('_', ' ').toLowerCase() : '—'}
                      </td>
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

          {audience && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: 12 }}>{tr("Audience")}</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 16,
                }}
              >
                <AudienceTable title={tr("Device")} buckets={audience.device} />
                <AudienceTable title={tr("Age")} buckets={audience.ageRange} />
                <AudienceTable title={tr("Gender")} buckets={audience.gender} />
                <AudienceTable title={tr("Country")} buckets={audience.location} />
                <AudienceTable title={tr("Region")} buckets={audience.region} />
                <AudienceTable title={tr("Day of week")} buckets={audience.dayOfWeek} />
                <AudienceTable title={tr("Hour of day")} buckets={audience.hour} sortByCost={false} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Google returns raw enum-style values for device/age/gender (e.g.
// "AGE_RANGE_25_34", "MOBILE", "FEMALE") but real place names for location
// (e.g. "Beirut") — this makes the enum ones readable without a lookup
// table, and leaves already-readable location names untouched.
function prettifyLabel(raw: string): string {
  if (raw.startsWith('AGE_RANGE_')) {
    const rest = raw.replace('AGE_RANGE_', '').replace('_', '-');
    return rest.charAt(0) + rest.slice(1).toLowerCase();
  }
  if (/^\d+$/.test(raw)) {
    // Hour-of-day bucket ("14") — shown as a time, not a bare number.
    return `${raw.padStart(2, '0')}:00`;
  }
  if (/^[A-Z_]+$/.test(raw)) {
    return raw
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return raw;
}

function AudienceTable({
  title,
  buckets,
  sortByCost = true,
}: {
  title: string;
  buckets: AudienceBucket[];
  // Hour-of-day is already sorted chronologically by the API so a
  // schedule reads left-to-right/top-to-bottom in time order — showing
  // just the top-6-by-cost like every other breakdown would scramble that.
  sortByCost?: boolean;
}) {
  const { tr, money, num } = useI18n();
  const top = sortByCost ? buckets.slice(0, 6) : buckets;
  return (
    <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {top.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', margin: 0 }}>{tr("No data yet.")}</p>
      ) : (
        <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
          <tbody>
            {top.map((b) => (
              <tr key={b.value}>
                <td style={{ padding: '3px 0', color: 'var(--text-dim)' }}>{prettifyLabel(b.value)}</td>
                <td style={{ padding: '3px 0', textAlign: 'right' }}>{money(b.costCents)}</td>
                <td style={{ padding: '3px 0', textAlign: 'right', color: 'var(--text-dim)' }}>
                  {num(b.conversions)} {tr("conv.")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// `delta` is the % change vs. the comparison period, when one is selected —
// null/undefined renders nothing. Deliberately not colored good/red vs.
// bad/green: "spend up 12%" isn't inherently bad, so this just states the
// direction and magnitude and lets the person reading it judge that in
// context, rather than the dashboard editorializing.
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
