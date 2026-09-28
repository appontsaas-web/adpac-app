import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import {
  exchangeForLongLivedToken,
  listCampaigns,
  fetchCampaignInsights,
  fetchCampaignAudienceBreakdown,
  MetaAudienceDimension,
  listAdSets,
  fetchAdSetInsights,
  listAds,
  fetchAdInsights,
} from '@/lib/meta';
import { encryptToken, decryptToken } from '@/lib/crypto';

// POST /api/meta/sync[?accountId=xxx&days=30]
// Same two-caller pattern as /api/metrics/sync and /api/google-business/sync:
// an unattended scheduler (SYNC_SECRET header) or a signed-in operator with
// the meta capability for that client.
//
// The FIRST thing this does for every account is re-exchange its stored
// access token for a fresh ~60-day long-lived token (see the token-lifecycle
// comment on MetaAdAccount in schema.prisma) — this is what keeps a Meta
// connection alive indefinitely as long as syncs keep happening at least
// every ~60 days, unlike Google's true refresh_token which never expires on
// its own.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const accountId = req.nextUrl.searchParams.get('accountId');

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (accountId) {
      const account = await db.metaAdAccount.findUnique({ where: { id: accountId } });
      if (!account) return NextResponse.json({ error: 'Meta ad account not found' }, { status: 404 });
      if (!(await hasCapability(me, account.clientId, 'meta'))) {
        return NextResponse.json({ error: 'Meta Ads access required for this client' }, { status: 403 });
      }
    } else if (me.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required to sync all accounts at once' }, { status: 403 });
    }
  }

  const accounts = await db.metaAdAccount.findMany({
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
  let audienceSynced = 0;
  let adSetsSynced = 0;
  let adsSynced = 0;
  const errors: string[] = [];
  const AUDIENCE_DIMENSIONS: MetaAudienceDimension[] = ['age', 'gender', 'country', 'region', 'platform', 'hour'];

  for (const account of accounts) {
    let accessToken: string;
    try {
      const storedToken = decryptToken(account.accessTokenEncrypted);
      const refreshed = await exchangeForLongLivedToken(storedToken);
      accessToken = refreshed.accessToken;
      await db.metaAdAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptToken(refreshed.accessToken),
          tokenExpiresAt: refreshed.expiresAt,
          status: 'connected',
        },
      });
    } catch (err: any) {
      // Token re-exchange failing usually means the stored token has
      // already expired (connection untouched for >60 days) — mark the
      // account so the UI can prompt a reconnect rather than failing
      // silently on every subsequent sync.
      errors.push(`${account.metaAdAccountId} token refresh: ${err.message}`);
      await db.metaAdAccount.update({ where: { id: account.id }, data: { status: 'error' } });
      continue;
    }

    try {
      const campaigns = await listCampaigns(account.metaAdAccountId, accessToken);
      const campaignByMetaId = new Map<string, string>(); // metaCampaignId -> local id

      for (const c of campaigns) {
        const row = await db.metaCampaign.upsert({
          where: { adAccountId_metaCampaignId: { adAccountId: account.id, metaCampaignId: c.id } },
          create: {
            adAccountId: account.id,
            metaCampaignId: c.id,
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
        campaignByMetaId.set(c.id, row.id);
        campaignsSynced++;
      }

      try {
        const insights = await fetchCampaignInsights(
          account.metaAdAccountId,
          accessToken,
          sinceStr,
          untilStr,
          account.currencyCode
        );
        for (const row of insights) {
          const localCampaignId = campaignByMetaId.get(row.campaignId);
          if (!localCampaignId) continue; // insight for a campaign not in the current campaign list (e.g. deleted) — skip
          await db.metaDailyMetric.upsert({
            where: { campaignId_date: { campaignId: localCampaignId, date: new Date(row.date) } },
            create: {
              campaignId: localCampaignId,
              date: new Date(row.date),
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
              reach: row.reach,
            },
            update: {
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
              reach: row.reach,
            },
          });
          metricsSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.metaAdAccountId} insights: ${err.message}`);
      }

      // Audience/placement/time breakdowns — one call per dimension (see
      // fetchCampaignAudienceBreakdown's doc comment for why). A failure on
      // one dimension shouldn't block the others, same tolerance as the
      // per-location try/catch pattern in /api/google-business/sync.
      for (const dimension of AUDIENCE_DIMENSIONS) {
        try {
          const rows = await fetchCampaignAudienceBreakdown(
            account.metaAdAccountId,
            accessToken,
            dimension,
            sinceStr,
            untilStr,
            account.currencyCode
          );
          for (const row of rows) {
            const localCampaignId = campaignByMetaId.get(row.campaignId);
            if (!localCampaignId) continue;
            await db.metaAudienceMetric.upsert({
              where: {
                campaignId_date_dimension_dimensionValue: {
                  campaignId: localCampaignId,
                  date: new Date(row.date),
                  dimension,
                  dimensionValue: row.dimensionValue,
                },
              },
              create: {
                campaignId: localCampaignId,
                date: new Date(row.date),
                dimension,
                dimensionValue: row.dimensionValue,
                impressions: row.impressions,
                clicks: row.clicks,
                costCents: row.costCents,
                conversions: row.conversions,
              },
              update: {
                impressions: row.impressions,
                clicks: row.clicks,
                costCents: row.costCents,
                conversions: row.conversions,
              },
            });
            audienceSynced++;
          }
        } catch (err: any) {
          errors.push(`${account.metaAdAccountId} audience (${dimension}): ${err.message}`);
        }
      }

      // Ad-set and ad (creative) level — current-state list calls (name/
      // status/budget/targeting) plus one Insights call per level for the
      // daily time series, same split as the campaign sync above.
      try {
        const [adSets, adSetInsights] = await Promise.all([
          listAdSets(account.metaAdAccountId, accessToken),
          fetchAdSetInsights(account.metaAdAccountId, accessToken, sinceStr, untilStr, account.currencyCode),
        ]);
        const adSetById = new Map(adSets.map((a) => [a.id, a]));
        for (const row of adSetInsights) {
          const localCampaignId = campaignByMetaId.get(row.campaignId);
          if (!localCampaignId) continue;
          const meta = adSetById.get(row.adSetId);
          await db.metaAdSetMetric.upsert({
            where: { campaignId_date_adSetId: { campaignId: localCampaignId, date: new Date(row.date), adSetId: row.adSetId } },
            create: {
              campaignId: localCampaignId,
              date: new Date(row.date),
              adSetId: row.adSetId,
              adSetName: meta?.name ?? '(unknown ad set)',
              status: meta?.status ?? 'UNKNOWN',
              dailyBudgetCents: meta?.dailyBudgetCents ?? null,
              targetingSummary: meta?.targetingSummary ?? null,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              adSetName: meta?.name ?? '(unknown ad set)',
              status: meta?.status ?? 'UNKNOWN',
              dailyBudgetCents: meta?.dailyBudgetCents ?? null,
              targetingSummary: meta?.targetingSummary ?? null,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          adSetsSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.metaAdAccountId} ad sets: ${err.message}`);
      }

      try {
        const [ads, adInsights] = await Promise.all([
          listAds(account.metaAdAccountId, accessToken),
          fetchAdInsights(account.metaAdAccountId, accessToken, sinceStr, untilStr, account.currencyCode),
        ]);
        const adById = new Map(ads.map((a) => [a.id, a]));
        for (const row of adInsights) {
          const localCampaignId = campaignByMetaId.get(row.campaignId);
          if (!localCampaignId) continue;
          const meta = adById.get(row.adId);
          await db.metaAdMetric.upsert({
            where: { campaignId_date_adId: { campaignId: localCampaignId, date: new Date(row.date), adId: row.adId } },
            create: {
              campaignId: localCampaignId,
              date: new Date(row.date),
              adSetId: row.adSetId,
              adId: row.adId,
              name: meta?.name ?? '(unknown ad)',
              status: meta?.status ?? 'UNKNOWN',
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              name: meta?.name ?? '(unknown ad)',
              status: meta?.status ?? 'UNKNOWN',
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          adsSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.metaAdAccountId} ads: ${err.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.metaAdAccountId} campaigns: ${err.message}`);
    }
  }

  return NextResponse.json({ campaignsSynced, metricsSynced, audienceSynced, adSetsSynced, adsSynced, errors });
}
