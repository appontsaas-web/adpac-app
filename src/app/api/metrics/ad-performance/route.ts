import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics/ad-performance?googleAdsAccountId=xxx&days=30
// GET /api/metrics/ad-performance?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// Aggregates AdGroupMetric + AdMetric rows (populated by /api/metrics/sync)
// across the period — ad-group totals and individual ad/creative rows, both
// sorted by spend descending, top 100 each. One route for both since they're
// always viewed together (which ad group, which creative within it).
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
    until.setHours(23, 59, 59, 999);
  } else {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
    since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    until = new Date();
    until.setHours(23, 59, 59, 999);
  }

  const campaigns = await db.campaign.findMany({ where: { googleAdsAccountId }, select: { id: true } });
  const campaignIds = campaigns.map((c) => c.id);

  const [adGroupRows, adRows] = campaignIds.length
    ? await Promise.all([
        db.adGroupMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } }),
        db.adMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } }),
      ])
    : [[], []];

  const byAdGroup = new Map<
    string,
    { adGroupName: string; impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number }
  >();
  for (const r of adGroupRows) {
    const entry = byAdGroup.get(r.adGroupId) ?? {
      adGroupName: r.adGroupName,
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
    };
    entry.impressions += r.impressions;
    entry.clicks += r.clicks;
    entry.costCents += r.costCents;
    entry.conversions += r.conversions;
    entry.conversionValueCents += r.conversionValueCents;
    byAdGroup.set(r.adGroupId, entry);
  }
  const adGroups = Array.from(byAdGroup.values())
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 100);

  const byAd = new Map<
    string,
    { headline: string; status: string; impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number }
  >();
  for (const r of adRows) {
    const entry = byAd.get(r.adId) ?? {
      headline: r.headline,
      status: r.status,
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
    };
    entry.headline = r.headline; // keep the latest headline text, in case it was edited
    entry.status = r.status; // keep the latest status
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

  return NextResponse.json({ adGroups, ads });
}
