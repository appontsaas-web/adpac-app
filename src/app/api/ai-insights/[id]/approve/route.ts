import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';
import {
  setCampaignStatus,
  updateCampaignBudget,
  updateResponsiveSearchAd,
  addNegativeKeywords,
  setDeviceBidModifier,
  setHourBidModifier,
} from '@/lib/googleAds';
import { decryptToken } from '@/lib/crypto';
import { Insight } from '@/lib/aiInsights';

const AI_INSIGHT_TYPES = [
  'ADJUST_BUDGET',
  'PAUSE_CAMPAIGN',
  'REWRITE_AD_COPY',
  'ANOMALY_ALERT',
  'ADD_NEGATIVE_KEYWORDS',
  'REALLOCATE_BUDGET',
  'ADJUST_BID_MODIFIER',
  'FUNNEL_OPTIMIZATION',
];

// POST /api/ai-insights/[id]/approve
// The one place an AI-proposed insight actually touches a real Google Ads
// account. ANOMALY_ALERT never calls Google Ads at all — approving one just
// acknowledges it, since there's nothing to execute for a "heads up" alert.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
  if (!AI_INSIGHT_TYPES.includes(actionLog.actionType)) {
    return NextResponse.json({ error: 'This action log entry is not an AI insight' }, { status: 400 });
  }

  // EDIT-level client access is enough to approve — not gated behind the
  // specific 'campaigns' Position capability (see generate/dismiss routes
  // for the same choice, and page.tsx for the matching UI gate).
  if (!canEdit(await getClientAccess(me, actionLog.clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Insight is already ${actionLog.status}` }, { status: 400 });
  }

  const rawPayload = JSON.parse(actionLog.payloadJson) as { type: string };

  // ANOMALY_ALERT and FUNNEL_OPTIMIZATION are informational only — nothing
  // to execute on Google Ads (a funnel finding is landing-page/on-site work,
  // not a campaign change AdPac can make on the client's behalf). Checked
  // against the raw payload (not the stricter Insight type below) since
  // FUNNEL_OPTIMIZATION comes from lib/funnelInsights.ts's own schema, not
  // aiInsights.ts's InsightSchema.
  if (rawPayload.type === 'ANOMALY_ALERT' || rawPayload.type === 'FUNNEL_OPTIMIZATION') {
    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() },
    });
    return NextResponse.json({ actionLog: updated });
  }

  const insight = rawPayload as Insight;

  if (!actionLog.campaignId) {
    return NextResponse.json({ error: 'This insight has no associated campaign' }, { status: 400 });
  }

  const campaign = await db.campaign.findUnique({
    where: { id: actionLog.campaignId },
    include: { googleAdsAccount: true },
  });
  if (!campaign?.googleAdsAccount || !campaign.googleCampaignId) {
    return NextResponse.json({ error: 'Campaign has no connected, live Google Ads campaign' }, { status: 400 });
  }

  try {
    const refreshToken = decryptToken(campaign.googleAdsAccount.refreshTokenEncrypted);
    const customerId = campaign.googleAdsAccount.googleCustomerId;

    if (insight.type === 'PAUSE_CAMPAIGN') {
      await setCampaignStatus(customerId, refreshToken, campaign.googleCampaignId, 'PAUSED');
      await db.campaign.update({ where: { id: campaign.id }, data: { status: 'PAUSED' } });
    } else if (insight.type === 'ADJUST_BUDGET') {
      if (!insight.proposedDailyBudgetCents) throw new Error('Insight has no proposedDailyBudgetCents');
      await updateCampaignBudget(customerId, refreshToken, campaign.googleCampaignId, insight.proposedDailyBudgetCents);
      await db.campaign.update({ where: { id: campaign.id }, data: { dailyBudgetCents: insight.proposedDailyBudgetCents } });
    } else if (insight.type === 'REWRITE_AD_COPY') {
      if (!insight.proposedHeadlines || !insight.proposedDescriptions) {
        throw new Error('Insight is missing proposed headlines/descriptions');
      }
      await updateResponsiveSearchAd(
        customerId,
        refreshToken,
        campaign.googleCampaignId,
        insight.proposedHeadlines,
        insight.proposedDescriptions
      );
    } else if (insight.type === 'ADD_NEGATIVE_KEYWORDS') {
      if (!insight.proposedNegativeKeywords?.length) throw new Error('Insight has no proposedNegativeKeywords');
      await addNegativeKeywords(customerId, refreshToken, campaign.googleCampaignId, insight.proposedNegativeKeywords);
    } else if (insight.type === 'REALLOCATE_BUDGET') {
      if (!insight.reallocateFromCampaignId || !insight.reallocateAmountCents) {
        throw new Error('Insight is missing reallocateFromCampaignId/reallocateAmountCents');
      }
      const fromCampaign = await db.campaign.findUnique({
        where: { id: insight.reallocateFromCampaignId },
        include: { googleAdsAccount: true },
      });
      if (!fromCampaign?.googleAdsAccount || !fromCampaign.googleCampaignId) {
        throw new Error('The campaign losing budget has no connected, live Google Ads campaign');
      }
      // Both campaigns must live under the same Google Ads account — should
      // always be true in practice (campaignSignals only ever includes one
      // client's campaigns, and a client typically has one connected
      // account), but verified rather than assumed before touching two
      // budgets with one refresh token.
      if (fromCampaign.googleAdsAccountId !== campaign.googleAdsAccountId) {
        throw new Error("Reallocation campaigns aren't on the same Google Ads account");
      }
      const amount = insight.reallocateAmountCents;
      const newFromBudget = fromCampaign.dailyBudgetCents - amount;
      const newToBudget = campaign.dailyBudgetCents + amount;
      if (newFromBudget <= 0) throw new Error("Reallocation would zero out the source campaign's budget");

      // Decrease the source campaign first — if the increase then fails,
      // the account is at worst under-spending (safe direction), never
      // double-spending both budgets.
      await updateCampaignBudget(customerId, refreshToken, fromCampaign.googleCampaignId, newFromBudget);
      await db.campaign.update({ where: { id: fromCampaign.id }, data: { dailyBudgetCents: newFromBudget } });
      await updateCampaignBudget(customerId, refreshToken, campaign.googleCampaignId, newToBudget);
      await db.campaign.update({ where: { id: campaign.id }, data: { dailyBudgetCents: newToBudget } });
    } else if (insight.type === 'ADJUST_BID_MODIFIER') {
      if (!insight.bidModifierCriterionType || !insight.bidModifierValue || insight.proposedBidModifier === undefined) {
        throw new Error('Insight is missing bidModifierCriterionType/bidModifierValue/proposedBidModifier');
      }
      if (insight.bidModifierCriterionType === 'DEVICE') {
        await setDeviceBidModifier(
          customerId,
          refreshToken,
          campaign.googleCampaignId,
          insight.bidModifierValue,
          insight.proposedBidModifier
        );
      } else {
        const hour = Number(insight.bidModifierValue);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Invalid hour value: ${insight.bidModifierValue}`);
        await setHourBidModifier(customerId, refreshToken, campaign.googleCampaignId, hour, insight.proposedBidModifier);
      }
    }

    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() },
    });
    return NextResponse.json({ actionLog: updated });
  } catch (err: any) {
    console.error('AI insight approve failed:', err.message);
    await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
