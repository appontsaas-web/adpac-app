import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { setCampaignStatus, updateCampaignDailyBudget, exchangeForLongLivedToken } from '@/lib/meta';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { MetaInsight } from '@/lib/metaInsights';

const META_INSIGHT_TYPES = ['META_ADJUST_BUDGET', 'META_PAUSE_CAMPAIGN', 'META_ANOMALY_ALERT'];

// POST /api/meta-insights/[id]/approve
// The one place an approved Meta insight actually calls the Meta API.
// META_ANOMALY_ALERT never calls Meta at all — approving one just
// acknowledges it, since there's nothing to execute for a "heads up" alert.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
  if (!META_INSIGHT_TYPES.includes(actionLog.actionType)) {
    return NextResponse.json({ error: 'This action log entry is not a Meta insight' }, { status: 400 });
  }

  if (!(await hasCapability(me, actionLog.clientId, 'meta'))) {
    return NextResponse.json({ error: 'Meta Ads access required for this client' }, { status: 403 });
  }

  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Insight is already ${actionLog.status}` }, { status: 400 });
  }

  const insight = JSON.parse(actionLog.payloadJson) as MetaInsight;

  // META_ANOMALY_ALERT is informational only — nothing to execute.
  if (insight.type === 'META_ANOMALY_ALERT') {
    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() },
    });
    return NextResponse.json({ actionLog: updated });
  }

  if (!actionLog.metaCampaignId) {
    return NextResponse.json({ error: 'This insight has no associated Meta campaign' }, { status: 400 });
  }

  const campaign = await db.metaCampaign.findUnique({
    where: { id: actionLog.metaCampaignId },
    include: { adAccount: true },
  });
  if (!campaign) return NextResponse.json({ error: 'Meta campaign not found' }, { status: 404 });

  try {
    // Same re-exchange-on-use pattern as the sync route — the stored token
    // may be close to expiry, and every use is a cheap opportunity to keep
    // it fresh rather than waiting for the next scheduled sync.
    const storedToken = decryptToken(campaign.adAccount.accessTokenEncrypted);
    const { accessToken, expiresAt } = await exchangeForLongLivedToken(storedToken);
    await db.metaAdAccount.update({
      where: { id: campaign.adAccount.id },
      data: { accessTokenEncrypted: encryptToken(accessToken), tokenExpiresAt: expiresAt },
    });

    if (insight.type === 'META_ADJUST_BUDGET') {
      if (!insight.proposedDailyBudgetCents) {
        return NextResponse.json({ error: 'This insight has no proposed budget' }, { status: 400 });
      }
      await updateCampaignDailyBudget(campaign.metaCampaignId, accessToken, insight.proposedDailyBudgetCents);
      await db.metaCampaign.update({
        where: { id: campaign.id },
        data: { dailyBudgetCents: insight.proposedDailyBudgetCents },
      });
    } else if (insight.type === 'META_PAUSE_CAMPAIGN') {
      await setCampaignStatus(campaign.metaCampaignId, accessToken, 'PAUSED');
      await db.metaCampaign.update({ where: { id: campaign.id }, data: { status: 'PAUSED' } });
    }

    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() },
    });
    return NextResponse.json({ actionLog: updated });
  } catch (err: any) {
    console.error('Meta insight approve failed:', err.message);
    await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
