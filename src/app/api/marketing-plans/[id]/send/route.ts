import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';
import { sendPortalLoginLink } from '@/lib/clientPortalAuth';

// POST /api/marketing-plans/[id]/send
// Marks a DRAFT plan PENDING_CLIENT_APPROVAL and emails the client a portal
// sign-in link (same magic-link flow as any other portal login) so they
// know to go review it. Requires the client to have a portalContactEmail
// set — see /api/clients/[id] PATCH.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const plan = await db.marketingPlan.findUnique({ where: { id: params.id } });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (!canEdit(await getClientAccess(me, plan.clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }
  if (plan.status !== 'DRAFT') {
    return NextResponse.json({ error: `Plan is already ${plan.status}` }, { status: 400 });
  }

  const client = await db.client.findUnique({ where: { id: plan.clientId } });
  if (!client?.portalContactEmail) {
    return NextResponse.json({ error: 'This client has no portal contact email set — add one first.' }, { status: 400 });
  }

  const updated = await db.marketingPlan.update({
    where: { id: plan.id },
    data: { status: 'PENDING_CLIENT_APPROVAL', sentToClientAt: new Date() },
  });

  try {
    await sendPortalLoginLink(plan.clientId);
  } catch (err: any) {
    console.error('Plan-ready portal email failed:', err.message);
    // Plan is still marked sent — staff can resend the login link separately if needed.
  }

  return NextResponse.json({ plan: updated });
}
