// ---------------------------------------------------------------------------
// Canonical metric key/label lists per ad platform — the single source of
// truth shared by two otherwise-unrelated things: the admin metric-visibility
// checklist (PositionsManager.tsx, via /api/positions/[id]/metric-visibility)
// and each platform dashboard's own KPI card rendering (ReportingDashboard /
// MetaReportingDashboard / SnapReportingDashboard, via /api/metric-visibility).
// Keeping this in one file means a metric hidden here is guaranteed to use
// the same key both places — the alternative (each dashboard inventing its
// own key strings ad hoc) risks a checkbox that silently does nothing because
// the key it writes doesn't match the key the dashboard checks for.
//
// IMPORTANT: if a KPI card is ever added to/removed from a dashboard, this
// list must be updated to match, or the new card either can't be hidden (not
// in the catalog) or an old HiddenMetric row references a key nothing reads
// anymore (harmless, just dead data).
// ---------------------------------------------------------------------------

export interface MetricCatalogEntry {
  key: string;
  label: string;
}

export const METRIC_PLATFORMS = ['google', 'meta', 'snapchat', 'tiktok'] as const;
export type MetricPlatform = (typeof METRIC_PLATFORMS)[number];

export const METRIC_CATALOG: Record<MetricPlatform, MetricCatalogEntry[]> = {
  google: [
    { key: 'spend', label: 'Spend' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'ctr', label: 'CTR' },
    { key: 'avgCpc', label: 'Avg. CPC' },
    { key: 'conversions', label: 'Conversions' },
    { key: 'costPerConversion', label: 'Cost / conversion' },
    { key: 'conversionValue', label: 'Conversion value' },
    { key: 'roas', label: 'ROAS' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'storeVisits', label: 'Store visits' },
    { key: 'mapClicks', label: 'Map clicks' },
    { key: 'localActionsDirections', label: 'Local actions - Directions' },
    { key: 'businessProfileDirections', label: 'Business profile - Directions' },
    { key: 'searchImpressionShare', label: 'Search impr. share' },
    { key: 'budgetLostShare', label: 'Impr. share lost (budget)' },
    { key: 'rankLostShare', label: 'Impr. share lost (rank)' },
    { key: 'topImpressionRate', label: 'Top of page rate' },
    { key: 'absTopImpressionRate', label: 'Abs. top of page rate' },
  ],
  meta: [
    { key: 'spend', label: 'Spend' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'ctr', label: 'CTR' },
    { key: 'avgCpc', label: 'Avg. CPC' },
    { key: 'conversions', label: 'Conversions' },
    { key: 'costPerConversion', label: 'Cost / conversion' },
    { key: 'conversionValue', label: 'Conversion value' },
    { key: 'roas', label: 'ROAS' },
    { key: 'cpm', label: 'CPM' },
    { key: 'avgDailyReach', label: 'Avg. daily reach' },
  ],
  snapchat: [
    { key: 'spend', label: 'Spend' },
    { key: 'clicks', label: 'Clicks (swipes)' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'ctr', label: 'CTR' },
    { key: 'avgCpc', label: 'Avg. CPC' },
    { key: 'conversions', label: 'Conversions' },
    { key: 'costPerConversion', label: 'Cost / conversion' },
    { key: 'conversionValue', label: 'Conversion value' },
    { key: 'roas', label: 'ROAS' },
  ],
  tiktok: [
    { key: 'spend', label: 'Spend' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'ctr', label: 'CTR' },
    { key: 'avgCpc', label: 'Avg. CPC' },
    { key: 'conversions', label: 'Conversions' },
    { key: 'costPerConversion', label: 'Cost / conversion' },
    { key: 'conversionValue', label: 'Conversion value' },
    { key: 'roas', label: 'ROAS' },
  ],
};

export function isMetricPlatform(value: string): value is MetricPlatform {
  return (METRIC_PLATFORMS as readonly string[]).includes(value);
}
