import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';
import { decryptToken } from './crypto';
import { runGA4Report } from './googleAnalytics';

// ---------------------------------------------------------------------------
// Funnel Analysis & Optimization — client-level (not per-campaign) review of
// what happens AFTER a click: ad click -> GA4 landing-page session -> engaged
// session -> conversion. Same split as lib/aiInsights.ts: the stage-to-stage
// rates are computed here in plain TypeScript from real DailyMetric/GA4
// numbers, and Claude's only job is deciding whether the weakest stage is
// worth flagging and writing the recommendation in plain language — it never
// invents or recomputes a rate.
//
// This is informational only (same as ANOMALY_ALERT in aiInsights.ts) —
// there is no ad-platform write action for "your landing page has a weak
// engagement rate", so approving one just acknowledges it. See
// /api/ai-insights/[id]/approve, which already special-cases ANOMALY_ALERT
// this way; FUNNEL_OPTIMIZATION is added to that same no-op branch.
//
// Requires the client to have a connected GoogleAnalyticsProperty (see
// lib/googleAnalytics.ts) — without GA4, AdPac has no visibility into
// anything past the click, so this quietly no-ops rather than guessing.
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 30;
const MIN_CLICKS_FOR_REVIEW = 100; // below this, stage-to-stage rates are too noisy to mean anything

export interface FunnelStageRates {
  clicks: number;
  sessions: number;
  engagedSessions: number;
  conversions: number;
  clickToSessionRate: number | null; // sessions / clicks — big gap below 1 suggests a tracking or slow-load issue
  sessionToEngagedRate: number | null; // engagedSessions / sessions — landing-page experience quality
  engagedToConversionRate: number | null; // conversions / engagedSessions — on-site funnel efficiency
}

/**
 * Sums ad-platform clicks (Google Ads + Meta + Snapchat DailyMetric rows,
 * whichever the client has connected) over the window, and GA4
 * sessions/engagedSessions/conversions over the same window, then derives
 * the three stage-to-stage rates. Returns null if the client has no
 * connected GA4 property, or too few clicks for the rates to be meaningful.
 */
export async function computeFunnelStageRates(clientId: string): Promise<FunnelStageRates | null> {
  const ga4Property = await db.googleAnalyticsProperty.findFirst({
    where: { clientId, status: 'connected' },
  });
  if (!ga4Property) return null;

  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const untilStr = until.toISOString().slice(0, 10);
  const sinceStr = since.toISOString().slice(0, 10);

  const [googleClicks, metaClicks, snapClicks] = await Promise.all([
    db.dailyMetric.aggregate({
      _sum: { clicks: true },
      where: { date: { gte: since, lte: until }, campaign: { clientId } },
    }),
    db.metaDailyMetric.aggregate({
      _sum: { clicks: true },
      where: { date: { gte: since, lte: until }, campaign: { adAccount: { clientId } } },
    }),
    db.snapDailyMetric.aggregate({
      _sum: { clicks: true },
      where: { date: { gte: since, lte: until }, campaign: { adAccount: { clientId } } },
    }),
  ]);
  const clicks =
    (googleClicks._sum.clicks ?? 0) + (metaClicks._sum.clicks ?? 0) + (snapClicks._sum.clicks ?? 0);
  if (clicks < MIN_CLICKS_FOR_REVIEW) return null;

  const refreshToken = decryptToken(ga4Property.refreshTokenEncrypted);
  const { daily } = await runGA4Report(ga4Property.ga4PropertyId, refreshToken, sinceStr, untilStr);
  const sessions = daily.reduce((sum, d) => sum + d.sessions, 0);
  const engagedSessions = daily.reduce((sum, d) => sum + d.engagedSessions, 0);
  const conversions = daily.reduce((sum, d) => sum + d.conversions, 0);

  return {
    clicks,
    sessions,
    engagedSessions,
    conversions,
    clickToSessionRate: clicks > 0 ? sessions / clicks : null,
    sessionToEngagedRate: sessions > 0 ? engagedSessions / sessions : null,
    engagedToConversionRate: engagedSessions > 0 ? conversions / engagedSessions : null,
  };
}

const FunnelInsightSchema = z.object({
  hasFinding: z.boolean(),
  summary: z.string().max(200).optional(),
  rationale: z.string().max(600).optional(),
  recommendation: z.string().max(600).optional(),
});

export interface FunnelInsight {
  summary: string;
  rationale: string;
  recommendation: string;
  stageRates: FunnelStageRates;
}

const SYSTEM_PROMPT = `You review a client's ad-to-conversion funnel for AdPac, an ad management platform. You're given clicks (from Google Ads/Meta/Snapchat), and GA4 sessions/engagedSessions/conversions over the same 30-day window, plus three derived stage-to-stage rates:
- clickToSessionRate (sessions/clicks): should be close to 1.0 — a low value suggests a tracking gap or a landing page that's too slow/broken to register a GA4 session for every click.
- sessionToEngagedRate (engagedSessions/sessions): landing-page experience quality — GA4 defines "engaged" as 10+ seconds, a conversion event, or 2+ pageviews. Roughly 0.4-0.6+ is typical; well below that suggests the landing page isn't holding visitors.
- engagedToConversionRate (conversions/engagedSessions): on-site funnel efficiency once someone is actually engaged.

Only flag something (hasFinding: true) if one stage is CLEARLY the weak link and the numbers given support it — don't flag normal variation. If you flag it, name the specific weak stage, cite the actual numbers, and give ONE concrete, actionable recommendation (e.g. "audit GA4 event tagging on the landing page", "test a faster-loading landing page variant", "add a clearer above-the-fold CTA"). This is informational only — you are not proposing any change to campaign budgets, bids, or ad copy, only surfacing a funnel issue for a human to act on outside AdPac.

Respond with ONLY a JSON object: {"hasFinding": boolean, "summary": "one line, only if hasFinding", "rationale": "2-3 sentences citing the actual numbers, only if hasFinding", "recommendation": "one concrete next step, only if hasFinding"}`;

/**
 * Runs the funnel review for one client and, if Claude finds a genuine weak
 * stage, writes a FUNNEL_OPTIMIZATION PENDING_APPROVAL ActionLog (client-
 * level — campaignId left null, same as any other insight not tied to one
 * specific campaign). Skips entirely if there's already a pending one for
 * this client, so a slow-to-resolve finding doesn't re-alert every cycle.
 */
export async function generateFunnelInsight(clientId: string): Promise<FunnelInsight | null> {
  const existing = await db.actionLog.findFirst({
    where: { clientId, actionType: 'FUNNEL_OPTIMIZATION', status: 'PENDING_APPROVAL' },
  });
  if (existing) return null;

  const stageRates = await computeFunnelStageRates(clientId);
  if (!stageRates) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');
  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(stageRates) }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return null;
  }
  const result = FunnelInsightSchema.safeParse(parsed);
  if (!result.success || !result.data.hasFinding) return null;
  if (!result.data.summary || !result.data.rationale || !result.data.recommendation) return null;

  return {
    summary: result.data.summary,
    rationale: result.data.rationale,
    recommendation: result.data.recommendation,
    stageRates,
  };
}

/**
 * Scans every client with a connected GA4 property and runs the funnel
 * review on each — the counterpart the scheduler calls, same shape as
 * lib/creativeTests.ts's generateAbTestInsights().
 */
export async function generateFunnelInsights(): Promise<{ created: number; reviewed: number }> {
  const clients = await db.client.findMany({
    where: { analyticsProperties: { some: { status: 'connected' } } },
    select: { id: true },
  });

  let created = 0;
  for (const { id } of clients) {
    try {
      const insight = await generateFunnelInsight(id);
      if (!insight) continue;
      await db.actionLog.create({
        data: {
          clientId: id,
          actionType: 'FUNNEL_OPTIMIZATION',
          // type mirrors actionType — AIInsightsPanel.tsx reads payload.type
          // the same way it does for every other insight (see aiInsights.ts's
          // Insight interface), so it's included here even though this
          // engine doesn't go through generateInsights()'s shared schema.
          payloadJson: JSON.stringify({ type: 'FUNNEL_OPTIMIZATION', ...insight }),
          status: 'PENDING_APPROVAL',
          proposedBy: 'ai',
        },
      });
      created++;
    } catch (err: any) {
      console.error(`Funnel insight failed for client ${id}:`, err.message);
    }
  }

  return { created, reviewed: clients.length };
}
