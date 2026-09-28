import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';
import { runGA4Report } from './googleAnalytics';
import { decryptToken } from './crypto';

// ---------------------------------------------------------------------------
// AI performance review — the first place in AdPac where AI looks at how a
// campaign is actually doing (not just drafts it once and forgets it).
//
// Deliberately split in two: budget pacing and anomaly detection are
// computed here in plain TypeScript from real DailyMetric numbers — LLMs are
// bad at precise arithmetic over time series and there's no reason to trust
// one to eyeball a spend trend when a for-loop can do it exactly. The
// computed signals (not raw daily rows) are then handed to Claude, whose job
// is judgment and writing — deciding IF something's worth flagging and
// explaining it in plain language — not doing the math itself.
//
// Every insight this produces is PENDING_APPROVAL in ActionLog, same as
// everywhere else in this app. Nothing here ever calls the Google Ads API
// directly — see /api/ai-insights/[id]/approve for the one place approved
// insights actually execute (lib/googleAds.ts's setCampaignStatus /
// updateCampaignBudget / updateResponsiveSearchAd).
// ---------------------------------------------------------------------------

interface MetricWindow {
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

export interface WastedSearchTerm {
  searchTerm: string;
  costCents: number;
  clicks: number;
}

export interface CampaignSignal {
  campaignId: string;
  googleCampaignId: string | null;
  name: string;
  dailyBudgetCents: number;
  last7d: MetricWindow;
  prior14d: MetricWindow;
  // Search terms that spent real money over the last 21 days with zero
  // conversions to show for it — the raw material for an ADD_NEGATIVE_KEYWORDS
  // insight. Computed here (SUM/GROUP BY, not a judgment call) same as every
  // other signal — Claude only ever picks from this list, never invents a
  // term (see the defense-in-depth filter in generateInsights). Capped to
  // the top 15 by spend so a chronically noisy campaign doesn't blow out the
  // prompt.
  wastedSearchTerms: WastedSearchTerm[];
  // Geographic click concentration with zero return — a location eating a
  // disproportionate share of a campaign's clicks/spend over the last 7 days
  // while converting at zero is one of the more reliable low-noise signals
  // of invalid traffic / click fraud (a real, geographically-spread audience
  // doesn't normally cluster this hard). Computed here from AudienceMetric's
  // "location" dimension — Claude only ever judges whether it's worth an
  // ANOMALY_ALERT, never invents or recomputes the numbers.
  suspiciousLocations: SuspiciousLocationSignal[];
  // Per-device and per-hour-of-day performance over the last 7 days — the
  // raw material for an ADJUST_BID_MODIFIER insight (device and dayparting
  // bid adjustments; see lib/googleAds.ts's setDeviceBidModifier/
  // setHourBidModifier). Deliberately does NOT include a per-location
  // breakdown here — Google Ads no longer supports setting a bid modifier on
  // a location criterion via this API (deprecated in favor of Target CPA/
  // portfolio bidding), so a geographic problem is surfaced instead via
  // suspiciousLocations as an ANOMALY_ALERT, not a bid-modifier proposal.
  // Floor-filtered to rows with real click volume so a nearly-empty bucket
  // doesn't look like a meaningful trend.
  devicePerformance: BidPerformanceRow[];
  hourPerformance: BidPerformanceRow[];
}

export interface SuspiciousLocationSignal {
  location: string;
  clicks: number;
  costCents: number;
  conversions: number;
  clickShare: number; // this location's share of the campaign's total last-7d clicks
}

export interface BidPerformanceRow {
  value: string; // e.g. "MOBILE" for device, "14" (0-23) for hour
  clicks: number;
  costCents: number;
  conversions: number;
}

export interface PacingSignal {
  monthlyBudgetCents: number;
  spendSoFarCents: number;
  expectedSpendCents: number;
  daysElapsed: number;
  daysInMonth: number;
  pacingRatio: number; // spendSoFar / expectedSpend — 1.0 is on pace, >1.2 overspending, <0.8 underspending
}

// Site-wide GA4 context (not per-campaign — without UTM-tagged links there's
// no reliable way to attribute GA4 sessions to a specific Google Ads
// campaign, so this is deliberately account-wide). Useful for catching
// things Google Ads' own numbers can't show: e.g. clicks/spend holding
// steady while GA4 conversions/revenue drop is a strong signal something
// broke in tracking or on the landing page, not that the ads stopped working.
interface GA4Window {
  days: number;
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  engagementRate: number;
  conversions: number;
  revenueCents: number;
  avgDailySessions: number;
  avgDailyConversions: number;
}

export interface GA4Signal {
  last7d: GA4Window;
  prior14d: GA4Window;
  topChannelsLast7d: { channel: string; sessions: number; conversions: number }[];
}

export interface PastDecision {
  type: string;
  campaignName: string | null;
  summary: string;
  status: string; // EXECUTED | REJECTED | FAILED
  daysAgo: number;
  // Real post-approval performance for EXECUTED decisions only — closes the
  // loop from "this was approved" to "did it actually work", using the same
  // computeOutcomes() the approval-panel UI shows a human. Absent for
  // REJECTED/FAILED decisions (nothing was executed to measure) or if there
  // isn't yet a full day of metrics synced since execution.
  outcomeSummary?: string;
}

function summarizeGA4Window(rows: { sessions: number; activeUsers: number; engagedSessions: number; conversions: number; totalRevenue: number }[], days: number): GA4Window {
  const sessions = rows.reduce((a, r) => a + r.sessions, 0);
  const activeUsers = rows.reduce((a, r) => a + r.activeUsers, 0);
  const engagedSessions = rows.reduce((a, r) => a + r.engagedSessions, 0);
  const conversions = rows.reduce((a, r) => a + r.conversions, 0);
  const revenueCents = Math.round(rows.reduce((a, r) => a + r.totalRevenue, 0) * 100);
  return {
    days,
    sessions,
    activeUsers,
    engagedSessions,
    engagementRate: sessions > 0 ? engagedSessions / sessions : 0,
    conversions,
    revenueCents,
    avgDailySessions: days > 0 ? sessions / days : 0,
    avgDailyConversions: days > 0 ? conversions / days : 0,
  };
}

function summarizeWindow(rows: { impressions: number; clicks: number; costCents: number; conversions: number }[], days: number): MetricWindow {
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
    costPerConversionCents: conversions > 0 ? costCents / conversions : 0,
    avgDailyCostCents: days > 0 ? costCents / days : 0,
    avgDailyConversions: days > 0 ? conversions / days : 0,
  };
}

/**
 * Pulls the last 21 days of metrics for a client's LIVE campaigns and splits
 * each into a last-7-days window vs. the prior-14-days window (wide enough
 * to smell out a real trend rather than day-to-day noise), plus month-to-date
 * budget pacing, site-wide GA4 context (if connected), and a summary of the
 * client's last 5 non-pending AI insights so the model has memory of what's
 * already been proposed and decided. All deterministic — no AI involved yet.
 */
export async function computeSignals(clientId: string): Promise<{
  campaignSignals: CampaignSignal[];
  pacing: PacingSignal | null;
  ga4Signal: GA4Signal | null;
  ga4Error: string | null;
  pastDecisions: PastDecision[];
}> {
  const client = await db.client.findUnique({ where: { id: clientId } });
  const campaigns = await db.campaign.findMany({ where: { clientId, status: 'LIVE' } });
  const campaignIds = campaigns.map((c) => c.id);

  const since = new Date();
  since.setDate(since.getDate() - 21);
  since.setHours(0, 0, 0, 0);
  const recentMetrics = campaignIds.length
    ? await db.dailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since } } })
    : [];

  const byCampaign = new Map<string, typeof recentMetrics>();
  for (const m of recentMetrics) {
    const list = byCampaign.get(m.campaignId) ?? [];
    list.push(m);
    byCampaign.set(m.campaignId, list);
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // Wasted search terms: real spend, zero conversions, over the same 21-day
  // window as everything else here. A minimum spend floor (rather than
  // flagging every zero-conversion term) keeps this to terms that actually
  // cost meaningful money — a $0.40 zero-conversion term isn't worth an
  // insight. $10 in the account's own already-USD-converted cents.
  const WASTED_TERM_MIN_COST_CENTS = 1000;
  const searchTermRows = campaignIds.length
    ? await db.searchTermMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: since } } })
    : [];
  const wastedByCampaign = new Map<string, Map<string, WastedSearchTerm>>();
  for (const r of searchTermRows) {
    if (r.conversions > 0) continue;
    const perCampaign = wastedByCampaign.get(r.campaignId) ?? new Map<string, WastedSearchTerm>();
    const key = r.searchTerm.toLowerCase();
    const existing = perCampaign.get(key) ?? { searchTerm: r.searchTerm, costCents: 0, clicks: 0 };
    existing.costCents += r.costCents;
    existing.clicks += r.clicks;
    perCampaign.set(key, existing);
    wastedByCampaign.set(r.campaignId, perCampaign);
  }

  // Geographic click concentration — real fraud/invalid-traffic patterns
  // tend to cluster in a small number of locations rather than spreading
  // like a genuine audience does. Pulled from AudienceMetric's "location"
  // dimension over the same last-7-day window as everything else, summed
  // per location, and flagged only when a location is BOTH a large share of
  // the campaign's clicks AND converting at zero — either fact alone is
  // common and harmless (e.g. a campaign legitimately targeting one city),
  // it's the combination that's the actual signal.
  const SUSPICIOUS_LOCATION_MIN_CLICKS = 20;
  const SUSPICIOUS_LOCATION_MIN_SHARE = 0.25;
  const SUSPICIOUS_LOCATION_MIN_COST_CENTS = 1500; // $15+
  const locationRows = campaignIds.length
    ? await db.audienceMetric.findMany({
        where: { campaignId: { in: campaignIds }, dimension: 'location', date: { gte: sevenDaysAgo } },
      })
    : [];
  const locationsByCampaign = new Map<string, Map<string, { clicks: number; costCents: number; conversions: number }>>();
  for (const r of locationRows) {
    const perCampaign = locationsByCampaign.get(r.campaignId) ?? new Map();
    const existing = perCampaign.get(r.dimensionValue) ?? { clicks: 0, costCents: 0, conversions: 0 };
    existing.clicks += r.clicks;
    existing.costCents += r.costCents;
    existing.conversions += r.conversions;
    perCampaign.set(r.dimensionValue, existing);
    locationsByCampaign.set(r.campaignId, perCampaign);
  }

  // Device and hour-of-day performance — for ADJUST_BID_MODIFIER. Pulled from
  // AudienceMetric's "device"/"hour" dimensions over the same last-7-day
  // window as everything else here, summed per campaign+value. Floor-
  // filtered to at least a handful of clicks so a bucket with 1-2 clicks
  // doesn't read as a real trend.
  const DEVICE_HOUR_MIN_CLICKS = 10;
  const deviceHourRows = campaignIds.length
    ? await db.audienceMetric.findMany({
        where: { campaignId: { in: campaignIds }, dimension: { in: ['device', 'hour'] }, date: { gte: sevenDaysAgo } },
      })
    : [];
  const deviceByCampaign = new Map<string, Map<string, BidPerformanceRow>>();
  const hourByCampaign = new Map<string, Map<string, BidPerformanceRow>>();
  for (const r of deviceHourRows) {
    const target = r.dimension === 'device' ? deviceByCampaign : hourByCampaign;
    const perCampaign = target.get(r.campaignId) ?? new Map<string, BidPerformanceRow>();
    const existing = perCampaign.get(r.dimensionValue) ?? { value: r.dimensionValue, clicks: 0, costCents: 0, conversions: 0 };
    existing.clicks += r.clicks;
    existing.costCents += r.costCents;
    existing.conversions += r.conversions;
    perCampaign.set(r.dimensionValue, existing);
    target.set(r.campaignId, perCampaign);
  }

  const campaignSignals: CampaignSignal[] = campaigns.map((c) => {
    const rows = byCampaign.get(c.id) ?? [];
    const last7d = rows.filter((r) => r.date >= sevenDaysAgo);
    const prior14d = rows.filter((r) => r.date < sevenDaysAgo);
    const wastedSearchTerms = Array.from(wastedByCampaign.get(c.id)?.values() ?? [])
      .filter((t) => t.costCents >= WASTED_TERM_MIN_COST_CENTS)
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, 15);

    const locations = locationsByCampaign.get(c.id);
    const totalLocationClicks = locations
      ? Array.from(locations.values()).reduce((a, v) => a + v.clicks, 0)
      : 0;
    const suspiciousLocations: SuspiciousLocationSignal[] = locations
      ? Array.from(locations.entries())
          .map(([location, v]) => ({
            location,
            clicks: v.clicks,
            costCents: v.costCents,
            conversions: v.conversions,
            clickShare: totalLocationClicks > 0 ? v.clicks / totalLocationClicks : 0,
          }))
          .filter(
            (l) =>
              l.clicks >= SUSPICIOUS_LOCATION_MIN_CLICKS &&
              l.clickShare >= SUSPICIOUS_LOCATION_MIN_SHARE &&
              l.conversions === 0 &&
              l.costCents >= SUSPICIOUS_LOCATION_MIN_COST_CENTS
          )
          .sort((a, b) => b.clickShare - a.clickShare)
          .slice(0, 5)
      : [];

    const devicePerformance = Array.from(deviceByCampaign.get(c.id)?.values() ?? [])
      .filter((r) => r.clicks >= DEVICE_HOUR_MIN_CLICKS)
      .sort((a, b) => b.costCents - a.costCents);
    const hourPerformance = Array.from(hourByCampaign.get(c.id)?.values() ?? [])
      .filter((r) => r.clicks >= DEVICE_HOUR_MIN_CLICKS)
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, 10);

    return {
      campaignId: c.id,
      googleCampaignId: c.googleCampaignId,
      name: c.name,
      dailyBudgetCents: c.dailyBudgetCents,
      last7d: summarizeWindow(last7d, 7),
      prior14d: summarizeWindow(prior14d, 14),
      wastedSearchTerms,
      suspiciousLocations,
      devicePerformance,
      hourPerformance,
    };
  });

  let pacing: PacingSignal | null = null;
  if (client?.monthlyBudget) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const monthMetrics = campaignIds.length
      ? await db.dailyMetric.findMany({ where: { campaignId: { in: campaignIds }, date: { gte: firstOfMonth } } })
      : [];
    const spendSoFarCents = monthMetrics.reduce((a, m) => a + m.costCents, 0);
    const expectedSpendCents = Math.round(client.monthlyBudget * (daysElapsed / daysInMonth));
    pacing = {
      monthlyBudgetCents: client.monthlyBudget,
      spendSoFarCents,
      expectedSpendCents,
      daysElapsed,
      daysInMonth,
      pacingRatio: expectedSpendCents > 0 ? spendSoFarCents / expectedSpendCents : 0,
    };
  }

  // GA4 context — best-effort. A GA4 API hiccup shouldn't take down the
  // whole review, so failures are swallowed into ga4Error rather than thrown.
  let ga4Signal: GA4Signal | null = null;
  let ga4Error: string | null = null;
  const property = await db.googleAnalyticsProperty.findFirst({ where: { clientId } });
  if (property) {
    try {
      const refreshToken = decryptToken(property.refreshTokenEncrypted);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const today = new Date();
      const until = new Date(today);
      until.setDate(until.getDate() - 1); // yesterday — today is always partial
      const sinceGA4 = new Date(today);
      sinceGA4.setDate(sinceGA4.getDate() - 21);
      const last7dStart = new Date(today);
      last7dStart.setDate(last7dStart.getDate() - 7);

      const { daily } = await runGA4Report(property.ga4PropertyId, refreshToken, fmt(sinceGA4), fmt(until));
      const last7dRows = daily.filter((r) => new Date(r.date) >= last7dStart);
      const prior14dRows = daily.filter((r) => new Date(r.date) < last7dStart);

      // Separate call just for the last-7-day channel breakdown — a snapshot
      // of what's currently driving traffic is more actionable than a
      // 21-day blend.
      const { channels } = await runGA4Report(property.ga4PropertyId, refreshToken, fmt(last7dStart), fmt(until));

      ga4Signal = {
        last7d: summarizeGA4Window(last7dRows, 7),
        prior14d: summarizeGA4Window(prior14dRows, 14),
        topChannelsLast7d: channels.slice(0, 5),
      };
    } catch (err: any) {
      ga4Error = err.message ?? 'GA4 report failed';
    }
  }

  // Past decisions — last 5 non-pending AI insights for this client, so the
  // model can see what's already been proposed and either approved,
  // rejected, or failed, rather than repeating a suggestion someone already
  // turned down on the same underlying data.
  const AI_INSIGHT_TYPES = ['ADJUST_BUDGET', 'PAUSE_CAMPAIGN', 'REWRITE_AD_COPY', 'ANOMALY_ALERT', 'ADD_NEGATIVE_KEYWORDS', 'REALLOCATE_BUDGET'];
  const recentLogs = await db.actionLog.findMany({
    where: { clientId, actionType: { in: AI_INSIGHT_TYPES }, status: { not: 'PENDING_APPROVAL' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { campaign: { select: { name: true } } },
  });
  const now = Date.now();

  // Real "did it work" numbers for whichever of the 5 past decisions were
  // actually EXECUTED — the same computation the approval-panel UI already
  // shows a human, just also handed to the model so the *next* review can
  // reason about outcomes instead of only "was this approved".
  const executedOutcomes = await computeOutcomes(
    recentLogs
      .filter((l) => l.status === 'EXECUTED')
      .map((l) => ({ id: l.id, campaignId: l.campaignId, executedAt: l.executedAt }))
  );

  const pastDecisions: PastDecision[] = recentLogs.map((log) => {
    let summary = '';
    try {
      summary = JSON.parse(log.payloadJson).summary ?? '';
    } catch {
      /* ignore malformed payload */
    }
    const outcome = executedOutcomes[log.id];
    const outcomeSummary =
      outcome && outcome.hasData
        ? `Since execution (${outcome.daysSinceExecuted}d ago): avg daily cost $${(outcome.avgDailyCostCents / 100).toFixed(2)}, avg daily conversions ${outcome.avgDailyConversions.toFixed(2)}, CTR ${(outcome.ctr * 100).toFixed(2)}%`
        : outcome
        ? `Executed ${outcome.daysSinceExecuted}d ago, no metrics synced since yet`
        : undefined;
    return {
      type: log.actionType,
      campaignName: log.campaign?.name ?? null,
      summary,
      status: log.status,
      daysAgo: Math.floor((now - log.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      outcomeSummary,
    };
  });

  return { campaignSignals, pacing, ga4Signal, ga4Error, pastDecisions };
}

const InsightSchema = z.object({
  type: z.enum(['ADJUST_BUDGET', 'PAUSE_CAMPAIGN', 'REWRITE_AD_COPY', 'ANOMALY_ALERT', 'ADD_NEGATIVE_KEYWORDS', 'REALLOCATE_BUDGET', 'ADJUST_BID_MODIFIER']),
  campaignId: z.string(), // must match a campaignId we actually gave it — validated below. For REALLOCATE_BUDGET, this is the campaign RECEIVING budget.
  summary: z.string(), // one line, shown as the headline in the approval UI
  rationale: z.string(), // 2-3 sentences, must reference the actual numbers given
  proposedDailyBudgetCents: z.number().int().positive().optional(), // required for ADJUST_BUDGET
  proposedHeadlines: z.array(z.string().max(30)).min(8).max(15).optional(), // required for REWRITE_AD_COPY
  proposedDescriptions: z.array(z.string().max(90)).min(2).max(4).optional(), // required for REWRITE_AD_COPY
  proposedNegativeKeywords: z.array(z.string()).min(1).max(15).optional(), // required for ADD_NEGATIVE_KEYWORDS — must be drawn from that campaign's wastedSearchTerms, verified below
  reallocateFromCampaignId: z.string().optional(), // required for REALLOCATE_BUDGET — the underperforming campaign losing budget, must be a different campaignId we gave it
  reallocateAmountCents: z.number().int().positive().optional(), // required for REALLOCATE_BUDGET — daily budget moved from reallocateFromCampaignId to campaignId
  bidModifierCriterionType: z.enum(['DEVICE', 'HOUR']).optional(), // required for ADJUST_BID_MODIFIER
  bidModifierValue: z.string().optional(), // required for ADJUST_BID_MODIFIER — must exactly match a value from that campaign's devicePerformance/hourPerformance
  proposedBidModifier: z.number().min(0).max(10).optional(), // required for ADJUST_BID_MODIFIER — Google's own multiplier scale: 1.0 = no change, 0 = opt out entirely (DEVICE only)
});
const InsightsResponseSchema = z.object({ insights: z.array(InsightSchema).max(8) });

export type Insight = z.infer<typeof InsightSchema>;

const SYSTEM_PROMPT =
  'You are a cautious Google Ads performance analyst reviewing real campaign data for an agency. ' +
  'You are given pre-computed metrics (not raw data to analyze yourself) — a last-7-day window vs. a ' +
  'prior-14-day window per campaign (avgDaily* fields are already normalized per day, safe to compare ' +
  'directly across windows of different lengths), plus month-to-date budget pacing. Only flag something ' +
  'if the numbers given actually support it — never invent a trend that is not in the data. Most reviews ' +
  'should produce zero or very few insights; a quiet, well-performing account is a valid, expected ' +
  'outcome, not a failure to find something. Every insight must cite the specific numbers from the ' +
  'input in its rationale. Only reference campaignId values that appear in the input — never invent one. ' +
  'For ADJUST_BUDGET, proposedDailyBudgetCents must stay within roughly 50%-150% of the campaign\'s ' +
  'current dailyBudgetCents given in the input — do not propose extreme jumps. For PAUSE_CAMPAIGN, only ' +
  'propose this for a clear, sustained performance collapse, not a single noisy day. For REWRITE_AD_COPY, ' +
  'only propose this when CTR has meaningfully declined, and write genuinely different headlines/' +
  'descriptions, not trivial rewordings — keep them in the same language as what is implied by the ' +
  'existing campaign name/context. For ANOMALY_ALERT, use it for anything worth a human\'s attention that ' +
  'is not a clean fit for the other three types (e.g. conversions dropped to zero while spend continued, ' +
  'which often means tracking broke rather than performance genuinely cratering) — this type never needs ' +
  'proposed values, it is purely informational.\n\n' +
  'Each campaign may include wastedSearchTerms — real search terms that spent money over the last 21 days ' +
  'with zero conversions, already filtered to a meaningful spend floor and sorted by cost descending. For ' +
  'ADD_NEGATIVE_KEYWORDS, propose adding some of these as negative keywords. proposedNegativeKeywords MUST ' +
  'be an exact copy of search term strings taken from that campaign\'s wastedSearchTerms list — never invent, ' +
  'paraphrase, or generalize a term (e.g. do not turn "free plumber coupon" into "free" or "coupon"). Only ' +
  'propose this when the wasted spend is meaningful relative to the campaign\'s daily budget — a single $10 ' +
  'term on a $500/day campaign is not worth an insight. If wastedSearchTerms is empty or immaterial for a ' +
  'campaign, do not propose this type for it.\n\n' +
  'You may also be given ga4Signal — site-wide GA4 website data (sessions, engagement rate, conversions, ' +
  'revenue), NOT broken out per campaign, since without UTM tagging there is no reliable way to attribute ' +
  'GA4 sessions to one specific Google Ads campaign. Use it as corroborating account-level context, not as ' +
  'a per-campaign metric: e.g. if Ads spend/clicks held steady but GA4 conversions or revenue dropped ' +
  'sharply account-wide, that is strong ANOMALY_ALERT material (likely broken tracking or a site/landing-' +
  'page problem, not the ads themselves failing) — say so explicitly and note it is site-wide, not ' +
  'isolated to one campaign. If ga4Signal is absent, GA4 is not connected for this client; do not ' +
  'speculate about it.\n\n' +
  'You are also given pastDecisions — up to 5 of this client\'s most recent AI insights that a human ' +
  'already acted on (status EXECUTED, REJECTED, or FAILED), each with the campaign, a summary, and how ' +
  'many days ago. Do not re-propose something a human already REJECTED for the same campaign unless the ' +
  'underlying numbers have materially changed since — a rejection is a signal the recommendation was not ' +
  'wanted, not something to retry the following week with the same rationale. An EXECUTED decision may also ' +
  'include outcomeSummary — real performance measured after it was applied. Use this to judge whether the ' +
  'change actually worked, not just that it was approved: if outcomeSummary shows performance is still poor ' +
  'or got worse after a change meant to fix it, that is itself worth a fresh insight (e.g. a budget raise ' +
  'that has not improved conversions, or a pause that did not stop the bleeding elsewhere) — reference the ' +
  'outcomeSummary numbers explicitly when you do. If outcomeSummary shows things improved, do not re-flag ' +
  'the same issue.\n\n' +
  'For REALLOCATE_BUDGET, propose this instead of two separate ADJUST_BUDGET insights when one LIVE ' +
  'campaign is clearly outperforming another on cost per conversion (using avgDailyConversions and ' +
  'avgDailyCostCents from last7d) and the underperformer has real budget headroom to give up. campaignId is ' +
  'the campaign RECEIVING the budget increase; reallocateFromCampaignId is the underperforming campaign ' +
  'losing budget — both must be campaignId values given in the input, and they must be different campaigns. ' +
  'reallocateAmountCents must not exceed roughly 50% of reallocateFromCampaignId\'s current dailyBudgetCents ' +
  '— never propose emptying a campaign\'s budget entirely. Only propose this when the performance gap is ' +
  'real and sustained across the last7d window, not a single good/bad day.\n\n' +
  'Each campaign may also include devicePerformance and hourPerformance — last-7-day performance broken ' +
  'out by device (MOBILE/DESKTOP/TABLET/CONNECTED_TV) and by hour of day (0-23, account timezone), already ' +
  'floor-filtered to buckets with real click volume. For ADJUST_BID_MODIFIER, propose lowering the bid on a ' +
  'device or hour that is spending real money at a clearly worse cost-per-conversion than the campaign\'s ' +
  'own last7d average (or converting at zero with meaningful spend), or raising the bid on one clearly ' +
  'outperforming it — bidModifierValue must be copied exactly from devicePerformance\'s or hourPerformance\'s ' +
  '"value" field (never invented), bidModifierCriterionType must say which list it came from, and ' +
  'proposedBidModifier is Google\'s own multiplier scale (1.0 = no change; 0.7 = 30% bid decrease; 1.3 = 30% ' +
  'increase) — for HOUR keep it within roughly 0.3-2.0, for DEVICE either within roughly 0.3-2.0 or exactly ' +
  '0 to fully opt out of a device that is pure waste. Note that Google Ads no longer supports bid modifiers ' +
  'on location criteria via this API, so never propose ADJUST_BID_MODIFIER for a location — a geographic ' +
  'problem belongs in ANOMALY_ALERT instead (see suspiciousLocations below).\n\n' +
  'Each campaign may also include suspiciousLocations — locations where a large share of the campaign\'s ' +
  'clicks and spend over the last 7 days came from, with zero conversions to show for it, already filtered ' +
  'to a meaningful click/spend floor. This is a real but not conclusive signal of invalid traffic or click ' +
  'fraud (a location legitimately outside the target audience converting at zero is also possible) — when ' +
  'present, raise it as an ANOMALY_ALERT naming the specific location(s), clickShare, and spend, and frame ' +
  'it as worth investigating rather than a confirmed diagnosis. Do not invent a fraud claim when ' +
  'suspiciousLocations is empty.\n\n' +
  'Respond with ONLY a JSON object matching the schema, no prose, no markdown fences.';

/** Sends the deterministic signals to Claude and returns validated, sanity-checked insights. Never calls the Google Ads API — this only produces PENDING_APPROVAL-shaped recommendations for a human to review. */
export async function generateInsights(
  campaignSignals: CampaignSignal[],
  pacing: PacingSignal | null,
  ga4Signal: GA4Signal | null = null,
  pastDecisions: PastDecision[] = [],
  monthlyGoal: string | null = null
): Promise<Insight[]> {
  if (campaignSignals.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');

  const anthropic = new Anthropic({ apiKey });

  const userMessage = JSON.stringify({
    monthlyGoal,
    pacing,
    ga4Signal,
    pastDecisions,
    campaigns: campaignSignals,
    schema: {
      insights: [
        {
          type: 'ADJUST_BUDGET | PAUSE_CAMPAIGN | REWRITE_AD_COPY | ANOMALY_ALERT | ADD_NEGATIVE_KEYWORDS | REALLOCATE_BUDGET | ADJUST_BID_MODIFIER',
          campaignId: 'must be one of the campaignId values given above (for REALLOCATE_BUDGET, the campaign RECEIVING budget)',
          summary: 'string — one line',
          rationale: 'string — 2-3 sentences citing the actual numbers given',
          proposedDailyBudgetCents: 'integer — only for ADJUST_BUDGET',
          proposedHeadlines: 'string[8-15], each <=30 chars — only for REWRITE_AD_COPY',
          proposedDescriptions: 'string[2-4], each <=90 chars — only for REWRITE_AD_COPY',
          proposedNegativeKeywords:
            'string[1-15], each must exactly match a searchTerm from that campaign\'s wastedSearchTerms — only for ADD_NEGATIVE_KEYWORDS',
          reallocateFromCampaignId:
            'must be a different campaignId given above, the underperforming campaign losing budget — only for REALLOCATE_BUDGET',
          reallocateAmountCents:
            'integer, at most ~50% of reallocateFromCampaignId\'s current dailyBudgetCents — only for REALLOCATE_BUDGET',
          bidModifierCriterionType: '"DEVICE" or "HOUR" — only for ADJUST_BID_MODIFIER',
          bidModifierValue:
            'must exactly match a "value" from that campaign\'s devicePerformance (if DEVICE) or hourPerformance (if HOUR) — only for ADJUST_BID_MODIFIER',
          proposedBidModifier:
            'number 0-10, Google\'s multiplier scale (1.0 = no change) — only for ADJUST_BID_MODIFIER',
        },
      ],
    },
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const validCampaignIds = new Set(campaignSignals.map((c) => c.campaignId));

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

    const result = InsightsResponseSchema.safeParse(parsed);
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

    // Defense in depth beyond schema validation: drop anything that
    // references a campaign we never gave it, or a budget change outside
    // the bound the system prompt asked for — rather than trust the model
    // followed instructions, verify it deterministically before this ever
    // reaches an approval screen.
    const signalById = new Map(campaignSignals.map((c) => [c.campaignId, c]));
    return result.data.insights
      .map((insight) => {
        // For ADD_NEGATIVE_KEYWORDS specifically, sanitize rather than just
        // reject: drop any proposed term that isn't an exact (case-
        // insensitive) match to something in that campaign's own
        // wastedSearchTerms — closes off the model inventing or generalizing
        // a term instead of only trusting the system prompt's instruction
        // not to.
        if (insight.type === 'ADD_NEGATIVE_KEYWORDS' && insight.proposedNegativeKeywords) {
          const wasted = new Set(
            (signalById.get(insight.campaignId)?.wastedSearchTerms ?? []).map((t) => t.searchTerm.toLowerCase())
          );
          return {
            ...insight,
            proposedNegativeKeywords: insight.proposedNegativeKeywords.filter((kw) => wasted.has(kw.toLowerCase())),
          };
        }
        return insight;
      })
      .filter((insight) => {
        if (!validCampaignIds.has(insight.campaignId)) return false;
        if (insight.type === 'ADJUST_BUDGET') {
          const current = signalById.get(insight.campaignId)?.dailyBudgetCents ?? 0;
          if (!insight.proposedDailyBudgetCents || current <= 0) return false;
          const ratio = insight.proposedDailyBudgetCents / current;
          if (ratio < 0.5 || ratio > 1.5) return false;
        }
        if (insight.type === 'REWRITE_AD_COPY' && (!insight.proposedHeadlines || !insight.proposedDescriptions)) {
          return false;
        }
        if (insight.type === 'ADD_NEGATIVE_KEYWORDS' && !insight.proposedNegativeKeywords?.length) {
          return false;
        }
        if (insight.type === 'REALLOCATE_BUDGET') {
          if (!insight.reallocateFromCampaignId || !insight.reallocateAmountCents) return false;
          if (insight.reallocateFromCampaignId === insight.campaignId) return false;
          if (!validCampaignIds.has(insight.reallocateFromCampaignId)) return false;
          const fromBudget = signalById.get(insight.reallocateFromCampaignId)?.dailyBudgetCents ?? 0;
          if (fromBudget <= 0 || insight.reallocateAmountCents > fromBudget * 0.5) return false;
        }
        if (insight.type === 'ADJUST_BID_MODIFIER') {
          if (!insight.bidModifierCriterionType || !insight.bidModifierValue || insight.proposedBidModifier === undefined) {
            return false;
          }
          const signal = signalById.get(insight.campaignId);
          const list = insight.bidModifierCriterionType === 'DEVICE' ? signal?.devicePerformance : signal?.hourPerformance;
          const found = list?.some((r) => r.value === insight.bidModifierValue);
          if (!found) return false;
          const mod = insight.proposedBidModifier;
          const isDeviceOptOut = insight.bidModifierCriterionType === 'DEVICE' && mod === 0;
          if (!isDeviceOptOut && (mod < 0.3 || mod > 2.0)) return false;
        }
        return true;
      });
  }

  throw new Error('AI insight generation failed validation after 2 attempts');
}

// ---------------------------------------------------------------------------
// Outcome monitoring — once an insight is approved and EXECUTED, this
// answers "did it actually work?" by pulling real DailyMetric rows from
// *after* executedAt and summarizing them the same way computeSignals
// summarizes its windows. Deliberately recomputed fresh on every page load
// rather than stored once — as more days of metrics sync in, the picture
// gets more complete automatically, with no extra action needed. Compared
// against the insight's frozen signalSnapshot (the last7d numbers at the
// moment it was proposed) so "before" and "after" are both visible.
// ---------------------------------------------------------------------------

export interface InsightOutcome {
  daysSinceExecuted: number;
  hasData: boolean;
  avgDailyCostCents: number;
  avgDailyConversions: number;
  ctr: number;
}

/** Computes a live post-approval performance summary for each EXECUTED insight passed in. Insights without a campaignId or executedAt are skipped (nothing to monitor). */
export async function computeOutcomes(
  executedInsights: { id: string; campaignId: string | null; executedAt: Date | null }[]
): Promise<Record<string, InsightOutcome>> {
  const relevant = executedInsights.filter(
    (i): i is { id: string; campaignId: string; executedAt: Date } => !!i.campaignId && !!i.executedAt
  );
  if (relevant.length === 0) return {};

  const campaignIds = Array.from(new Set(relevant.map((i) => i.campaignId)));
  const earliestExecutedAt = new Date(Math.min(...relevant.map((i) => i.executedAt.getTime())));
  const earliestStartOfDay = new Date(earliestExecutedAt);
  earliestStartOfDay.setHours(0, 0, 0, 0);

  const rows = await db.dailyMetric.findMany({
    where: { campaignId: { in: campaignIds }, date: { gte: earliestStartOfDay } },
  });
  const byCampaign = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaignId) ?? [];
    list.push(r);
    byCampaign.set(r.campaignId, list);
  }

  const now = Date.now();
  const outcomes: Record<string, InsightOutcome> = {};
  for (const insight of relevant) {
    const startOfDay = new Date(insight.executedAt);
    startOfDay.setHours(0, 0, 0, 0);
    const daysSinceExecuted = Math.max(1, Math.floor((now - startOfDay.getTime()) / (1000 * 60 * 60 * 24)));
    const campaignRows = (byCampaign.get(insight.campaignId) ?? []).filter((r) => r.date >= startOfDay);

    const impressions = campaignRows.reduce((a, r) => a + r.impressions, 0);
    const clicks = campaignRows.reduce((a, r) => a + r.clicks, 0);
    const costCents = campaignRows.reduce((a, r) => a + r.costCents, 0);
    const conversions = campaignRows.reduce((a, r) => a + r.conversions, 0);

    outcomes[insight.id] = {
      daysSinceExecuted,
      hasData: campaignRows.length > 0,
      avgDailyCostCents: campaignRows.length > 0 ? costCents / campaignRows.length : 0,
      avgDailyConversions: campaignRows.length > 0 ? conversions / campaignRows.length : 0,
      ctr: impressions > 0 ? clicks / impressions : 0,
    };
  }

  return outcomes;
}
