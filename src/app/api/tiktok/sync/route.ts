import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { listCampaigns, fetchAccountInsights, getTikTokAccessToken } from '@/lib/tiktok';
import { decryptToken } from '@/lib/crypto';

// POST /api/tiktok/sync[?accountId=xxx&days=30]
// Same two-caller pattern as /api/snapchat/sync and /api/meta/sync: an
// unattended scheduler (SYNC_SECRET header) or a signed-in operator with the
// tiktok capability for that client. Same as Snapchat, there's no token
// re-exchange step here — the stored refresh_token doesn't expire on its
// own, so lib/tiktok.ts just requests a fresh access token with it
// per-call.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const accountId = req.nextUrl.searchParams.get('accountId');

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (accountId) {
      const account = await db.tikTokAdAccount.findUnique({ where: { id: accountId } });
      if (!account) return NextResponse.json({ error: 'TikTok ad account not found' }, { status: 404 });
      if (!(await hasCapability(me, account.clientId, 'tiktok'))) {
        return NextResponse.json({ error: 'TikTok Ads access required for this client' }, { status: 403 });
      }
    } else if (me.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required to sync all accounts at once' }, { status: 403 });
    }
  }

  const accounts = await db.tikTokAdAccount.findMany({
    where: { status: 'connected', ...(accountId ? { id: accountId } : {}) },
  });

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);

  let campaignsSynced = 0;
  let metricsSynced = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    let refreshToken: string;
    try {
      refreshToken = decryptToken(account.refreshTokenEncrypted);
    } catch (err: any) {
      errors.push(`${account.advertiserId} token decrypt: ${err.message}`);
      continue;
    }

    try {
      const accessToken = await getTikTokAccessToken(refreshToken);
      const campaigns = await listCampaigns(account.advertiserId, accessToken, account.currencyCode);
      const localIdByCampaignId = new Map<string, string>();

      for (const c of campaigns) {
        const row = await db.tikTokCampaign.upsert({
          where: { adAccountId_tiktokCampaignId: { adAccountId: account.id, tiktokCampaignId: c.id } },
          create: {
            adAccountId: account.id,
            tiktokCampaignId: c.id,
            name: c.name,
            objective: c.objective,
            status: c.status,
            dailyBudgetCents: c.dailyBudgetCents,
            lifetimeBudgetCents: c.lifetimeBudgetCents,
          },
          update: {
            name: c.name,
            objective: c.objective,
            status: c.status,
            dailyBudgetCents: c.dailyBudgetCents,
            lifetimeBudgetCents: c.lifetimeBudgetCents,
          },
        });
        localIdByCampaignId.set(c.id, row.id);
        campaignsSynced++;
      }

      // One reporting call for the whole account (TikTok's report endpoint
      // breaks down by campaign_id itself, unlike Snapchat's per-campaign
      // Stats API — see fetchAccountInsights's doc comment in lib/tiktok.ts).
      try {
        const rows = await fetchAccountInsights(account.advertiserId, accessToken, sinceStr, untilStr, account.currencyCode);
        for (const row of rows) {
          const localCampaignId = localIdByCampaignId.get(row.campaignId);
          if (!localCampaignId) continue;
          await db.tikTokDailyMetric.upsert({
            where: { campaignId_date: { campaignId: localCampaignId, date: new Date(row.date) } },
            create: {
              campaignId: localCampaignId,
              date: new Date(row.date),
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          metricsSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.advertiserId} report: ${err.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.advertiserId} campaigns: ${err.message}`);
      await db.tikTokAdAccount.update({ where: { id: account.id }, data: { status: 'error' } });
    }
  }

  return NextResponse.json({ campaignsSynced, metricsSynced, errors });
}
