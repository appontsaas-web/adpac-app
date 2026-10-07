'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';

import { useState, useEffect, useCallback } from 'react';

interface KeywordRow {
  adGroupName: string;
  keywordText: string;
  matchType: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
  avgCpcCents: number;
  qualityScore: number | null;
}

interface SearchTermRow {
  searchTerm: string;
  matchedKeywordText: string | null;
  matchType: string | null;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

interface AdGroupRow {
  adGroupName: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

interface AdRow {
  headline: string;
  status: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

interface ConversionRow {
  value: string;
  conversions: number;
  conversionValueCents: number;
}

interface AssetGroupRow {
  assetGroupName: string;
  status: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

interface AssetPerformanceRow {
  campaignId: string;
  assetGroupId: string;
  assetGroupName: string;
  fieldType: string;
  primaryStatus: string;
  preview: string;
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];


// Google's live per-asset serving status (asset_group_asset.primary_status —
// see lib/googleAds.ts's fetchAssetGroupAssetPerformance doc comment for why
// this isn't the old BEST/GOOD/LOW performance_label, which Google removed
// from this resource). Color it so a scan of the table makes assets that
// aren't fully serving jump out.
function labelColor(status: string) {
  switch (status) {
    case 'ELIGIBLE':
      return '#22c55e';
    case 'LIMITED':
      return '#f59e0b';
    case 'NOT_ELIGIBLE':
    case 'PAUSED':
    case 'REMOVED':
      return '#ef4444';
    case 'PENDING':
      return 'var(--text-dim)';
    default:
      return 'var(--text-dim)';
  }
}

const TABS = ['Keywords', 'Search terms', 'Ad groups', 'Ads', 'Performance Max', 'Conversions'] as const;
type Tab = (typeof TABS)[number];

// Keyword, search-term, ad-group, and ad-level breakdowns — the detail one
// level (or three) below the campaign totals in ReportingDashboard. Tabbed
// rather than four separate cards since they're all "drill into why the
// campaign total looks the way it does" views of the same underlying period.
export default function KeywordAdPerformanceCard({ googleAdsAccountId }: { googleAdsAccountId: string }) {
  const { tr, money, num } = useI18n();
  const [tab, setTab] = useState<Tab>('Keywords');
  const [days, setDays] = useState(30);
  // A non-null customRange overrides `days` — added because the fixed
  // 7d/30d/90d presets can't reach data from a campaign that stopped being
  // live more than 90 days ago. The underlying KeywordMetric/AdGroupMetric/
  // etc. rows are still in the DB (synced while that campaign was live) —
  // without a custom range there was simply no way to ask for them.
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | null>(null);
  const [sinceInput, setSinceInput] = useState('');
  const [untilInput, setUntilInput] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<KeywordRow[] | null>(null);
  const [searchTerms, setSearchTerms] = useState<SearchTermRow[] | null>(null);
  const [adGroups, setAdGroups] = useState<AdGroupRow[] | null>(null);
  const [ads, setAds] = useState<AdRow[] | null>(null);
  const [conversionActions, setConversionActions] = useState<ConversionRow[] | null>(null);
  const [conversionCategories, setConversionCategories] = useState<ConversionRow[] | null>(null);
  const [assetGroups, setAssetGroups] = useState<AssetGroupRow[] | null>(null);
  const [assetPerformance, setAssetPerformance] = useState<AssetPerformanceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeQuery = customRange ? `since=${customRange.since}&until=${customRange.until}` : `days=${days}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kwRes, stRes, adPerfRes, convRes, pmaxRes] = await Promise.all([
        fetch(`/api/metrics/keywords?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}`),
        fetch(`/api/metrics/search-terms?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}`),
        fetch(`/api/metrics/ad-performance?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}`),
        fetch(`/api/metrics/conversions?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}`),
        fetch(`/api/metrics/asset-groups?googleAdsAccountId=${googleAdsAccountId}&${rangeQuery}`),
      ]);
      if (!kwRes.ok || !stRes.ok || !adPerfRes.ok || !convRes.ok || !pmaxRes.ok) {
        const failed = [kwRes, stRes, adPerfRes, convRes, pmaxRes].find((r) => !r.ok);
        const d = await failed?.json().catch(() => ({}));
        setError(d?.error ?? tr("Failed to load keyword/ad performance data"));
        return;
      }
      const kwData = await kwRes.json();
      const stData = await stRes.json();
      const adPerfData = await adPerfRes.json();
      const convData = await convRes.json();
      const pmaxData = await pmaxRes.json();
      setKeywords(kwData.keywords);
      setSearchTerms(stData.searchTerms);
      setAdGroups(adPerfData.adGroups);
      setAds(adPerfData.ads);
      setConversionActions(convData.actions);
      setConversionCategories(convData.categories);
      setAssetGroups(pmaxData.assetGroups);
      setAssetPerformance(pmaxData.assetPerformance);
    } catch (err: any) {
      setError(err.message ?? tr("Failed to load keyword/ad performance data — network error"));
    } finally {
      setLoading(false);
    }
  }, [googleAdsAccountId, rangeQuery]);

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
        <h2 style={{ fontSize: '1.1rem' }}>{tr("Keyword & ad performance")}</h2>
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
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
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
      {loading && !keywords && <p style={{ color: 'var(--text-dim)' }}>{tr("Loading…")}</p>}

      {tab === 'Keywords' && keywords && (
        keywords.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No keyword data yet for this period. Click \"Sync now\" above once campaigns have been live for a day.")}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>{tr("Keyword")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Match")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Ad group")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Spend")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Clicks")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Avg. CPC")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Quality score")}</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{k.keywordText}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{k.matchType}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)' }}>{k.adGroupName}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(k.costCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(k.clicks)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(k.avgCpcCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(k.conversions)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{k.qualityScore ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'Search terms' && searchTerms && (
        searchTerms.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No search-term data yet for this period.")}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>{tr("Search term")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Match type")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Spend")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Clicks")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                </tr>
              </thead>
              <tbody>
                {searchTerms.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{s.searchTerm}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{s.matchType ?? '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(s.costCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(s.clicks)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(s.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'Ad groups' && adGroups && (
        adGroups.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No ad group data yet for this period.")}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>{tr("Ad group")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Spend")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Clicks")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Impr.")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                </tr>
              </thead>
              <tbody>
                {adGroups.map((g, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{g.adGroupName}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(g.costCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(g.clicks)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(g.impressions)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(g.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'Performance Max' && assetGroups && assetPerformance && (
        assetGroups.length === 0 && assetPerformance.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No Performance Max asset groups on this account for this period.")}</p>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {assetGroups.length > 0 && (
              <div>
                <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>{tr("Asset group performance")}</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                        <th style={{ padding: '8px 6px' }}>{tr("Asset group")}</th>
                        <th style={{ padding: '8px 6px' }}>{tr("Status")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Spend")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Clicks")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Impr.")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetGroups.map((g, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '8px 6px' }}>{g.assetGroupName}</td>
                          <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{g.status}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(g.costCents)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(g.clicks)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(g.impressions)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(g.conversions)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(g.conversionValueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {assetPerformance.length > 0 && (
              <div>
                <h3 style={{ fontSize: '0.9rem', marginBottom: 4 }}>{tr("Asset serving status")}</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 8 }}>
                  {tr("Google's live per-asset serving status — a current-state signal, not a time-series metric.")}
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                        <th style={{ padding: '8px 6px' }}>{tr("Asset group")}</th>
                        <th style={{ padding: '8px 6px' }}>{tr("Field type")}</th>
                        <th style={{ padding: '8px 6px' }}>{tr("Asset")}</th>
                        <th style={{ padding: '8px 6px' }}>{tr("Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetPerformance.map((a, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '8px 6px' }}>{a.assetGroupName}</td>
                          <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                            {a.fieldType.replaceAll('_', ' ').toLowerCase()}
                          </td>
                          <td style={{ padding: '8px 6px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.preview}
                          </td>
                          <td style={{ padding: '8px 6px', fontWeight: 700, color: labelColor(a.primaryStatus) }}>
                            {a.primaryStatus}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {tab === 'Conversions' && conversionActions && conversionCategories && (
        conversionActions.length === 0 && conversionCategories.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No conversion data yet for this period.")}</p>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {conversionCategories.length > 0 && (
              <div>
                <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>{tr("By category")}</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                        <th style={{ padding: '8px 6px' }}>{tr("Category")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversionCategories.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '8px 6px' }}>{c.value.replaceAll('_', ' ').toLowerCase()}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(c.conversions)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(c.conversionValueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {conversionActions.length > 0 && (
              <div>
                <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>{tr("By named action")}</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                        <th style={{ padding: '8px 6px' }}>{tr("Conversion action")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversionActions.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '8px 6px' }}>{c.value}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(c.conversions)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(c.conversionValueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {tab === 'Ads' && ads && (
        ads.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No ad-level data yet for this period.")}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>{tr("Ad (headline)")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Status")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Spend")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Clicks")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Conversions")}</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((a, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>{a.headline}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{a.status}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(a.costCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(a.clicks)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{num(a.conversions)}</td>
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
