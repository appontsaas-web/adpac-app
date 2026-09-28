import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics/search-terms?googleAdsAccountId=xxx&days=30
// GET /api/metrics/search-terms?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// Aggregates SearchTermMetric rows (populated by /api/metrics/sync) across
// the period, one row per actual search query, sorted by spend descending,
// top 100 — the raw material for a negative-keyword pass.
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
    ? await db.searchTermMetric.findMany({
        where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } },
      })
    : [];

  const byTerm = new Map<
    string,
    {
      searchTerm: string;
      matchedKeywordText: string | null;
      matchType: string | null;
      impressions: number;
      clicks: number;
      costCents: number;
      conversions: number;
      conversionValueCents: number;
    }
  >();
  for (const r of rows) {
    const key = `${r.searchTerm}::${r.matchedKeywordText ?? ''}`;
    const entry = byTerm.get(key) ?? {
      searchTerm: r.searchTerm,
      matchedKeywordText: r.matchedKeywordText,
      matchType: r.matchType,
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
    byTerm.set(key, entry);
  }

  const searchTerms = Array.from(byTerm.values())
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 100);

  return NextResponse.json({ searchTerms });
}
