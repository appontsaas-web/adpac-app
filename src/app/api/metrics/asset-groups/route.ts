import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/crypto';
import { fetchAssetGroupAssetPerformance } from '@/lib/googleAds';

// GET /api/metrics/asset-groups?googleAdsAccountId=xxx&days=30
// GET /api/metrics/asset-groups?googleAdsAccountId=xxx&since=2026-06-01&until=2026-06-30
// Performance Max reporting — PMax campaigns have neither keywords nor
// traditional ads, so the usual Keyword/Ad breakdowns are always empty for
// them. This returns two things instead:
//  - `assetGroups`: synced asset-group-level performance for the requested
//    period, aggregated from AssetGroupMetric the same way /api/metrics/
//    ad-performance aggregates AdGroupMetric.
//  - `assetPerformance`: Google's live per-asset quality rating
//    (BEST/GOOD/LOW/PENDING/LEARNING) for every asset in every PMax asset
//    group — fetched fresh on every request rather than synced, since it's
//    a current-state signal with no meaningful date range (see
//    fetchAssetGroupAssetPerformance in lib/googleAds.ts). This half is
//    skipped (returned empty) if the account has no Google Ads connection
//    details available for a live call, e.g. a transient decrypt/auth
//    failure — the synced assetGroups data still returns either way.
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
    ? await db.assetGroupMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
    : [];

  const byAssetGroup = new Map<
    string,
    { assetGroupName: string; status: string; impressions: number; clicks: number; costCents: number; conversions: number; conversionValueCents: number }
  >();
  for (const r of rows) {
    const entry = byAssetGroup.get(r.assetGroupId) ?? {
      assetGroupName: r.assetGroupName,
      status: r.status,
      impressions: 0,
      clicks: 0,
      costCents: 0,
      conversions: 0,
      conversionValueCents: 0,
    };
    entry.assetGroupName = r.assetGroupName;
    entry.status = r.status;
    entry.impressions += r.impressions;
    entry.clicks += r.clicks;
    entry.costCents += r.costCents;
    entry.conversions += r.conversions;
    entry.conversionValueCents += r.conversionValueCents;
    byAssetGroup.set(r.assetGroupId, entry);
  }
  const assetGroups = Array.from(byAssetGroup.values()).sort((a, b) => b.costCents - a.costCents);

  let assetPerformance: Awaited<ReturnType<typeof fetchAssetGroupAssetPerformance>> = [];
  try {
    const refreshToken = decryptToken(account.refreshTokenEncrypted);
    assetPerformance = await fetchAssetGroupAssetPerformance(account.googleCustomerId, refreshToken);
  } catch (err: any) {
    // Non-fatal — the synced assetGroups data above is still useful on its own.
    console.error('fetchAssetGroupAssetPerformance failed:', err.message);
  }

  return NextResponse.json({ assetGroups, assetPerformance });
}
