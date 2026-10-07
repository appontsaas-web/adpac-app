import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';
import { loadPlatformRollup, PLATFORM_LABELS, PlatformKey } from './platformSpend';

// Free Analysis & Action Plan — the "no free trial, instead a free
// diagnosis" funnel. A prospect connects ONE ad account from the portal,
// we sync 30 days of data, have Claude write a findings + action plan +
// "what we would do if we managed it" report, and show it in the portal for
// 48 hours only. Read-only: nothing is ever written to the prospect's
// ad account.

export const ANALYSIS_TTL_MS = 48 * 60 * 60 * 1000;

const ReportSchema = z.object({
  headline: z.string(),
  healthScore: z.number().int().min(0).max(100),
  summary: z.string(),
  findings: z
    .array(z.object({ title: z.string(), severity: z.enum(['high', 'medium', 'low', 'good']), detail: z.string() }))
    .min(3)
    .max(8),
  actionPlan: z
    .array(z.object({ priority: z.number().int().min(1), action: z.string(), why: z.string(), expectedImpact: z.string() }))
    .min(3)
    .max(8),
  ifWeManagedIt: z.object({
    approach: z.string(),
    first30Days: z.array(z.string()).min(3).max(6),
    expectedOutcome: z.string(),
  }),
});
export type FreeAnalysisReport = z.infer<typeof ReportSchema>;

const SYSTEM_PROMPT =
  'You are a senior paid-media strategist at AdPac writing a FREE diagnostic for a prospective customer who just ' +
  'connected one of their ad accounts. You are given the last 30 days of real numbers. Be specific, honest and ' +
  'concrete: cite actual figures from the data, never invent numbers, and if data is thin say so as a finding. ' +
  'Do not promise guaranteed results; express expected impact as realistic ranges and label them estimates. ' +
  'Money is in USD. Respond with ONLY a JSON object, no prose, no markdown fences, matching: ' +
  '{"headline":string,"healthScore":0-100 integer,"summary":string (2-4 sentences),' +
  '"findings":[{"title":string,"severity":"high"|"medium"|"low"|"good","detail":string}] (3-8),' +
  '"actionPlan":[{"priority":1..n,"action":string,"why":string,"expectedImpact":string}] (3-8, ordered by priority),' +
  '"ifWeManagedIt":{"approach":string,"first30Days":[string] (3-6),"expectedOutcome":string}}';

const SYNC_PATH: Record<PlatformKey, { path: string; param: string }> = {
  google: { path: '/api/metrics/sync', param: 'googleAdsAccountId' },
  meta: { path: '/api/meta/sync', param: 'accountId' },
  snapchat: { path: '/api/snapchat/sync', param: 'accountId' },
  tiktok: { path: '/api/tiktok/sync', param: 'accountId' },
};

/** The single connected account for this client (first found), or null. */
export async function findConnectedAccount(clientId: string): Promise<{ platform: PlatformKey; id: string } | null> {
  const [g, m, s, t] = await Promise.all([
    db.googleAdsAccount.findFirst({ where: { clientId }, select: { id: true } }),
    db.metaAdAccount.findFirst({ where: { clientId }, select: { id: true } }),
    db.snapAdAccount.findFirst({ where: { clientId }, select: { id: true } }),
    db.tikTokAdAccount.findFirst({ where: { clientId }, select: { id: true } }),
  ]);
  if (g) return { platform: 'google', id: g.id };
  if (m) return { platform: 'meta', id: m.id };
  if (s) return { platform: 'snapchat', id: s.id };
  if (t) return { platform: 'tiktok', id: t.id };
  return null;
}

/** Lazily expires: wipes content once past expiresAt. Returns the current row. */
export async function getAnalysis(clientId: string) {
  let a = await db.freeAnalysis.findUnique({ where: { clientId } });
  if (a && a.status === 'READY' && a.expiresAt && a.expiresAt.getTime() <= Date.now()) {
    a = await db.freeAnalysis.update({ where: { clientId }, data: { status: 'EXPIRED', content: null } });
  }
  return a;
}

async function triggerSync(platform: PlatformKey, accountId: string) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) throw new Error('SYNC_SECRET is not configured on the server');
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3010';
  const { path, param } = SYNC_PATH[platform];
  const res = await fetch(`${base}${path}?${param}=${accountId}&days=30`, {
    method: 'POST',
    headers: { 'x-sync-secret': secret },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Sync failed (${res.status}): ${data.error ?? 'unknown error'}`);
  }
}

/** Runs sync -> numbers -> Claude -> stores the 48h report. One analysis per client, ever. */
export async function runFreeAnalysis(clientId: string, locale: 'en' | 'ar' = 'en'): Promise<void> {
  const existing = await db.freeAnalysis.findUnique({ where: { clientId } });
  if (existing && existing.status !== 'PENDING' && existing.status !== 'FAILED') return;

  const account = await findConnectedAccount(clientId);
  if (!account) throw new Error('No connected ad account');

  await db.freeAnalysis.upsert({
    where: { clientId },
    create: { clientId, platform: account.platform, status: 'GENERATING' },
    update: { platform: account.platform, status: 'GENERATING', error: null },
  });

  try {
    await triggerSync(account.platform, account.id);

    const until = new Date();
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const rollup = await loadPlatformRollup(clientId, since, until);
    const t = rollup.totals;
    if (t.impressions === 0 && t.costCents === 0) {
      throw new Error('We connected your account but found no ad activity in the last 30 days to analyse.');
    }

    const client = await db.client.findUnique({ where: { id: clientId }, select: { name: true, industry: true, website: true } });
    const data = {
      business: client?.name,
      industry: client?.industry,
      website: client?.website,
      platform: PLATFORM_LABELS[account.platform],
      period: 'last 30 days',
      totals: {
        spendUsd: +(t.costCents / 100).toFixed(2),
        impressions: t.impressions,
        clicks: t.clicks,
        ctrPct: t.impressions ? +((t.clicks / t.impressions) * 100).toFixed(2) : 0,
        cpcUsd: t.clicks ? +(t.costCents / 100 / t.clicks).toFixed(2) : 0,
        conversions: +t.conversions.toFixed(1),
        costPerConversionUsd: t.conversions ? +(t.costCents / 100 / t.conversions).toFixed(2) : null,
        conversionValueUsd: +(t.conversionValueCents / 100).toFixed(2),
        roas: t.costCents ? +(t.conversionValueCents / t.costCents).toFixed(2) : 0,
      },
      campaigns: rollup.campaigns
        .sort((a, b) => b.costCents - a.costCents)
        .slice(0, 15)
        .map((c) => ({
          name: c.name,
          spendUsd: +(c.costCents / 100).toFixed(2),
          clicks: c.clicks,
          impressions: c.impressions,
          conversions: +c.conversions.toFixed(1),
        })),
      dailySpendUsd: rollup.daily.map((d) => +(d.costCents / 100).toFixed(2)),
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
    const anthropic = new Anthropic({ apiKey });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: JSON.stringify(data) }];
    let report: FreeAnalysisReport | null = null;
    for (let attempt = 1; attempt <= 3 && !report; attempt++) {
      const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: locale === 'ar' ? SYSTEM_PROMPT + ' Write ALL human-readable string values (headline, summary, titles, details, actions, outcomes) in clear professional Modern Standard Arabic; keep JSON keys and the severity enum values in English; keep platform and metric names like CTR, ROAS, CPC in Latin letters.' : SYSTEM_PROMPT, messages });
      const block = msg.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') continue;
      try {
        const parsed = ReportSchema.safeParse(JSON.parse(block.text));
        if (parsed.success) report = parsed.data;
        else messages.push({ role: 'assistant', content: block.text }, { role: 'user', content: 'Invalid: ' + JSON.stringify(parsed.error.issues) + '. Return the corrected JSON only.' });
      } catch {
        messages.push({ role: 'assistant', content: block.text }, { role: 'user', content: 'That was not valid JSON. Return ONLY the JSON object.' });
      }
    }
    if (!report) throw new Error('Could not generate the analysis — please try again.');

    const now = new Date();
    await db.freeAnalysis.update({
      where: { clientId },
      data: {
        status: 'READY',
        content: JSON.stringify({ report, meta: { platform: PLATFORM_LABELS[account.platform], totals: data.totals } }),
        generatedAt: now,
        expiresAt: new Date(now.getTime() + ANALYSIS_TTL_MS),
      },
    });
  } catch (err: any) {
    await db.freeAnalysis.update({ where: { clientId }, data: { status: 'FAILED', error: String(err.message ?? err).slice(0, 500) } });
    throw err;
  }
}

/**
 * Lets a prospect swap the connected account/platform when the first one
 * turned out empty or wrong. Only allowed before a report has been
 * generated (never after READY/EXPIRED — one analysis per customer).
 * Forgets the local link only; nothing is touched on the platform side.
 */
export async function resetFreeAnalysisConnection(clientId: string): Promise<{ ok: boolean; reason?: string }> {
  const analysis = await db.freeAnalysis.findUnique({ where: { clientId } });
  if (analysis && (analysis.status === 'READY' || analysis.status === 'EXPIRED' || analysis.status === 'GENERATING')) {
    return { ok: false, reason: 'Your analysis has already been generated.' };
  }

  // Meta / Snapchat / TikTok: remove campaigns + metrics first (FK order), keeping the ActionLog audit trail.
  const meta = await db.metaAdAccount.findMany({ where: { clientId }, select: { id: true } });
  for (const a of meta) {
    const ids = (await db.metaCampaign.findMany({ where: { adAccountId: a.id }, select: { id: true } })).map((c) => c.id);
    if (ids.length) {
      await db.actionLog.updateMany({ where: { metaCampaignId: { in: ids } }, data: { metaCampaignId: null } });
      await db.metaDailyMetric.deleteMany({ where: { campaignId: { in: ids } } });
      await db.metaCampaign.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await db.metaAdAccount.deleteMany({ where: { clientId } });

  const snap = await db.snapAdAccount.findMany({ where: { clientId }, select: { id: true } });
  for (const a of snap) {
    const ids = (await db.snapCampaign.findMany({ where: { adAccountId: a.id }, select: { id: true } })).map((c) => c.id);
    if (ids.length) {
      await db.actionLog.updateMany({ where: { snapCampaignId: { in: ids } }, data: { snapCampaignId: null } });
      await db.snapDailyMetric.deleteMany({ where: { campaignId: { in: ids } } });
      await db.snapCampaign.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await db.snapAdAccount.deleteMany({ where: { clientId } });

  const tt = await db.tikTokAdAccount.findMany({ where: { clientId }, select: { id: true } });
  for (const a of tt) {
    const ids = (await db.tikTokCampaign.findMany({ where: { adAccountId: a.id }, select: { id: true } })).map((c) => c.id);
    if (ids.length) {
      await db.actionLog.updateMany({ where: { tiktokCampaignId: { in: ids } }, data: { tiktokCampaignId: null } });
      await db.tikTokDailyMetric.deleteMany({ where: { campaignId: { in: ids } } });
      await db.tikTokCampaign.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await db.tikTokAdAccount.deleteMany({ where: { clientId } });

  // Google Ads: campaigns keep a nullable account link (ON DELETE SET NULL), same as the staff disconnect.
  await db.googleAdsAccount.deleteMany({ where: { clientId } });

  await db.freeAnalysis.deleteMany({ where: { clientId } });
  return { ok: true };
}
