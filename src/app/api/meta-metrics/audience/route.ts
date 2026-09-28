import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/meta-metrics/audience?metaAdAccountId=xxx&days=30
// GET /api/meta-metrics/audience?metaAdAccountId=xxx&since=2026-06-01&until=2026-06-30
// The Meta counterpart to /api/metrics/audience — aggregates
// MetaAudienceMetric rows (populated by /api/meta/sync) into breakdowns —
// age, gender, country, region, platform placement, and hour of day — each
// summed across all campaigns under the account for the period.
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

  // Optional campaign filter — same param used across the other reporting
  // routes.
  const campaignIdParam = req.nextUrl.searchParams.get('campaignId');

  const campaigns = await db.metaCampaign.findMany({
    where: { adAccountId: metaAdAccountId, ...(campaignIdParam ? { id: campaignIdParam } : {}) },
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const rows = campaignIds.length
    ? await db.metaAudienceMetric.findMany({
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

  // Hour comes back as "0"-"23" — sort numerically so it reads left-to-right
  // chronologically, same as the Google Ads audience route.
  const hour = summarize('hour').sort((a, b) => Number(a.value) - Number(b.value));

  return NextResponse.json({
    age: summarize('age'),
    gender: summarize('gender'),
    country: summarize('country'),
    region: summarize('region'),
    platform: summarize('platform'),
    hour,
  });
}
