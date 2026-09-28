import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { setAdStatus as setGoogleAdStatus } from '@/lib/googleAds';
import { setAdStatus as setMetaAdStatus, exchangeForLongLivedToken } from '@/lib/meta';
import { AbTestWinnerPayload } from '@/lib/creativeTests';

// POST /api/creative-tests/winners/[id]/approve  ([id] = the ActionLog id,
// same convention as /api/ai-insights/[id]/approve and
// /api/meta-insights/[id]/approve)
//
// The one place an approved Creative A/B Test winner actually touches a
// real Google Ads or Meta account — pauses every losing variant, leaves the
// winner running untouched. Which platform to call is read off which of
// actionLog.campaignId / actionLog.metaCampaignId is set (see ActionLog's
// schema comment — a creative-test row still sets exactly one of those,
// alongside creativeTestId).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
  if (actionLog.actionType !== 'AB_TEST_WINNER') {
    return NextResponse.json({ error: 'This action log entry is not a Creative A/B Test winner' }, { status: 400 });
  }
  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Already ${actionLog.status}` }, { status: 400 });
  }
  if (!actionLog.creativeTestId) {
    return NextResponse.json({ error: 'This action log entry has no associated creative test' }, { status: 400 });
  }

  const capability = actionLog.campaignId ? 'campaigns' : 'meta';
  if (!(await hasCapability(me, actionLog.clientId, capability))) {
    return NextResponse.json({ error: `${capability === 'campaigns' ? 'Campaign management' : 'Meta Ads'} access required for this client` }, { status: 403 });
  }

  const payload = JSON.parse(actionLog.payloadJson) as AbTestWinnerPayload;
  const test = await db.creativeTest.findUnique({
    where: { id: actionLog.creativeTestId },
    include: { variants: true },
  });
  if (!test) return NextResponse.json({ error: 'Creative test not found' }, { status: 404 });

  const loserVariants = test.variants.filter((v) => payload.loserVariants.some((l) => l.adId === v.adId));

  try {
    if (test.platform === 'GOOGLE_ADS') {
      if (!actionLog.campaignId) throw new Error('This insight has no associated campaign');
      const campaign = await db.campaign.findUnique({ where: { id: actionLog.campaignId }, include: { googleAdsAccount: true } });
      if (!campaign?.googleAdsAccount) throw new Error('Campaign has no connected Google Ads account');
      const refreshToken = decryptToken(campaign.googleAdsAccount.refreshTokenEncrypted);
      const customerId = campaign.googleAdsAccount.googleCustomerId;

      for (const variant of loserVariants) {
        if (!variant.adGroupId) throw new Error(`Variant ${variant.label} is missing its ad group id`);
        await setGoogleAdStatus(customerId, refreshToken, variant.adGroupId, variant.adId, 'PAUSED');
      }
    } else {
      if (!actionLog.metaCampaignId) throw new Error('This insight has no associated Meta campaign');
      const campaign = await db.metaCampaign.findUnique({ where: { id: actionLog.metaCampaignId }, include: { adAccount: true } });
      if (!campaign) throw new Error('Meta campaign not found');
      const storedToken = decryptToken(campaign.adAccount.accessTokenEncrypted);
      const { accessToken, expiresAt } = await exchangeForLongLivedToken(storedToken);
      await db.metaAdAccount.update({
        where: { id: campaign.adAccount.id },
        data: { accessTokenEncrypted: encryptToken(accessToken), tokenExpiresAt: expiresAt },
      });

      for (const variant of loserVariants) {
        await setMetaAdStatus(variant.adId, accessToken, 'PAUSED');
      }
    }

    await db.$transaction([
      ...loserVariants.map((v) => db.creativeTestVariant.update({ where: { id: v.id }, data: { isPaused: true } })),
      db.creativeTestVariant.updateMany({ where: { testId: test.id, adId: payload.winnerAdId }, data: { isWinner: true } }),
      db.creativeTest.update({ where: { id: test.id }, data: { status: 'COMPLETED', endedAt: new Date() } }),
      db.actionLog.update({ where: { id: actionLog.id }, data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() } }),
    ]);

    const updated = await db.actionLog.findUnique({ where: { id: actionLog.id } });
    return NextResponse.json({ actionLog: updated });
  } catch (err: any) {
    console.error('Creative A/B test winner approve failed:', err.message);
    await db.actionLog.update({ where: { id: actionLog.id }, data: { status: 'FAILED', errorMessage: err.message } });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
