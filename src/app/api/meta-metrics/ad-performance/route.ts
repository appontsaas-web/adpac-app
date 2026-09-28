import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/meta-metrics/ad-performance?metaAdAccountId=xxx&days=30
// GET /api/meta-metrics/ad-performance?metaAdAccountId=xxx&since=2026-06-01&until=2026-06-30
// The Meta counterpart to /api/metrics/ad-performance — aggregates
// MetaAdSetMetric + MetaAdMetric rows (populated by /api/meta/sync) across
// the period: ad-set totals (with targeting/budget context) and individual
// ad/creative rows, both sorted by spend descending, top 100 each.
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
    until.setHours(23, 59, 59, 999);
  } else {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
    since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    until = new Date();
    until.setHours(23, 59, 59, 999);
  }

  // Optional campaign filter — narrows both ad sets and ads to just that
  // campaign's, same param name/shape used elsewhere in the filter work.
  const campaignId = req.nextUrl.searchParams.get('campaignId');

  const campaigns = await db.metaCampaign.findMany({
    where: { adAccountId: metaAdAccountId, ...(campaignId ? { id: campaignId } : {}) },
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const [adSetRows, adRows] = campaignIds.length
    ? await Promise.all([
        db.metaAdSetMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } }),
        db.metaAdMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } }),
      ])
    : [[], []];

  const byAdSet = new Map<
    string,
    {
      adSetName: string;
      status: string;
      dailyBudgetCents: number | null;
      targetingSummary: string | null;
      impressions: number;
      clicks: number;
      costCents: number;
      conversions: number;
      conversionValueCents: number;
    }
  >();
  for (const r of adSetRows) {
    const entry = byAdSet.get(r.adSetId) ?? {
      adSetName: r.adSetName,
      status: r.status,
      dailyBudgetCents: r.dailyBudgetCents,
      targetingSummary: r.targetingSummary,
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
    };
    entry.adSetName = r.adSetName;
    entry.status = r.status;
    entry.dailyBudgetCents = r.dailyBudgetCents;
    entry.targetingSummary = r.targetingSummary;
    entry.impressions += r.impressions;
    entry.clicks += r.clicks;
    entry.costCents += r.costCents;
    entry.conversions += r.conversions;
    entry.conversionValueCents += r.conversionValueCents;
    byAdSet.set(r.adSetId, entry);
  }
  const adSets = Array.from(byAdSet.values())
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 100);

  const byAd = new Map<
    string,
    { name: string; status: string; impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number }
  >();
  for (const r of adRows) {
    const entry = byAd.get(r.adId) ?? {
      name: r.name,
      status: r.status,
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
    };
    entry.name = r.name;
    entry.status = r.status;
    entry.impressions += r.impressions;
    entry.clicks += r.clicks;
    entry.costCents += r.costCents;
    entry.conversions += r.conversions;
    entry.conversionValueCents += r.conversionValueCents;
    byAd.set(r.adId, entry);
  }
  const ads = Array.from(byAd.values())
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 100);

  return NextResponse.json({ adSets, ads });
}
