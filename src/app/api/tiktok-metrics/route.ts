import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/tiktok-metrics?tiktokAdAccountId=xxx&days=30
// GET /api/tiktok-metrics?tiktokAdAccountId=xxx&since=2026-06-01&until=2026-06-30
// The TikTok counterpart to /api/snap-metrics — aggregates TikTokDailyMetric
// rows (populated by /api/tiktok/sync) for every campaign under a client's
// connected TikTok ad account into: overall totals (CTR/CPC/cost-per-
// conversion/ROAS), a daily time series for charting, and a per-campaign
// breakdown table. Same days/since/until/campaignId param shape as every
// other reporting route in this app.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const tiktokAdAccountId = req.nextUrl.searchParams.get('tiktokAdAccountId');
  if (!tiktokAdAccountId) {
    return NextResponse.json({ error: 'tiktokAdAccountId is required' }, { status: 400 });
  }

  const account = await db.tikTokAdAccount.findUnique({ where: { id: tiktokAdAccountId } });
  if (!account) return NextResponse.json({ error: 'TikTok ad account not found' }, { status: 404 });
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

  const includeHidden = req.nextUrl.searchParams.get('includeHidden') === '1' && me.role === 'ADMIN';
  const campaignIdParam = req.nextUrl.searchParams.get('campaignId');

  const campaigns = await db.tikTokCampaign.findMany({
    where: { adAccountId: tiktokAdAccountId, ...(campaignIdParam ? { id: campaignIdParam } : {}) },
    select: { id: true, name: true, status: true, objective: true, dailyBudgetCents: true, hiddenFromList: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const metrics = campaignIds.length
    ? await db.tikTokDailyMetric.findMany({
        where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } },
        orderBy: { date: 'asc' },
      })
    : [];

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
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;

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
    const entry = byCampaign.get(m.campaignId) ?? { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 };
    entry.impressions += m.impressions;
    entry.clicks += m.clicks;
    entry.costCents += m.costCents;
    entry.conversions += m.conversions;
    entry.conversionValueCents += m.conversionValueCents;
    byCampaign.set(m.campaignId, entry);
  }
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
      ...(byCampaign.get(c.id) ?? { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 }),
    }));

  const hiddenCount = campaigns.filter((c) => c.status === 'ACTIVE' && c.hiddenFromList).length;

  return NextResponse.json({
    totals: { ...totals, ctr, avgCpcCents, costPerConversionCents, roas },
    daily,
    campaigns: campaignBreakdown,
    hiddenCount,
  });
}
