import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/summary-metrics?clientId=xxx&days=30 (or &since=&until=)
//
// Combines Google Ads + Meta + Snapchat into one cross-platform view for the
// new "Summary" tab — a single set of totals, a per-platform delivery
// breakdown, and the most recent AI insights across every connected engine.
// All three platforms already store spend/conversion-value in USD cents
// (see each platform's own FX_RATE_TO_USD table), so combined totals are a
// straight sum — no conversion needed here.
//
// Gated behind canViewReporting alone, same as every individual platform's
// own metrics route (/api/metrics, /api/meta-metrics, /api/snap-metrics) —
// reporting is a single capability that covers every connected platform,
// not one per platform (see canViewReporting's doc comment in lib/access.ts).
// A platform is included in the response only when the client actually has
// a connected account for it; there's no separate per-platform gate beyond
// that, matching how the individual dashboards work.
function gatedNextResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return gatedNextResponse('Not authenticated', 401);

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return gatedNextResponse('clientId is required', 400);
  if (!(await canViewReporting(me, clientId))) {
    return gatedNextResponse('Reporting access required for this client', 403);
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
  const sinceParam = req.nextUrl.searchParams.get('since');
  const untilParam = req.nextUrl.searchParams.get('until');
  const until = untilParam ? new Date(untilParam) : new Date();
  const since = sinceParam ? new Date(sinceParam) : new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  until.setHours(23, 59, 59, 999);

  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      googleAdsAccounts: { take: 1 },
      metaAdAccounts: { take: 1 },
      snapAdAccounts: { take: 1 },
    },
  });
  if (!client) return gatedNextResponse('Client not found', 404);

  type PlatformTotals = {
    platform: 'google' | 'meta' | 'snapchat';
    label: string;
    connected: boolean;
    impressions: number;
    clicks: number;
    costCents: number;
    conversions: number;
    conversionValueCents: number;
    campaignCount: number;
  };
  const platforms: PlatformTotals[] = [];

  const googleAccount = client.googleAdsAccounts[0] ?? null;
  if (googleAccount) {
    const campaigns = await db.campaign.findMany({ where: { googleAdsAccountId: googleAccount.id }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    const metrics = campaignIds.length
      ? await db.dailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
      : [];
    const t = metrics.reduce(
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
    platforms.push({ platform: 'google', label: 'Google Ads', connected: true, ...t, campaignCount: campaignIds.length });
  } else {
    platforms.push({ platform: 'google', label: 'Google Ads', connected: false, impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0, campaignCount: 0 });
  }

  const metaAccount = client.metaAdAccounts[0] ?? null;
  if (metaAccount) {
    const campaigns = await db.metaCampaign.findMany({ where: { adAccountId: metaAccount.id }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    const metrics = campaignIds.length
      ? await db.metaDailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
      : [];
    const t = metrics.reduce(
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
    platforms.push({ platform: 'meta', label: 'Meta Ads (Facebook & Instagram)', connected: true, ...t, campaignCount: campaignIds.length });
  } else {
    platforms.push({ platform: 'meta', label: 'Meta Ads (Facebook & Instagram)', connected: false, impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0, campaignCount: 0 });
  }

  const snapAccount = client.snapAdAccounts[0] ?? null;
  if (snapAccount) {
    const campaigns = await db.snapCampaign.findMany({ where: { adAccountId: snapAccount.id }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    const metrics = campaignIds.length
      ? await db.snapDailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since, lte: until } } })
      : [];
    const t = metrics.reduce(
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
    platforms.push({ platform: 'snapchat', label: 'Snapchat Ads', connected: true, ...t, campaignCount: campaignIds.length });
  } else {
    platforms.push({ platform: 'snapchat', label: 'Snapchat Ads', connected: false, impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0, campaignCount: 0 });
  }

  const totals = platforms.reduce(
    (acc, p) => {
      acc.impressions += p.impressions;
      acc.clicks += p.clicks;
      acc.costCents += p.costCents;
      acc.conversions += p.conversions;
      acc.conversionValueCents += p.conversionValueCents;
      return acc;
    },
    { impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 }
  );
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const avgCpcCents = totals.clicks > 0 ? totals.costCents / totals.clicks : 0;
  const costPerConversionCents = totals.conversions > 0 ? totals.costCents / totals.conversions : 0;
  const roas = totals.costCents > 0 ? totals.conversionValueCents / totals.costCents : 0;

  // Most recent AI insights across every engine that writes to ActionLog —
  // derives which platform a row belongs to from which FK is set (see
  // ActionLog's own schema comment: exactly one of campaignId/locationId+
  // businessReviewId/metaCampaignId/snapCampaignId is set per row).
  const recentLogs = await db.actionLog.findMany({
    where: { clientId, proposedBy: 'ai' },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      actionType: true,
      status: true,
      payloadJson: true,
      createdAt: true,
      campaignId: true,
      metaCampaignId: true,
      snapCampaignId: true,
      locationId: true,
      businessReviewId: true,
    },
  });
  const insights = recentLogs.map((log) => {
    let platform: string = 'google';
    if (log.metaCampaignId) platform = 'meta';
    else if (log.snapCampaignId) platform = 'snapchat';
    else if (log.locationId || log.businessReviewId) platform = 'businessProfile';
    let summary = log.actionType;
    try {
      const payload = JSON.parse(log.payloadJson);
      if (payload.summary) summary = payload.summary;
    } catch {
      // payloadJson not parseable — fall back to the raw actionType label
    }
    return { id: log.id, platform, actionType: log.actionType, status: log.status, summary, createdAt: log.createdAt };
  });

  return NextResponse.json({
    clientName: client.name,
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    totals: { ...totals, ctr, avgCpcCents, costPerConversionCents, roas },
    platforms,
    insights,
  });
}
