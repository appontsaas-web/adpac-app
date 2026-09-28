import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics?googleAdsAccountId=xxx&days=30
// GET /api/metrics?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// Aggregates DailyMetric rows for every campaign under a client's connected
// Google Ads account into: overall totals (with derived CTR/CPC/cost-per-
// conversion), a daily time series for charting, and a per-campaign
// breakdown table. Powers the client reporting dashboard. Accepts either a
// rolling `days` window (default) or an explicit `since`/`until` date range
// for picking a specific custom period.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const googleAdsAccountId = req.nextUrl.searchParams.get('googleAdsAccountId');
  if (!googleAdsAccountId) {
    return NextResponse.json({ error: 'googleAdsAccountId is required' }, { status: 400 });
  }

  const account = await db.googleAdsAccount.findUnique({ where: { id: googleAdsAccountId } });
  if (!account) return NextResponse.json({ error: 'Google Ads account not found' }, { status: 404 });
  if (!(await canViewReporting(me, account.clientId))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  const sinceParam = req.nextUrl.searchParams.get('since');
  const untilParam = req.nextUrl.searchParams.get('until');

  let since: Date;
  let until: Date;
  if (sinceParam && untilParam) {
    since = new Date(sinceParam);
    until = new Date(untilParam);
    if (isNaN(since.getTime()) || isNaN(until.getTime())) {
      return NextResponse.json({ error: 'since/until must be valid dates (YYYY-MM-DD)' }, { status: 400 });
    }
    if (since > until) {
      return NextResponse.json({ error: 'since must be before until' }, { status: 400 });
    }
    until.setHours(23, 59, 59, 999);
  } else {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
    since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    until = new Date();
    until.setHours(23, 59, 59, 999);
  }

  // Hidden campaigns (local display preference, admin-only — see
  // Campaign.hiddenFromList) are left out of the per-campaign breakdown table
  // below by default, same as the Campaigns list. This is display-only: the
  // KPI totals and chart above still include every campaign's real spend, so
  // hiding a row here never changes the reported account numbers. Only an
  // admin can pass includeHidden=1 to also see hidden rows in the table.
  const includeHidden = req.nextUrl.searchParams.get('includeHidden') === '1' && me.role === 'ADMIN';

  // Optional campaign filter — narrows everything below (totals, chart,
  // audience breakdowns) to a single campaign, same param name used across
  // every reporting route (Google Ads + Meta) for consistency.
  const campaignIdParam = req.nextUrl.searchParams.get('campaignId');

  const campaigns = await db.campaign.findMany({
    where: { googleAdsAccountId, ...(campaignIdParam ? { id: campaignIdParam } : {}) },
    select: { id: true, name: true, status: true, hiddenFromList: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  // Optional audience filter — e.g. audienceDimension=age_range&
  // audienceValue=AGE_RANGE_25_34. When set, the KPI totals/chart below are
  // sourced from AudienceMetric (already split by that dimension) instead
  // of DailyMetric, so "spend for this campaign, this period, women only"
  // is answerable directly rather than just shown as one row in the
  // Audience breakdown tables further down. Only one dimension at a time —
  // AudienceMetric stores one dimension per row, so age+gender+region can't
  // be combined into a single AND filter without a materially different
  // (per-combination) sync, which isn't in place. AudienceMetric has no
  // bidding-strategy or search-auction-share fields, so those come back
  // null in this mode — reflected honestly as "—" in the UI, not guessed.
  const audienceDimension = req.nextUrl.searchParams.get('audienceDimension');
  const audienceValue = req.nextUrl.searchParams.get('audienceValue');

  type MetricRow = {
    date: Date;
    campaignId: string;
    impressions: number;
    clicks: number;
    costCents: number;
    conversions: number;
    conversionValueCents: number;
    biddingStrategyType: string | null;
    searchImpressionSharePct: number | null;
    searchBudgetLostSharePct: number | null;
    searchRankLostSharePct: number | null;
    searchTopImpressionSharePct: number | null;
    searchAbsoluteTopImpressionSharePct: number | null;
  };

  let metrics: MetricRow[];
  if (audienceDimension && audienceValue) {
    const rows = campaignIds.length
      ? await db.audienceMetric.findMany({
          where: {
            campaignId: { in: campaignIds },
            date: { gte: since, lte: until },
            dimension: audienceDimension,
            dimensionValue: audienceValue,
          },
          orderBy: { date: 'asc' },
        })
      : [];
    metrics = rows.map((r) => ({
      date: r.date,
      campaignId: r.campaignId,
      impressions: r.impressions,
      clicks: r.clicks,
      costCents: r.costCents,
      conversions: r.conversions,
      conversionValueCents: r.conversionValueCents,
      biddingStrategyType: null,
      searchImpressionSharePct: null,
      searchBudgetLostSharePct: null,
      searchRankLostSharePct: null,
      searchTopImpressionSharePct: null,
      searchAbsoluteTopImpressionSharePct: null,
    }));
  } else {
    metrics = campaignIds.length
      ? await db.dailyMetric.findMany({
          where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } },
          orderBy: { date: 'asc' },
        })
      : [];
  }

  // Overall totals
  const totals = metrics.reduce(
    (acc, m) => {
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.costCents += m.costCents;
      acc.conversions += m.conversions;
      acc.conversionValueCents += m.conversionValueCents;
      return acc;
    },
    { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 }
  );
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const avgCpcCents = totals.clicks > 0 ? totals.costCents / totals.clicks : 0;
  const costPerConversionCents = totals.conversions > 0 ? totals.costCents / totals.conversions : 0;
  // ROAS = revenue (conversion value) / spend — e.g. 3.5 means $3.50 back per $1 spent.
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;

  // Search auction-visibility averages — plain mean across whatever rows
  // actually reported a value (see DailyMetric's schema comment on why some
  // channel types don't report these at all, vs. reporting a real 0%).
  function avgOf(
    field:
      | 'searchImpressionSharePct'
      | 'searchBudgetLostSharePct'
      | 'searchRankLostSharePct'
      | 'searchTopImpressionSharePct'
      | 'searchAbsoluteTopImpressionSharePct'
  ) {
    const values = metrics.map((m) => m[field]).filter((v): v is number => v !== null);
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
  }
  const avgSearchImpressionSharePct = avgOf('searchImpressionSharePct');
  const avgSearchBudgetLostSharePct = avgOf('searchBudgetLostSharePct');
  const avgSearchRankLostSharePct = avgOf('searchRankLostSharePct');
  const avgSearchTopImpressionSharePct = avgOf('searchTopImpressionSharePct');
  const avgSearchAbsoluteTopImpressionSharePct = avgOf('searchAbsoluteTopImpressionSharePct');

  // Sourced from the audience breakdown tables synced alongside device/age/
  // gender/location data — narrower slices the blended totals above don't
  // separate out on their own.
  async function sumAudience(dimension: string, dimensionValue: string, field: 'conversions' | 'clicks') {
    if (campaignIds.length === 0) return 0;
    const rows = await db.audienceMetric.findMany({
      where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until }, dimension, dimensionValue },
    });
    return rows.reduce((sum, r) => sum + r[field], 0);
  }

  // "Purchases" — not the blended conversions total (which includes
  // leads/signups/etc.), just conversions categorized specifically as PURCHASE.
  const purchases = await sumAudience('conversion_category', 'PURCHASE', 'conversions');
  // "Store visits" — Google's estimated in-person visits from location extensions, also a conversion category.
  const storeVisits = await sumAudience('conversion_category', 'STORE_VISIT', 'conversions');
  // "Map clicks" — clicks that opened directions/map view from a location
  // extension. Google's API reports this click type as GET_DIRECTIONS.
  const mapClicks = await sumAudience('click_type', 'GET_DIRECTIONS', 'clicks');
  // Two specific named conversion actions requested directly — finer-grained
  // than the STORE_VISIT category, which covers Google's own aggregate
  // estimate rather than these particular tracked actions.
  const localActionsDirections = await sumAudience('conversion_action', 'Local actions - Directions', 'conversions');
  const businessProfileDirections = await sumAudience('conversion_action', 'Business profile - Directions', 'conversions');

  // Daily series (summed across all campaigns for this account, one point per date)
  const byDate = new Map<string, { date: string; impressions: number; clicks: number; costCents: number; conversions: number }>();
  for (const m of metrics) {
    const key = m.date.toISOString().slice(0, 10);
    const entry = byDate.get(key) ?? { date: key, impressions: 0, clicks: 0, costCents: 0, conversions: 0 };
    entry.impressions += m.impressions;
    entry.clicks += m.clicks;
    entry.costCents += m.costCents;
    entry.conversions += m.conversions;
    byDate.set(key, entry);
  }
  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Per-campaign breakdown
  const byCampaign = new Map<
    string,
    { impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number; biddingStrategyType: string | null }
  >();
  for (const m of metrics) {
    const entry = byCampaign.get(m.campaignId) ?? {
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
      biddingStrategyType: null,
    };
    entry.impressions += m.impressions;
    entry.clicks += m.clicks;
    entry.costCents += m.costCents;
    entry.conversions += m.conversions;
    entry.conversionValueCents += m.conversionValueCents;
    // metrics is ordered by date asc, so the last row seen for this
    // campaign is its most recent — keep overwriting so this ends up being
    // whatever the bid strategy currently is, not some day from weeks ago.
    if (m.biddingStrategyType) entry.biddingStrategyType = m.biddingStrategyType;
    byCampaign.set(m.campaignId, entry);
  }
  // Paused campaigns are excluded from the breakdown list — they're not
  // actively running, so they'd just be clutter in a performance report.
  // (Their historical spend/clicks from while they *were* live still count
  // in the totals/chart above — pausing doesn't erase what already happened.)
  const campaignBreakdown = campaigns
    .filter((c) => c.status !== 'PAUSED')
    .filter((c) => includeHidden || !c.hiddenFromList)
    .map((c) => ({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      hiddenFromList: c.hiddenFromList,
      ...(byCampaign.get(c.id) ?? {
        impressions: 0,
        clicks: 0,
        costCents: 0,
        conversions: 0,
        conversionValueCents: 0,
        biddingStrategyType: null,
      }),
    }));

  // Count of hidden rows omitted (only meaningful to admins — shown so the
  // dashboard can offer a "show hidden" toggle without a second request).
  const hiddenCount = campaigns.filter((c) => c.status !== 'PAUSED' && c.hiddenFromList).length;

  return NextResponse.json({
    totals: {
      ...totals,
      ctr,
      avgCpcCents,
      costPerConversionCents,
      roas,
      purchases,
      storeVisits,
      mapClicks,
      localActionsDirections,
      businessProfileDirections,
      avgSearchImpressionSharePct,
      avgSearchBudgetLostSharePct,
      avgSearchRankLostSharePct,
      avgSearchTopImpressionSharePct,
      avgSearchAbsoluteTopImpressionSharePct,
    },
    daily,
    campaigns: campaignBreakdown,
    hiddenCount,
  });
}
