import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { generateCampaignDraft } from '@/lib/ai';

// POST /api/campaigns/create-draft
// Body: { clientId, googleAdsAccountId }
// Reads the client's own profile (set when they were onboarded — see the
// intake wizard on the marketing site) and turns it into an AI-drafted
// Search campaign. Nothing is created on Google Ads yet — this only writes
// a DRAFT campaign row plus a PENDING_APPROVAL action log entry. A human
// must approve it via /api/campaigns/[id]/approve before it goes live.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { clientId, googleAdsAccountId } = await req.json();
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'campaigns'))) {
    return NextResponse.json({ error: 'Campaign management access required for this client' }, { status: 403 });
  }

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  if (!client.monthlyBudget) {
    return NextResponse.json({ error: 'Client has no monthlyBudget set — cannot size a campaign.' }, { status: 400 });
  }

  try {
    const draft = await generateCampaignDraft({
      businessName: client.name,
      website: client.website ?? undefined,
      industry: client.industry ?? undefined,
      monthlyBudgetCents: client.monthlyBudget,
      goal: client.primaryGoal ?? 'Generate leads',
      adLanguage: client.adLanguage ?? undefined,
      targetLocations: client.targetLocations ?? undefined,
    });

    const campaign = await db.campaign.create({
      data: {
        clientId,
        googleAdsAccountId: googleAdsAccountId ?? null,
        name: draft.name,
        type: 'SEARCH',
        status: 'DRAFT',
        dailyBudgetCents: draft.dailyBudgetCents,
        aiBriefJson: JSON.stringify(draft),
      },
    });

    await db.actionLog.create({
      data: {
        clientId,
        campaignId: campaign.id,
        actionType: 'CREATE_CAMPAIGN',
        payloadJson: JSON.stringify(draft),
        status: 'PENDING_APPROVAL',
        proposedBy: 'ai',
      },
    });

    return NextResponse.json({ campaign, draft });
  } catch (err: any) {
    console.error('create-draft failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
