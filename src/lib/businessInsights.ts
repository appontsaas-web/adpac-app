import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';

// ---------------------------------------------------------------------------
// Google Business Profile AI review — the branches/reviews counterpart to
// lib/aiInsights.ts. Same split: deterministic signal computation here in
// plain TypeScript (metric drops, which reviews are unanswered), Claude only
// judges what's worth surfacing and, for DRAFT_REVIEW_REPLY, writes the
// actual reply text grounded in the real review comment. Every insight this
// produces lands PENDING_APPROVAL in ActionLog (locationId/businessReviewId
// set instead of campaignId — see the schema comment in prisma/schema.prisma)
// — nothing here ever posts a reply to Google directly; see
// /api/business-insights/[id]/approve for the one place an approved
// DRAFT_REVIEW_REPLY actually calls postReviewReply.
//
// Two insight types:
//   LOCATION_ANOMALY_ALERT — informational only, no proposed values. Flags a
//     branch whose search/maps visibility or customer-action metrics
//     (calls, website clicks, direction requests, messages, bookings) have
//     dropped sharply week over week — often means a listing went
//     unverified, hours/info drifted wrong, or a competitor is now
//     outranking it in Maps.
//   DRAFT_REVIEW_REPLY — drafts a reply to an unanswered review, grounded in
//     that review's real star rating and comment text (never invented).
// ---------------------------------------------------------------------------

interface LocationMetricWindow {
  days: number;
  searchImpressions: number;
  mapsImpressions: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  bookings: number;
  avgDailySearchImpressions: number;
  avgDailyMapsImpressions: number;
  avgDailyCallClicks: number;
  avgDailyWebsiteClicks: number;
}

export interface LocationSignal {
  locationId: string;
  gbpLocationId: string;
  title: string;
  last7d: LocationMetricWindow;
  prior14d: LocationMetricWindow;
}

export interface UnansweredReview {
  businessReviewId: string;
  gbpReviewName: string;
  locationId: string;
  locationTitle: string;
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  daysSinceCreated: number;
}

export interface PastBusinessDecision {
  type: string;
  locationTitle: string | null;
  summary: string;
  status: string; // EXECUTED | REJECTED | FAILED
  daysAgo: number;
}

function summarizeLocationWindow(
  rows: {
    searchImpressions: number;
    mapsImpressions: number;
    callClicks: number;
    websiteClicks: number;
    directionRequests: number;
    conversations: number;
    bookings: number;
  }[],
  days: number
): LocationMetricWindow {
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const searchImpressions = sum((r) => r.searchImpressions);
  const mapsImpressions = sum((r) => r.mapsImpressions);
  const callClicks = sum((r) => r.callClicks);
  const websiteClicks = sum((r) => r.websiteClicks);
  const directionRequests = sum((r) => r.directionRequests);
  const conversations = sum((r) => r.conversations);
  const bookings = sum((r) => r.bookings);
  return {
    days,
    searchImpressions,
    mapsImpressions,
    callClicks,
    websiteClicks,
    directionRequests,
    conversations,
    bookings,
    avgDailySearchImpressions: days > 0 ? searchImpressions / days : 0,
    avgDailyMapsImpressions: days > 0 ? mapsImpressions / days : 0,
    avgDailyCallClicks: days > 0 ? callClicks / days : 0,
    avgDailyWebsiteClicks: days > 0 ? websiteClicks / days : 0,
  };
}

// A review counts as "unanswered" if replyState is NONE (never drafted or
// posted) — PENDING_APPROVAL means a draft already exists awaiting a human,
// REJECTED means a human already declined to reply as drafted (re-drafting
// happens via pastDecisions context below, not by treating it as unanswered
// again forever), POSTED/FAILED are terminal for this purpose.
const UNANSWERED_STATES = ['NONE'];

/**
 * Pulls the last 21 days of LocationMetric for every tracked branch (split
 * last-7d vs prior-14d, same window shape as computeSignals in
 * lib/aiInsights.ts), every currently-unanswered review across those
 * branches, and a summary of the client's last 5 non-pending business
 * insights so the model has memory of what's already been proposed. All
 * deterministic — no AI involved yet.
 */
export async function computeBusinessSignals(clientId: string): Promise<{
  locationSignals: LocationSignal[];
  unansweredReviews: UnansweredReview[];
  pastDecisions: PastBusinessDecision[];
}> {
  const accounts = await db.googleBusinessProfileAccount.findMany({ where: { clientId } });
  const accountIds = accounts.map((a) => a.id);
  const locations = accountIds.length
    ? await db.businessLocation.findMany({ where: { accountId: { in: accountIds } } })
    : [];
  const locationIds = locations.map((l) => l.id);

  const since = new Date();
  since.setDate(since.getDate() - 21);
  since.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const recentMetrics = locationIds.length
    ? await db.locationMetric.findMany({ where: { locationId: { in: locationIds }, date: { gte: since } } })
    : [];
  const byLocation = new Map<string, typeof recentMetrics>();
  for (const m of recentMetrics) {
    const list = byLocation.get(m.locationId) ?? [];
    list.push(m);
    byLocation.set(m.locationId, list);
  }

  const locationSignals: LocationSignal[] = locations.map((l) => {
    const rows = byLocation.get(l.id) ?? [];
    const last7d = rows.filter((r) => r.date >= sevenDaysAgo);
    const prior14d = rows.filter((r) => r.date < sevenDaysAgo);
    return {
      locationId: l.id,
      gbpLocationId: l.gbpLocationId,
      title: l.title,
      last7d: summarizeLocationWindow(last7d, 7),
      prior14d: summarizeLocationWindow(prior14d, 14),
    };
  });

  const now = Date.now();
  const unansweredRows = locationIds.length
    ? await db.businessReview.findMany({
        where: { locationId: { in: locationIds }, replyState: { in: UNANSWERED_STATES } },
        include: { location: { select: { title: true } } },
        orderBy: { createTime: 'asc' },
      })
    : [];
  const unansweredReviews: UnansweredReview[] = unansweredRows.map((r) => ({
    businessReviewId: r.id,
    gbpReviewName: r.gbpReviewName,
    locationId: r.locationId,
    locationTitle: r.location.title,
    reviewerName: r.reviewerName,
    starRating: r.starRating,
    comment: r.comment,
    daysSinceCreated: Math.floor((now - r.createTime.getTime()) / (1000 * 60 * 60 * 24)),
  }));

  const BUSINESS_INSIGHT_TYPES = ['LOCATION_ANOMALY_ALERT', 'DRAFT_REVIEW_REPLY'];
  const recentLogs = await db.actionLog.findMany({
    where: { clientId, actionType: { in: BUSINESS_INSIGHT_TYPES }, status: { not: 'PENDING_APPROVAL' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { location: { select: { title: true } }, businessReview: { include: { location: { select: { title: true } } } } },
  });
  const pastDecisions: PastBusinessDecision[] = recentLogs.map((log) => {
    let summary = '';
    try {
      summary = JSON.parse(log.payloadJson).summary ?? '';
    } catch {
      /* ignore malformed payload */
    }
    return {
      type: log.actionType,
      locationTitle: log.location?.title ?? log.businessReview?.location.title ?? null,
      summary,
      status: log.status,
      daysAgo: Math.floor((now - log.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    };
  });

  return { locationSignals, unansweredReviews, pastDecisions };
}

const BusinessInsightSchema = z.object({
  type: z.enum(['LOCATION_ANOMALY_ALERT', 'DRAFT_REVIEW_REPLY']),
  locationId: z.string().optional(), // required for LOCATION_ANOMALY_ALERT — must match a locationId given
  businessReviewId: z.string().optional(), // required for DRAFT_REVIEW_REPLY — must match a businessReviewId given
  summary: z.string(), // one line, shown as the headline in the approval UI
  rationale: z.string(), // 2-3 sentences, must reference the actual numbers/review text given
  proposedReplyText: z.string().max(3800).optional(), // required for DRAFT_REVIEW_REPLY — kept comfortably under Google's 4096-byte limit
});
const BusinessInsightsResponseSchema = z.object({ insights: z.array(BusinessInsightSchema).max(8) });

export type BusinessInsight = z.infer<typeof BusinessInsightSchema>;

const SYSTEM_PROMPT =
  'You are a cautious local-SEO and customer-communications analyst reviewing real Google Business Profile ' +
  'data for an agency managing branches on a client\'s behalf. You are given pre-computed metrics (not raw ' +
  'data to analyze yourself) — a last-7-day window vs. a prior-14-day window per branch (avgDaily* fields ' +
  'are already normalized per day, safe to compare directly across windows of different lengths) — plus a ' +
  'list of currently unanswered customer reviews. Only flag something if the numbers or review text given ' +
  'actually support it — never invent a trend or a claim that is not in the data. Most reviews should ' +
  'produce few insights; a quiet, healthy account is a valid outcome, not a failure to find something. Only ' +
  'reference locationId/businessReviewId values that appear in the input — never invent one.\n\n' +
  'For LOCATION_ANOMALY_ALERT, use it when a branch\'s avgDailySearchImpressions, avgDailyMapsImpressions, ' +
  'avgDailyCallClicks, or avgDailyWebsiteClicks in last7d has dropped sharply and consistently versus ' +
  'prior14d (not a single noisy day) — this often means the listing went unverified, its hours/address/phone ' +
  'drifted out of date, or it started losing visibility to a competitor in Maps. This type never needs ' +
  'proposed values, it is purely informational — cite the specific before/after numbers in the rationale.\n\n' +
  'For DRAFT_REVIEW_REPLY, propose a reply to one of the reviews in unansweredReviews, grounded strictly in ' +
  'that specific review\'s starRating and comment. proposedReplyText must be a complete, ready-to-post reply ' +
  '(not a suggestion or placeholder), professional and warm in tone, matching the language of the review\'s ' +
  'own comment when possible. For a positive review (4-5 stars), thank the reviewer specifically for what ' +
  'they mentioned, keep it brief. For a negative review (1-2 stars), acknowledge the specific complaint ' +
  'without being defensive, apologize where appropriate, and invite them to reach out directly to resolve ' +
  'it (do not promise a specific outcome, discount, or refund — that is a business decision for a human). ' +
  'For a middling review (3 stars) or one with no comment text at all, a short generic thank-you is fine. ' +
  'Never fabricate specifics (an employee name, an order number, a promised action) that are not in the ' +
  'review itself or plainly generic. Keep replies concise — a few sentences, not an essay.\n\n' +
  'You are also given pastDecisions — up to 5 of this client\'s most recent business insights a human already ' +
  'acted on (status EXECUTED, REJECTED, or FAILED). Do not re-propose a LOCATION_ANOMALY_ALERT for the same ' +
  'branch and same underlying numbers a human already saw; do not re-draft a reply for a review that already ' +
  'has a REJECTED or EXECUTED decision against it unless something materially changed.\n\n' +
  'Respond with ONLY a JSON object matching the schema, no prose, no markdown fences.';

/** Sends the deterministic signals to Claude and returns validated, sanity-checked insights. Never posts to Google — this only produces PENDING_APPROVAL-shaped recommendations for a human to review. */
export async function generateBusinessInsights(
  locationSignals: LocationSignal[],
  unansweredReviews: UnansweredReview[],
  pastDecisions: PastBusinessDecision[] = [],
  monthlyGoal: string | null = null
): Promise<BusinessInsight[]> {
  if (locationSignals.length === 0 && unansweredReviews.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');

  const anthropic = new Anthropic({ apiKey });

  const userMessage = JSON.stringify({
    monthlyGoal,
    locations: locationSignals,
    unansweredReviews,
    pastDecisions,
    schema: {
      insights: [
        {
          type: 'LOCATION_ANOMALY_ALERT | DRAFT_REVIEW_REPLY',
          locationId: 'must be one of the locationId values given above — only for LOCATION_ANOMALY_ALERT',
          businessReviewId: 'must be one of the businessReviewId values given above — only for DRAFT_REVIEW_REPLY',
          summary: 'string — one line',
          rationale: 'string — 2-3 sentences citing the actual numbers/review text given',
          proposedReplyText: 'string, complete ready-to-post reply — only for DRAFT_REVIEW_REPLY',
        },
      ],
    },
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const validLocationIds = new Set(locationSignals.map((l) => l.locationId));
  const reviewById = new Map(unansweredReviews.map((r) => [r.businessReviewId, r]));

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

    const result = BusinessInsightsResponseSchema.safeParse(parsed);
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
    // references a location/review we never gave it, or is missing the
    // fields its type requires — rather than trust the model followed
    // instructions, verify it deterministically before this ever reaches an
    // approval screen.
    return result.data.insights.filter((insight) => {
      if (insight.type === 'LOCATION_ANOMALY_ALERT') {
        return !!insight.locationId && validLocationIds.has(insight.locationId);
      }
      if (insight.type === 'DRAFT_REVIEW_REPLY') {
        if (!insight.businessReviewId || !insight.proposedReplyText) return false;
        if (!reviewById.has(insight.businessReviewId)) return false;
        if (Buffer.byteLength(insight.proposedReplyText, 'utf8') > 4096) return false;
        return true;
      }
      return false;
    });
  }

  throw new Error('AI business insight generation failed validation after 2 attempts');
}
