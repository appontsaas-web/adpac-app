import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';

// POST /api/portal/plans/[id]/approve
// The client's own approval — but does NOT itself touch Google Ads. It
// turns each proposedAction into a normal REWRITE_AD_COPY PENDING_APPROVAL
// ActionLog row, which then shows up in the client's "AI performance
// review" panel for STAFF to approve exactly like any other AI insight (see
// /api/ai-insights/[id]/approve). The client's approval is what unlocks
// staff being able to execute it — a client isn't a platform-technical
// user, so an untouched Google Ads write firing straight off their click
// would be an inconsistent exception to this app's human-approval pattern.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const plan = await db.marketingPlan.findUnique({ where: { id: params.id } });
  if (!plan || plan.clientId !== client.id) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }
  if (plan.status !== 'PENDING_CLIENT_APPROVAL') {
    return NextResponse.json({ error: `Plan is already ${plan.status}` }, { status: 400 });
  }

  const { proposedActions } = JSON.parse(plan.planJson) as {
    proposedActions: {
      campaignId: string;
      personaName: string;
      proposedHeadlines: string[];
      proposedDescriptions: string[];
      rationale: string;
    }[];
  };

  const updated = await db.marketingPlan.update({
    where: { id: plan.id },
    data: { status: 'CLIENT_APPROVED', respondedAt: new Date() },
  });

  for (const action of proposedActions) {
    const campaign = await db.campaign.findUnique({ where: { id: action.campaignId } });
    if (!campaign) continue; // shouldn't happen — sanitized at generation time — but never trust it blindly here either
    await db.actionLog.create({
      data: {
        clientId: plan.clientId,
        campaignId: action.campaignId,
        actionType: 'REWRITE_AD_COPY',
        payloadJson: JSON.stringify({
          type: 'REWRITE_AD_COPY',
          campaignId: action.campaignId,
          summary: `Persona-informed ad copy rewrite — ${action.personaName}`,
          rationale: `${action.rationale} (from the ${plan.periodLabel} plan, approved by the client.)`,
          proposedHeadlines: action.proposedHeadlines,
          proposedDescriptions: action.proposedDescriptions,
        }),
        status: 'PENDING_APPROVAL',
        proposedBy: 'ai',
      },
    });
  }

  return NextResponse.json({ plan: updated, actionsCreated: proposedActions.length });
}
