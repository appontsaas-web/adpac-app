import { db } from '@/lib/db';

// Shared cross-platform rollup used by the Summary tab API and its PDF export.
// Covers EVERY connected ad account (not just the first) on all four ad
// platforms. All platform money is already stored as USD cents (lib/fx.ts),
// so summing is exact; the UI converts to the client's display currency.

export type PlatformKey = 'google' | 'meta' | 'snapchat' | 'tiktok';

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  google: 'Google Ads',
  meta: 'Meta Ads (Facebook & Instagram)',
  snapchat: 'Snapchat Ads',
  tiktok: 'TikTok Ads',
};

export interface Sums {
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}
export interface PlatformSummary extends Sums {
  platform: PlatformKey;
  label: string;
  connected: boolean;
  accountCount: number;
  campaignCount: number;
}
export interface CampaignSpend {
  platform: PlatformKey;
  name: string;
  costCents: number;
  clicks: number;
  impressions: number;
  conversions: number;
}
export interface Rollup {
  platforms: PlatformSummary[];
  totals: Sums;
  campaigns: CampaignSpend[];
  daily: { date: string; costCents: number }[];
  dailyByPlatform: { date: string; platform: PlatformKey; costCents: number }[];
}

const zero = (): Sums => ({ impressions: 0, clicks: 0, costCents: 0, conversions: 0, conversionValueCents: 0 });

type MetricRow = { campaignId: string; date: Date } & Sums;

export async function loadPlatformRollup(clientId: string, since: Date, until: Date): Promise<Rollup> {
  const range = { gte: since, lte: until };
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      googleAdsAccounts: { select: { id: true } },
      metaAdAccounts: { select: { id: true } },
      snapAdAccounts: { select: { id: true } },
      tiktokAdAccounts: { select: { id: true } },
    },
  });

  const cfg: { platform: PlatformKey; accountIds: string[]; load: (accountIds: string[]) => Promise<{ camps: { id: string; name: string }[]; metrics: MetricRow[] }> }[] = [
    {
      platform: 'google',
      accountIds: (client?.googleAdsAccounts ?? []).map((a) => a.id),
      load: async (ids) => {
        const camps = await db.campaign.findMany({ where: { googleAdsAccountId: { in: ids } }, select: { id: true, name: true } });
        const metrics = camps.length ? await db.dailyMetric.findMany({ where: { campaignId: { in: camps.map((c) => c.id) }, date: range } }) : [];
        return { camps, metrics };
      },
    },
    {
      platform: 'meta',
      accountIds: (client?.metaAdAccounts ?? []).map((a) => a.id),
      load: async (ids) => {
        const camps = await db.metaCampaign.findMany({ where: { adAccountId: { in: ids } }, select: { id: true, name: true } });
        const metrics = camps.length ? await db.metaDailyMetric.findMany({ where: { campaignId: { in: camps.map((c) => c.id) }, date: range } }) : [];
        return { camps, metrics };
      },
    },
    {
      platform: 'snapchat',
      accountIds: (client?.snapAdAccounts ?? []).map((a) => a.id),
      load: async (ids) => {
        const camps = await db.snapCampaign.findMany({ where: { adAccountId: { in: ids } }, select: { id: true, name: true } });
        const metrics = camps.length ? await db.snapDailyMetric.findMany({ where: { campaignId: { in: camps.map((c) => c.id) }, date: range } }) : [];
        return { camps, metrics };
      },
    },
    {
      platform: 'tiktok',
      accountIds: (client?.tiktokAdAccounts ?? []).map((a) => a.id),
      load: async (ids) => {
        const camps = await db.tikTokCampaign.findMany({ where: { adAccountId: { in: ids } }, select: { id: true, name: true } });
        const metrics = camps.length ? await db.tikTokDailyMetric.findMany({ where: { campaignId: { in: camps.map((c) => c.id) }, date: range } }) : [];
        return { camps, metrics };
      },
    },
  ];

  const platforms: PlatformSummary[] = [];
  const totals = zero();
  const campaigns: CampaignSpend[] = [];
  const daily = new Map<string, number>();
  const dailyByPlatform = new Map<string, number>();

  for (const c of cfg) {
    const base = { platform: c.platform, label: PLATFORM_LABELS[c.platform], accountCount: c.accountIds.length };
    if (c.accountIds.length === 0) {
      platforms.push({ ...base, connected: false, campaignCount: 0, ...zero() });
      continue;
    }
    const { camps, metrics } = await c.load(c.accountIds);
    const sums = zero();
    const byCamp = new Map<string, CampaignSpend>();
    for (const m of metrics) {
      sums.impressions += m.impressions;
      sums.clicks += m.clicks;
      sums.costCents += m.costCents;
      sums.conversions += m.conversions;
      sums.conversionValueCents += m.conversionValueCents;
      const day = m.date.toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + m.costCents);
      const k = `${day}|${c.platform}`;
      dailyByPlatform.set(k, (dailyByPlatform.get(k) ?? 0) + m.costCents);
      const camp = camps.find((x) => x.id === m.campaignId);
      if (!camp) continue;
      const e = byCamp.get(camp.id) ?? { platform: c.platform, name: camp.name, costCents: 0, clicks: 0, impressions: 0, conversions: 0 };
      e.costCents += m.costCents;
      e.clicks += m.clicks;
      e.impressions += m.impressions;
      e.conversions += m.conversions;
      byCamp.set(camp.id, e);
    }
    campaigns.push(...byCamp.values());
    totals.impressions += sums.impressions;
    totals.clicks += sums.clicks;
    totals.costCents += sums.costCents;
    totals.conversions += sums.conversions;
    totals.conversionValueCents += sums.conversionValueCents;
    platforms.push({ ...base, connected: true, campaignCount: camps.length, ...sums });
  }

  return {
    platforms,
    totals,
    campaigns: campaigns.sort((a, b) => b.costCents - a.costCents),
    daily: Array.from(daily.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, costCents]) => ({ date, costCents })),
    dailyByPlatform: Array.from(dailyByPlatform.entries()).map(([k, costCents]) => {
      const [date, platform] = k.split('|');
      return { date, platform: platform as PlatformKey, costCents };
    }),
  };
}
