import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/meta-metrics?metaAdAccountId=xxx&days=30
// GET /api/meta-metrics?metaAdAccountId=xxx&since=2026-06-01&until=2026-06-30
// The Meta counterpart to /api/metrics — aggregates MetaDailyMetric rows for
// every campaign under a client's connected Meta ad account into: overall
// totals (with derived CTR/CPC/cost-per-conversion/ROAS), a daily time
// series for charting, and a per-campaign breakdown table. Accepts either a
// rolling `days` window (default) or an explicit `since`/`until` range.
//
// Deliberately does NOT include the Google Ads-only fields (search auction-
// visibility shares, the age/gender/device/location audience breakdown) —
// Meta's Insights API can report device/platform/age/gender breakdowns too,
// but that's a distinct, larger follow-up (its own sync + storage), not
// something MetaDailyMetric's current per-campaign-per-day shape covers.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const metaAdAccountId = req.nextUrl.searchParams.get('metaAdAccountId');
  if (!metaAdAccountId) {
    return NextResponse.json({ error: 'metaAdAccountId is required' }, { status: 400 });
  }

  const account = await db.metaAdAccount.findUnique({ where: { id: metaAdAccountId } });
  if (!account) return NextResponse.json({ error: 'Meta ad account not found' }, { status: 404 });
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
  // MetaCampaign.hiddenFromList) are left out of the per-campaign breakdown
  // table below by default, same as the Google Ads reporting dashboard.
  // Display-only: totals/chart still include every campaign's real spend.
  const includeHidden = req.nextUrl.searchParams.get('includeHidden') === '1' && me.role === 'ADMIN';

  // Optional campaign filter — same param name/shape as /api/metrics.
  const campaignIdParam = req.nextUrl.searchParams.get('campaignId');

  const campaigns = await db.metaCampaign.findMany({
    where: { adAccountId: metaAdAccountId, ...(campaignIdParam ? { id: campaignIdParam } : {}) },
    select: { id: true, name: true, status: true, objective: true, dailyBudgetCents: true, hiddenFromList: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  // Optional audience filter — e.g. audienceDimension=age&audienceValue=25-34.
  // Same "one dimension at a time, sourced from the breakdown table instead
  // of the daily table" approach as /api/metrics — see that route's comment
  // for the full rationale. MetaAudienceMetric has no reach/conversionValue
  // fields, so avgDailyReach/cpmCents/ROAS come back as 0/"—" in this mode.
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
    reach: number;
  };

  let metrics: MetricRow[];
  if (audienceDimension && audienceValue) {
    const rows = campaignIds.length
      ? await db.metaAudienceMetric.findMany({
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
      conversionValueCents: 0, // MetaAudienceMetric doesn't track this — ROAS is unavailable when an audience filter is active
      reach: 0, // MetaAudienceMetric doesn't track reach — see avgDailyReach comment below
    }));
  } else {
    metrics = campaignIds.length
      ? await db.metaDailyMetric.findMany({
          where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } },
          orderBy: { date: 'asc' },
        })
      : [];
  }

  const totals = metrics.reduce(
    (acc, m) => {
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.costCents += m.costCents;
      acc.conversions += m.conversions;
      acc.conversionValueCents += m.conversionValueCents;
      acc.reachSum += m.reach;
      return acc;
    },
    { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0, reachSum: 0 }
  );
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const avgCpcCents = totals.clicks > 0 ? totals.costCents / totals.clicks : 0;
  const costPerConversionCents = totals.conversions > 0 ? totals.costCents / totals.conversions : 0;
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;
  const cpmCents = totals.impressions > 0 ? (totals.costCents / totals.impressions) * 1000 : 0;
  // avgDailyReach: reachSum / number of days with data — NOT the period's
  // unique reach (see MetaDailyMetric.reach schema comment: the same person
  // reached on two different days counts in both days' reach, so summing
  // across days overcounts). Averaging per active day is the closest honest
  // single number to show without a dedicated non-additive account-level
  // reach call — labeled as "Avg. daily reach" in the UI, never "Reach."
  const daysWithData = new Set(metrics.map((m) => m.date.toISOString().slice(0, 10))).size;
  const avgDailyReach = daysWithData > 0 ? totals.reachSum / daysWithData : 0;

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

  const byCampaign = new Map<
    string,
    { impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number }
  >();
  for (const m of metrics) {
    const entry = byCampaign.get(m.campaignId) ?? {
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
    };
    entry.impressions += m.impressions;
    entry.clicks += m.clicks;
    entry.costCents += m.costCents;
    entry.conversions += m.conversions;
    entry.conversionValueCents += m.conversionValueCents;
    byCampaign.set(m.campaignId, entry);
  }
  // Paused/deleted/archived campaigns excluded from the breakdown table —
  // not actively running, so they'd just be clutter (their historical spend
  // from while they *were* active still counts in totals/chart above).
  const campaignBreakdown = campaigns
    .filter((c) => c.status === 'ACTIVE')
    .filter((c) => includeHidden || !c.hiddenFromList)
    .map((c) => ({
      campaignId: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      dailyBudgetCents: c.dailyBudgetCents,
      hiddenFromList: c.hiddenFromList,
      ...(byCampaign.get(c.id) ?? {
        impressions: 0,
        clicks: 0,
        costCents: 0,
        conversions: 0,
        conversionValueCents: 0,
      }),
    }));

  const hiddenCount = campaigns.filter((c) => c.status === 'ACTIVE' && c.hiddenFromList).length;

  return NextResponse.json({
    totals: { ...totals, ctr, avgCpcCents, costPerConversionCents, roas, cpmCents, avgDailyReach },
    daily,
    campaigns: campaignBreakdown,
    hiddenCount,
  });
}
