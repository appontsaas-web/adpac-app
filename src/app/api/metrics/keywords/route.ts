import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics/keywords?googleAdsAccountId=xxx&days=30
// GET /api/metrics/keywords?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// Aggregates KeywordMetric rows (populated by /api/metrics/sync) across the
// period, one row per keyword (ad group + text + match type), sorted by
// spend descending, top 100. Same days/since/until options as /api/metrics.
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

  const rows = campaignIds.length
    ? await db.keywordMetric.findMany({
        where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } },
      })
    : [];

  const byKeyword = new Map<
    string,
    {
      adGroupName: string;
      keywordText: string;
      matchType: string;
      impressions: number;
      clicks: number;
      costCents: number;
      conversions: number;
      conversionValueCents: number;
      avgCpcCentsSum: number;
      avgCpcCentsCount: number;
      qualityScoreSum: number;
      qualityScoreCount: number;
    }
  >();
  for (const r of rows) {
    const key = `${r.adGroupId}::${r.keywordText}::${r.matchType}`;
    const entry = byKeyword.get(key) ?? {
      adGroupName: r.adGroupName,
      keywordText: r.keywordText,
      matchType: r.matchType,
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
      avgCpcCentsSum: 0,
      avgCpcCentsCount: 0,
      qualityScoreSum: 0,
      qualityScoreCount: 0,
    };
    entry.impressions += r.impressions;
    entry.clicks += r.clicks;
    entry.costCents += r.costCents;
    entry.conversions += r.conversions;
    entry.conversionValueCents += r.conversionValueCents;
    if (r.avgCpcCents > 0) {
      entry.avgCpcCentsSum += r.avgCpcCents;
      entry.avgCpcCentsCount += 1;
    }
    if (r.qualityScore != null) {
      entry.qualityScoreSum += r.qualityScore;
      entry.qualityScoreCount += 1;
    }
    byKeyword.set(key, entry);
  }

  const keywords = Array.from(byKeyword.values())
    .map((k) => ({
      adGroupName: k.adGroupName,
      keywordText: k.keywordText,
      matchType: k.matchType,
      impressions: k.impressions,
      clicks: k.clicks,
      costCents: k.costCents,
      conversions: k.conversions,
      conversionValueCents: k.conversionValueCents,
      avgCpcCents: k.avgCpcCentsCount > 0 ? Math.round(k.avgCpcCentsSum / k.avgCpcCentsCount) : 0,
      qualityScore: k.qualityScoreCount > 0 ? Math.round(k.qualityScoreSum / k.qualityScoreCount) : null,
    }))
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 100);

  return NextResponse.json({ keywords });
}
