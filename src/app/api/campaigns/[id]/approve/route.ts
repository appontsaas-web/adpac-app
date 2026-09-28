import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { createSearchCampaign, CampaignDraft } from '@/lib/googleAds';
import { decryptToken } from '@/lib/crypto';

// POST /api/campaigns/[id]/approve
// The one place in this app where an AI-proposed change actually touches a
// real Google Ads account. Requires a signed-in AdPac user — this is the
// human-approval gate the rest of the system is built around.
//
// The campaign is created on Google Ads in a PAUSED state (see
// lib/googleAds.ts) — you still choose when to actually turn spend on.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const campaign = await db.campaign.findUnique({
    where: { id: params.id },
    include: { googleAdsAccount: true },
  });
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  if (!(await hasCapability(me, campaign.clientId, 'campaigns'))) {
    return NextResponse.json({ error: 'Campaign management access required for this client' }, { status: 403 });
  }

  if (campaign.status !== 'DRAFT' && campaign.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Campaign is already ${campaign.status}` }, { status: 400 });
  }
  if (!campaign.googleAdsAccount) {
    return NextResponse.json({ error: 'Campaign has no connected Google Ads account' }, { status: 400 });
  }

  const draft = JSON.parse(campaign.aiBriefJson) as {
    keywords: string[];
    headlines: string[];
    descriptions: string[];
    targetLocations?: string[];
  };

  const clientRecord = await db.client.findUnique({ where: { id: campaign.clientId } });

  const campaignDraft: CampaignDraft = {
    name: campaign.name,
    dailyBudgetCents: campaign.dailyBudgetCents,
    finalUrl: clientRecord?.website ? normalizeUrl(clientRecord.website) : 'https://example.com',
    keywords: draft.keywords,
    headlines: draft.headlines,
    descriptions: draft.descriptions,
    locations: draft.targetLocations,
  };

  try {
    const refreshToken = decryptToken(campaign.googleAdsAccount.refreshTokenEncrypted);
    const result = await createSearchCampaign(
      campaign.googleAdsAccount.googleCustomerId,
      refreshToken,
      campaignDraft
    );

    // Pull the real campaign resource name back out of the mutate response
    const campaignResult = result.mutateOperationResponses?.find((r: any) => r.campaignResult)?.campaignResult;
    const googleCampaignId = campaignResult?.resourceName?.split('/')?.pop() ?? null;

    const updated = await db.campaign.update({
      where: { id: campaign.id },
      data: { status: 'LIVE', googleCampaignId },
    });

    await db.actionLog.updateMany({
      where: { campaignId: campaign.id, actionType: 'CREATE_CAMPAIGN', status: 'PENDING_APPROVAL' },
      data: {
        status: 'EXECUTED',
        approvedByUserId: me.id,
        executedAt: new Date(),
      },
    });

    return NextResponse.json({ campaign: updated, googleResult: result });
  } catch (err: any) {
    console.error('approve failed:', err.message);
    await db.actionLog.updateMany({
      where: { campaignId: campaign.id, actionType: 'CREATE_CAMPAIGN', status: 'PENDING_APPROVAL' },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function normalizeUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}
