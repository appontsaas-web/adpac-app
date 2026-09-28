import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';

// ---------------------------------------------------------------------------
// Meta (Facebook/Instagram) AI performance review — the Meta counterpart to
// lib/aiInsights.ts, same split: deterministic signal computation here in
// plain TypeScript from real MetaDailyMetric numbers (last-7d vs prior-14d
// windows, same shape as Google Ads' CampaignSignal), Claude only judges
// what's worth flagging and writes the explanation. Every insight this
// produces lands PENDING_APPROVAL in ActionLog (metaCampaignId set instead
// of campaignId — see the schema comment in prisma/schema.prisma) — nothing
// here ever calls the Meta API directly; see /api/meta-insights/[id]/approve
// for the one place an approved insight actually executes (lib/meta.ts's
// setCampaignStatus / updateCampaignDailyBudget).
//
// Deliberately a smaller insight surface than Google Ads for now — no
// creative-rewrite or keyword-level insight types, since this integration
// manages existing Meta campaigns (see the MetaCampaign schema comment) and
// doesn't touch creative assets:
//   META_ADJUST_BUDGET  — propose a new dailyBudgetCents for a campaign
//   META_PAUSE_CAMPAIGN — propose pausing a campaign in clear, sustained decline
//   META_ANOMALY_ALERT  — informational only, no proposed values
// ---------------------------------------------------------------------------

interface MetaMetricWindow {
  days: number;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  ctr: number;
  costPerConversionCents: number;
  avgDailyCostCents: number; // pre-divided so Claude never has to do the days-normalization itself
  avgDailyConversions: number;
}

export interface MetaCampaignSignal {
  campaignId: string; // local MetaCampaign.id
  metaCampaignId: string;
  name: string;
  objective: string;
  status: string; // ACTIVE | PAUSED | DELETED | ARCHIVED, as of last sync
  dailyBudgetCents: number | null;
  last7d: MetaMetricWindow;
  prior14d: MetaMetricWindow;
}

export interface PastMetaDecision {
  type: string;
  campaignName: string | null;
  summary: string;
  status: string; // EXECUTED | REJECTED | FAILED
  daysAgo: number;
}

function summarizeMetaWindow(
  rows: { impressions: number; clicks: number; costCents: number; conversions: number }[],
  days: number
): MetaMetricWindow {
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const costCents = rows.reduce((a, r) => a + r.costCents, 0);
  const conversions = rows.reduce((a, r) => a + r.conversions, 0);
  return {
    days,
    impressions,
    clicks,
    costCents,
    conversions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    costPerConversionCents: conversions > 0 ? Math.round(costCents / conversions) : 0,
    avgDailyCostCents: days > 0 ? costCents / days : 0,
    avgDailyConversions: days > 0 ? conversions / days : 0,
  };
}

const META_INSIGHT_TYPES = ['META_ADJUST_BUDGET', 'META_PAUSE_CAMPAIGN', 'META_ANOMALY_ALERT'];

/**
 * Pulls the last 21 days of MetaDailyMetric for every tracked campaign
 * (split last-7d vs prior-14d, same window shape as computeSignals in
 * lib/aiInsights.ts) and a summary of the client's last 5 non-pending Meta
 * insights so the model has memory of what's already been proposed. All
 * deterministic — no AI involved yet.
 */
export async function computeMetaSignals(clientId: string): Promise<{
  campaignSignals: MetaCampaignSignal[];
  pastDecisions: PastMetaDecision[];
}> {
  const accounts = await db.metaAdAccount.findMany({ where: { clientId } });
  const accountIds = accounts.map((a) => a.id);
  const campaigns = accountIds.length
    ? await db.metaCampaign.findMany({ where: { adAccountId: { in: accountIds }, hiddenFromList: false } })
    : [];
  const campaignIds = campaigns.map((c) => c.id);

  const since = new Date();
  since.setDate(since.getDate() - 21);
  since.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const recentMetrics = campaignIds.length
    ? await db.metaDailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since } } })
    : [];
  const byCampaign = new Map<string, typeof recentMetrics>();
  for (const m of recentMetrics) {
    const list = byCampaign.get(m.campaignId) ?? [];
    list.push(m);
    byCampaign.set(m.campaignId, list);
  }

  const campaignSignals: MetaCampaignSignal[] = campaigns.map((c) => {
    const rows = byCampaign.get(c.id) ?? [];
    const last7d = rows.filter((r) => r.date >= sevenDaysAgo);
    const prior14d = rows.filter((r) => r.date < sevenDaysAgo);
    return {
      campaignId: c.id,
      metaCampaignId: c.metaCampaignId,
      name: c.name,
      objective: c.objective,
      status: c.status,
      dailyBudgetCents: c.dailyBudgetCents,
      last7d: summarizeMetaWindow(last7d, 7),
      prior14d: summarizeMetaWindow(prior14d, 14),
    };
  });

  const now = Date.now();
  const recentLogs = await db.actionLog.findMany({
    where: { clientId, actionType: { in: META_INSIGHT_TYPES }, status: { not: 'PENDING_APPROVAL' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { metaCampaign: { select: { name: true } } },
  });
  const pastDecisions: PastMetaDecision[] = recentLogs.map((log) => {
    let summary = '';
    try {
      summary = JSON.parse(log.payloadJson).summary ?? '';
    } catch {
      /* ignore malformed payload */
    }
    return {
      type: log.actionType,
      campaignName: log.metaCampaign?.name ?? null,
      summary,
      status: log.status,
      daysAgo: Math.floor((now - log.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    };
  });

  return { campaignSignals, pastDecisions };
}

const MetaInsightSchema = z.object({
  type: z.enum(['META_ADJUST_BUDGET', 'META_PAUSE_CAMPAIGN', 'META_ANOMALY_ALERT']),
  campaignId: z.string(), // must match a campaignId we actually gave it — validated below
  summary: z.string(), // one line, shown as the headline in the approval UI
  rationale: z.string(), // 2-3 sentences, must reference the actual numbers given
  proposedDailyBudgetCents: z.number().int().positive().optional(), // required for META_ADJUST_BUDGET
});
const MetaInsightsResponseSchema = z.object({ insights: z.array(MetaInsightSchema).max(8) });

export type MetaInsight = z.infer<typeof MetaInsightSchema>;

const SYSTEM_PROMPT =
  'You are a cautious paid-social performance analyst reviewing real Meta (Facebook/Instagram) ad campaign ' +
  'data for an agency managing campaigns on a client\'s behalf. You are given pre-computed metrics (not raw ' +
  'data to analyze yourself) — a last-7-day window vs. a prior-14-day window per campaign (avgDaily* fields ' +
  'are already normalized per day, safe to compare directly across windows of different lengths). Only flag ' +
  'something if the numbers given actually support it — never invent a trend. Most reviews should produce ' +
  'few insights; a healthy account is a valid outcome, not a failure to find something. Every insight must ' +
  'cite the specific numbers from the input in its rationale. Only reference campaignId values that appear ' +
  'in the input — never invent one. Only propose insights for campaigns with status ACTIVE or PAUSED — never ' +
  'for one already DELETED or ARCHIVED.\n\n' +
  'For META_ADJUST_BUDGET, proposedDailyBudgetCents must stay within roughly 50%-150% of the campaign\'s ' +
  'current dailyBudgetCents given in the input — do not propose extreme jumps, and never propose this for a ' +
  'campaign with a null dailyBudgetCents (it uses lifetime_budget or ad-set-level budgets instead, which ' +
  'this integration does not manage). For META_PAUSE_CAMPAIGN, only propose this for a clear, sustained ' +
  'performance collapse over the full last7d window (e.g. costPerConversionCents sharply worse than ' +
  'prior14d\'s with real spend behind it, or conversions near zero despite meaningful spend) — never for a ' +
  'single noisy day, and never for a campaign already PAUSED. For META_ANOMALY_ALERT, use it for something ' +
  'worth a human\'s attention that isn\'t a clean budget/pause call — e.g. CTR collapsing while spend holds ' +
  'steady (often a creative fatigue or targeting issue), or cost per conversion drifting up steadily without ' +
  'yet being a full collapse.\n\n' +
  'You are also given pastDecisions — up to 5 of this client\'s most recent Meta insights a human already ' +
  'acted on (status EXECUTED, REJECTED, or FAILED). Do not re-propose the same type of insight for the same ' +
  'campaign on materially the same underlying numbers a human already saw.\n\n' +
  'Respond with ONLY a JSON object matching the schema, no prose, no markdown fences.';

/** Sends the deterministic signals to Claude and returns validated, sanity-checked insights. Never touches the Meta API — this only produces PENDING_APPROVAL-shaped recommendations for a human to review. */
export async function generateMetaInsights(
  campaignSignals: MetaCampaignSignal[],
  pastDecisions: PastMetaDecision[] = [],
  monthlyGoal: string | null = null
): Promise<MetaInsight[]> {
  if (campaignSignals.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');

  const anthropic = new Anthropic({ apiKey });

  const userMessage = JSON.stringify({
    monthlyGoal,
    campaigns: campaignSignals,
    pastDecisions,
    schema: {
      insights: [
        {
          type: 'META_ADJUST_BUDGET | META_PAUSE_CAMPAIGN | META_ANOMALY_ALERT',
          campaignId: 'must be one of the campaignId values given above',
          summary: 'string — one line',
          rationale: 'string — 2-3 sentences citing the actual numbers given',
          proposedDailyBudgetCents: 'integer — only for META_ADJUST_BUDGET',
        },
      ],
    },
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const validCampaignIds = new Set(campaignSignals.map((c) => c.campaignId));
  const signalById = new Map(campaignSignals.map((c) => [c.campaignId, c]));

  for (let attempt = 1; attempt <= 2; attempt++) {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      messages.push(
        { role: 'assistant', content: textBlock.text },
        { role: 'user', content: 'That was not valid JSON. Respond again with ONLY a valid JSON object matching the schema.' }
      );
      continue;
    }

    const result = MetaInsightsResponseSchema.safeParse(parsed);
    if (!result.success) {
      if (attempt < 2) {
        messages.push(
          { role: 'assistant', content: textBlock.text },
          {
            role: 'user',
            content:
              'That response failed validation: ' +
              JSON.stringify(result.error.issues) +
              '. Respond again with the complete corrected JSON object, no prose.',
          }
        );
      }
      continue;
    }

    // Defense in depth beyond schema validation: verify every proposed value
    // against the real signal data before it's ever surfaced for human
    // approval, rather than trust the model followed instructions.
    return result.data.insights.filter((insight) => {
      if (!validCampaignIds.has(insight.campaignId)) return false;
      const signal = signalById.get(insight.campaignId);
      if (!signal) return false;
      if (signal.status !== 'ACTIVE' && signal.status !== 'PAUSED') return false;

      if (insight.type === 'META_ADJUST_BUDGET') {
        const current = signal.dailyBudgetCents ?? 0;
        if (!insight.proposedDailyBudgetCents || current <= 0) return false;
        const ratio = insight.proposedDailyBudgetCents / current;
        if (ratio < 0.5 || ratio > 1.5) return false;
      }
      if (insight.type === 'META_PAUSE_CAMPAIGN' && signal.status === 'PAUSED') return false;

      return true;
    });
  }

  throw new Error('AI Meta insight generation failed validation after 2 attempts');
}
