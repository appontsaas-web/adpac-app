import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { listCampaigns, fetchCampaignInsights } from '@/lib/snapchat';
import { decryptToken } from '@/lib/crypto';

// POST /api/snapchat/sync[?accountId=xxx&days=30]
// Same two-caller pattern as /api/metrics/sync and /api/meta/sync: an
// unattended scheduler (SYNC_SECRET header) or a signed-in operator with the
// snapchat capability for that client. Unlike Meta, there's no token
// re-exchange step here — the stored refresh_token doesn't expire on its
// own, so lib/snapchat.ts just requests a fresh access token with it
// per-call.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const accountId = req.nextUrl.searchParams.get('accountId');

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (accountId) {
      const account = await db.snapAdAccount.findUnique({ where: { id: accountId } });
      if (!account) return NextResponse.json({ error: 'Snapchat ad account not found' }, { status: 404 });
      if (!(await hasCapability(me, account.clientId, 'snapchat'))) {
        return NextResponse.json({ error: 'Snapchat Ads access required for this client' }, { status: 403 });
      }
    } else if (me.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required to sync all accounts at once' }, { status: 403 });
    }
  }

  const accounts = await db.snapAdAccount.findMany({
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
      errors.push(`${account.snapAdAccountId} token decrypt: ${err.message}`);
      continue;
    }

    try {
      const campaigns = await listCampaigns(account.snapAdAccountId, refreshToken, account.currencyCode);
      const localIdByCampaignId = new Map<string, string>();

      for (const c of campaigns) {
        const row = await db.snapCampaign.upsert({
          where: { adAccountId_snapCampaignId: { adAccountId: account.id, snapCampaignId: c.id } },
          create: {
            adAccountId: account.id,
            snapCampaignId: c.id,
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

      // One stats call per campaign (see fetchCampaignInsights's doc
      // comment for why) — a failure on one campaign shouldn't block the
      // rest, same tolerance as the per-dimension try/catch in
      // /api/meta/sync.
      for (const c of campaigns) {
        const localCampaignId = localIdByCampaignId.get(c.id);
        if (!localCampaignId) continue;
        try {
          const rows = await fetchCampaignInsights(c.id, refreshToken, sinceStr, untilStr, account.currencyCode);
          for (const row of rows) {
            await db.snapDailyMetric.upsert({
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
          errors.push(`${account.snapAdAccountId} campaign ${c.id} stats: ${err.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`${account.snapAdAccountId} campaigns: ${err.message}`);
      await db.snapAdAccount.update({ where: { id: account.id }, data: { status: 'error' } });
    }
  }

  return NextResponse.json({ campaignsSynced, metricsSynced, errors });
}
