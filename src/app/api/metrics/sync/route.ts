import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import {
  fetchCampaignMetrics,
  fetchAudienceMetrics,
  fetchExistingCampaigns,
  fetchAccountCurrency,
  fetchKeywordMetrics,
  fetchSearchTermMetrics,
  fetchAdGroupMetrics,
  fetchAdMetrics,
  fetchAssetGroupMetrics,
} from '@/lib/googleAds';
import { decryptToken } from '@/lib/crypto';
import { ensureDailySpend } from '@/lib/tokens';

// POST /api/metrics/sync[?googleAdsAccountId=xxx&days=30]
// Pulls the last `days` (default 30, capped at 365 as a sane upper bound —
// larger ranges risk hitting Google Ads API rate/quota limits in one call)
// of performance for every LIVE campaign and upserts it into DailyMetric.
// Also reconciles each tracked campaign's local status against Google's
// current status — status only ever flows AdPac -> Google when changed
// through the app (approve, AI-insight pause), so a change made directly in
// the Google Ads UI (e.g. pausing a campaign there) would otherwise sit
// unnoticed in AdPac forever, still showing LIVE. Since "Sync now" is
// clicked far more often than the separate Import button, this is the main
// place that gap gets closed in practice.
// Also the trigger point for token spend: every day whose real ad spend
// gets synced here has that day's SPEND locked in (see ensureDailySpend in
// lib/tokens.ts) — driven by the AI-impact value, distributed across days
// by that day's share of month-to-date ad spend, not a flat rate per dollar.
// Also refreshes the connected account's real billing currency on every run
// (see fetchAccountCurrency in lib/googleAds.ts) — Google Ads reports cost
// and conversion value in the ACCOUNT's currency (e.g. SAR), which
// fetchCampaignMetrics/fetchAudienceMetrics convert to USD cents before
// they ever reach DailyMetric/AudienceMetric, since that's what AdPac's
// tokens and invoices are priced in.
// Two ways to call this:
//   1. A scheduler (cron) with no session — protect it with SYNC_SECRET:
//      if (req.headers.get('x-sync-secret') !== process.env.SYNC_SECRET) { ... 401 }
//      Wire this up with Vercel Cron, GitHub Actions on a schedule, etc.
//   2. A signed-in operator clicking "Sync now" in the dashboard — pass
//      ?googleAdsAccountId=xxx to sync just that one client's account on
//      demand instead of every connected account.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const googleAdsAccountId = req.nextUrl.searchParams.get('googleAdsAccountId');

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (googleAdsAccountId) {
      // Scoped to one client's account — reporting access to that client is enough
      // (this is a "refresh my report data" action, not an edit action).
      const account = await db.googleAdsAccount.findUnique({ where: { id: googleAdsAccountId } });
      if (!account) return NextResponse.json({ error: 'Google Ads account not found' }, { status: 404 });
      if (!(await canViewReporting(me, account.clientId))) {
        return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
      }
    } else if (me.role !== 'ADMIN') {
      // Unscoped — syncs every connected account, so admin-only.
      return NextResponse.json({ error: 'Admin access required to sync all accounts at once' }, { status: 403 });
    }
  }

  const accounts = await db.googleAdsAccount.findMany({
    where: { status: 'connected', ...(googleAdsAccountId ? { id: googleAdsAccountId } : {}) },
  });

  const sinceParam = req.nextUrl.searchParams.get('since');
  const untilParam = req.nextUrl.searchParams.get('until');
  let since: Date;
  let until: Date;
  if (sinceParam && untilParam) {
    since = new Date(sinceParam);
    until = new Date(untilParam);
    if (isNaN(since.getTime()) || isNaN(until.getTime()) || since > until) {
      return NextResponse.json({ error: 'since/until must be valid dates with since before until' }, { status: 400 });
    }
  } else {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
    until = new Date();
    since = new Date();
    since.setDate(since.getDate() - days);
  }
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let synced = 0;
  let audienceSynced = 0;
  let keywordSynced = 0;
  let searchTermSynced = 0;
  let adGroupSynced = 0;
  let adSynced = 0;
  let assetGroupSynced = 0;
  let statusReconciled = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const refreshToken = decryptToken(account.refreshTokenEncrypted);

      // Refresh the account's real billing currency (e.g. "SAR") — cheap,
      // and keeps this current if it ever changes. Non-fatal: falls back to
      // whatever's already stored (or null/USD) if the lookup fails, rather
      // than blocking the whole sync over it. See fetchAccountCurrency and
      // the FX conversion in fetchCampaignMetrics/fetchAudienceMetrics —
      // Google Ads reports cost/conversion-value in THIS currency, not USD.
      let currencyCode = account.currencyCode;
      try {
        const fetched = await fetchAccountCurrency(account.googleCustomerId, refreshToken);
        if (fetched && fetched !== currencyCode) {
          await db.googleAdsAccount.update({ where: { id: account.id }, data: { currencyCode: fetched } });
          currencyCode = fetched;
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} currency lookup: ${err.message}`);
      }

      // Fetched once per account and reused below instead of a DB lookup
      // per metric row — campaigns tracked under this account.
      const tracked = await db.campaign.findMany({
        where: { googleAdsAccountId: account.id, googleCampaignId: { not: null } },
        select: { id: true, googleCampaignId: true, status: true },
      });
      const campaignIdByGoogleId = new Map(tracked.map((c) => [c.googleCampaignId as string, c.id]));

      // Reconcile local status against Google's current status for every
      // tracked campaign — see the block comment above. A failure here
      // shouldn't block the metrics sync below, so it's collected as a
      // non-fatal error rather than thrown.
      try {
        const existingCampaigns = await fetchExistingCampaigns(account.googleCustomerId, refreshToken);
        const statusMap: Record<string, string> = { ENABLED: 'LIVE', PAUSED: 'PAUSED' };
        const statusByGoogleId = new Map(existingCampaigns.map((c) => [c.googleCampaignId, c.status]));
        for (const c of tracked) {
          const googleStatus = statusByGoogleId.get(c.googleCampaignId as string);
          const mappedStatus = googleStatus ? statusMap[googleStatus] : undefined;
          if (mappedStatus && mappedStatus !== c.status) {
            await db.campaign.update({ where: { id: c.id }, data: { status: mappedStatus } });
            c.status = mappedStatus; // keep the in-memory copy consistent for this loop
            statusReconciled++;
          }
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} status reconcile: ${err.message}`);
      }

      const rows = await fetchCampaignMetrics(account.googleCustomerId, refreshToken, fmt(since), fmt(until), currencyCode);
      const touchedDates = new Set<string>();
      for (const row of rows) {
        const campaignId = campaignIdByGoogleId.get(row.campaignId);
        if (!campaignId) continue; // metric for a campaign not tracked in our DB — skip

        await db.dailyMetric.upsert({
          where: { campaignId_date: { campaignId, date: new Date(row.date) } },
          create: {
            campaignId,
            date: new Date(row.date),
            impressions: row.impressions,
            clicks: row.clicks,
            costCents: row.costCents,
            conversions: row.conversions,
            conversionValueCents: row.conversionValueCents,
            searchImpressionSharePct: row.searchImpressionSharePct,
            searchBudgetLostSharePct: row.searchBudgetLostSharePct,
            searchRankLostSharePct: row.searchRankLostSharePct,
            searchTopImpressionSharePct: row.searchTopImpressionSharePct,
            searchAbsoluteTopImpressionSharePct: row.searchAbsoluteTopImpressionSharePct,
            biddingStrategyType: row.biddingStrategyType,
          },
          update: {
            impressions: row.impressions,
            clicks: row.clicks,
            costCents: row.costCents,
            conversions: row.conversions,
            conversionValueCents: row.conversionValueCents,
            searchImpressionSharePct: row.searchImpressionSharePct,
            searchBudgetLostSharePct: row.searchBudgetLostSharePct,
            searchRankLostSharePct: row.searchRankLostSharePct,
            searchTopImpressionSharePct: row.searchTopImpressionSharePct,
            searchAbsoluteTopImpressionSharePct: row.searchAbsoluteTopImpressionSharePct,
            biddingStrategyType: row.biddingStrategyType,
          },
        });
        synced++;
        touchedDates.add(row.date); // "YYYY-MM-DD" already, from fetchCampaignMetrics
      }

      // Token spend side effect: once a day's real ad spend is synced, lock
      // in that day's SPEND (see ensureDailySpend — idempotent per
      // client+day, so re-syncing an already-locked day is a no-op).
      // Non-fatal — a spend-tracking hiccup shouldn't block metrics sync.
      for (const dateStr of touchedDates) {
        try {
          await ensureDailySpend(account.clientId, new Date(dateStr));
        } catch (err: any) {
          errors.push(`${account.googleCustomerId} daily spend ${dateStr}: ${err.message}`);
        }
      }

      // Audience breakdown (device/age/gender/location) — a failure here
      // (e.g. demographic reporting restricted for this account) shouldn't
      // block the core performance sync above, so errors are collected
      // rather than thrown.
      const { rows: audienceRows, errors: audienceErrors } = await fetchAudienceMetrics(
        account.googleCustomerId,
        refreshToken,
        fmt(since),
        fmt(until),
        currencyCode
      );
      for (const e of audienceErrors) errors.push(`${account.googleCustomerId} audience/${e}`);

      for (const row of audienceRows) {
        const campaignId = campaignIdByGoogleId.get(row.campaignId);
        if (!campaignId) continue;

        await db.audienceMetric.upsert({
          where: {
            campaignId_date_dimension_dimensionValue: {
              campaignId,
              date: new Date(row.date),
              dimension: row.dimension,
              dimensionValue: row.dimensionValue,
            },
          },
          create: {
            campaignId,
            date: new Date(row.date),
            dimension: row.dimension,
            dimensionValue: row.dimensionValue,
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
        audienceSynced++;
      }

      // Keyword, search-term, ad-group, and ad-level performance — each
      // pull failing independently shouldn't block the others or the core
      // sync above, same pattern as the audience breakdown.
      try {
        const keywordRows = await fetchKeywordMetrics(account.googleCustomerId, refreshToken, fmt(since), fmt(until), currencyCode);
        for (const row of keywordRows) {
          const campaignId = campaignIdByGoogleId.get(row.campaignId);
          if (!campaignId) continue;
          await db.keywordMetric.upsert({
            where: {
              campaignId_date_adGroupId_keywordText_matchType: {
                campaignId,
                date: new Date(row.date),
                adGroupId: row.adGroupId,
                keywordText: row.keywordText,
                matchType: row.matchType,
              },
            },
            create: {
              campaignId,
              date: new Date(row.date),
              adGroupId: row.adGroupId,
              adGroupName: row.adGroupName,
              keywordText: row.keywordText,
              matchType: row.matchType,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
              avgCpcCents: row.avgCpcCents,
              qualityScore: row.qualityScore,
            },
            update: {
              adGroupName: row.adGroupName,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
              avgCpcCents: row.avgCpcCents,
              qualityScore: row.qualityScore,
            },
          });
          keywordSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} keywords: ${err.message}`);
      }

      try {
        const searchTermRows = await fetchSearchTermMetrics(account.googleCustomerId, refreshToken, fmt(since), fmt(until), currencyCode);
        for (const row of searchTermRows) {
          const campaignId = campaignIdByGoogleId.get(row.campaignId);
          if (!campaignId) continue;
          await db.searchTermMetric.upsert({
            where: {
              campaignId_date_searchTerm: {
                campaignId,
                date: new Date(row.date),
                searchTerm: row.searchTerm,
              },
            },
            create: {
              campaignId,
              date: new Date(row.date),
              searchTerm: row.searchTerm,
              matchedKeywordText: row.matchedKeywordText,
              matchType: row.matchType,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              matchType: row.matchType,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          searchTermSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} search terms: ${err.message}`);
      }

      try {
        const adGroupRows = await fetchAdGroupMetrics(account.googleCustomerId, refreshToken, fmt(since), fmt(until), currencyCode);
        for (const row of adGroupRows) {
          const campaignId = campaignIdByGoogleId.get(row.campaignId);
          if (!campaignId) continue;
          await db.adGroupMetric.upsert({
            where: {
              campaignId_date_adGroupId: { campaignId, date: new Date(row.date), adGroupId: row.adGroupId },
            },
            create: {
              campaignId,
              date: new Date(row.date),
              adGroupId: row.adGroupId,
              adGroupName: row.adGroupName,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              adGroupName: row.adGroupName,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          adGroupSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} ad groups: ${err.message}`);
      }

      try {
        const assetGroupRows = await fetchAssetGroupMetrics(account.googleCustomerId, refreshToken, fmt(since), fmt(until), currencyCode);
        for (const row of assetGroupRows) {
          const campaignId = campaignIdByGoogleId.get(row.campaignId);
          if (!campaignId) continue;
          await db.assetGroupMetric.upsert({
            where: {
              campaignId_date_assetGroupId: { campaignId, date: new Date(row.date), assetGroupId: row.assetGroupId },
            },
            create: {
              campaignId,
              date: new Date(row.date),
              assetGroupId: row.assetGroupId,
              assetGroupName: row.assetGroupName,
              status: row.status,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              assetGroupName: row.assetGroupName,
              status: row.status,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          assetGroupSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} asset groups: ${err.message}`);
      }

      try {
        const adRows = await fetchAdMetrics(account.googleCustomerId, refreshToken, fmt(since), fmt(until), currencyCode);
        for (const row of adRows) {
          const campaignId = campaignIdByGoogleId.get(row.campaignId);
          if (!campaignId) continue;
          await db.adMetric.upsert({
            where: { campaignId_date_adId: { campaignId, date: new Date(row.date), adId: row.adId } },
            create: {
              campaignId,
              date: new Date(row.date),
              adGroupId: row.adGroupId,
              adId: row.adId,
              headline: row.headline,
              status: row.status,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
            update: {
              headline: row.headline,
              status: row.status,
              impressions: row.impressions,
              clicks: row.clicks,
              costCents: row.costCents,
              conversions: row.conversions,
              conversionValueCents: row.conversionValueCents,
            },
          });
          adSynced++;
        }
      } catch (err: any) {
        errors.push(`${account.googleCustomerId} ads: ${err.message}`);
      }
    } catch (err: any) {
      errors.push(`${account.googleCustomerId}: ${err.message}`);
    }
  }

  return NextResponse.json({
    synced,
    audienceSynced,
    keywordSynced,
    searchTermSynced,
    adGroupSynced,
    adSynced,
    assetGroupSynced,
    statusReconciled,
    errors,
  });
}
