import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics/audience?googleAdsAccountId=xxx&days=30
// GET /api/metrics/audience?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// Aggregates AudienceMetric rows (populated by /api/metrics/sync) into three
// breakdowns — device, age/gender, and location — each summed across all
// campaigns under the account for the period. Same days/since/until options
// as /api/metrics so the two stay in sync when the operator changes the
// dashboard's date range.
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

  // Optional campaign filter — same param used across the other reporting
  // routes, so picking a campaign in the dashboard narrows these breakdown
  // tables too, not just the KPI totals.
  const campaignIdParam = req.nextUrl.searchParams.get('campaignId');

  const campaigns = await db.campaign.findMany({
    where: { googleAdsAccountId, ...(campaignIdParam ? { id: campaignIdParam } : {}) },
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const rows = campaignIds.length
    ? await db.audienceMetric.findMany({
        where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } },
      })
    : [];

  function summarize(dimension: string) {
    const byValue = new Map<string, { impressions: number; clicks: number; costCents: number; conversions: number }>();
    for (const r of rows) {
      if (r.dimension !== dimension) continue;
      const entry = byValue.get(r.dimensionValue) ?? { impressions: 0, clicks: 0, costCents: 0, conversions: 0 };
      entry.impressions += r.impressions;
      entry.clicks += r.clicks;
      entry.costCents += r.costCents;
      entry.conversions += r.conversions;
      byValue.set(r.dimensionValue, entry);
    }
    return Array.from(byValue.entries())
      .map(([value, m]) => ({ value, ...m }))
      .sort((a, b) => b.costCents - a.costCents);
  }

  // Hour comes back as "0"-"23" strings — sort numerically instead of the
  // default cost-descending order so a schedule/heatmap view can read left
  // to right in chronological order.
  const hour = summarize('hour').sort((a, b) => Number(a.value) - Number(b.value));

  return NextResponse.json({
    device: summarize('device'),
    ageRange: summarize('age_range'),
    gender: summarize('gender'),
    location: summarize('location'),
    region: summarize('region'),
    dayOfWeek: summarize('day_of_week'),
    hour,
  });
}
