import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';

// POST /api/portal/plans/[id]/reject  { feedback }
// Client requests changes — records their feedback for staff to revise and
// re-send (a new plan generation, not modeled as re-opening this same row).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const plan = await db.marketingPlan.findUnique({ where: { id: params.id } });
  if (!plan || plan.clientId !== client.id) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }
  if (plan.status !== 'PENDING_CLIENT_APPROVAL') {
    return NextResponse.json({ error: `Plan is already ${plan.status}` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const feedback = String(body.feedback ?? '').trim();
  if (!feedback) return NextResponse.json({ error: 'Feedback is required so staff know what to change' }, { status: 400 });

  const updated = await db.marketingPlan.update({
    where: { id: plan.id },
    data: { status: 'CLIENT_REJECTED', clientFeedback: feedback, respondedAt: new Date() },
  });

  return NextResponse.json({ plan: updated });
}
