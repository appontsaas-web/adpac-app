import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics/conversions?googleAdsAccountId=xxx&days=30
// GET /api/metrics/conversions?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// A full conversions/goals breakdown, sourced from the same AudienceMetric
// rows /api/metrics uses for its two hardcoded "Local actions - Directions"/
// "Business profile - Directions" KPIs (dimension "conversion_action") and
// its "Purchases"/"Store visits" KPIs (dimension "conversion_category") —
// this route just returns EVERY value of both dimensions instead of picking
// out a couple by name, for a client where those aren't the goals that
// matter, or who wants the complete picture.
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
    ? await db.audienceMetric.findMany({
        where: {
          campaignId: { in: campaignIds },
          date: { gte: since, lte: until },
          dimension: { in: ['conversion_action', 'conversion_category'] },
        },
      })
    : [];

  function summarize(dimension: string) {
    const byValue = new Map<string, { conversions: number; conversionValueCents: number }>();
    for (const r of rows) {
      if (r.dimension !== dimension) continue;
      const entry = byValue.get(r.dimensionValue) ?? { conversions: 0, conversionValueCents: 0 };
      entry.conversions += r.conversions;
      entry.conversionValueCents += r.conversionValueCents;
      byValue.set(r.dimensionValue, entry);
    }
    return Array.from(byValue.entries())
      .map(([value, m]) => ({ value, ...m }))
      .filter((r) => r.conversions > 0 || r.conversionValueCents > 0)
      .sort((a, b) => b.conversions - a.conversions);
  }

  return NextResponse.json({
    actions: summarize('conversion_action'),
    categories: summarize('conversion_category'),
  });
}
