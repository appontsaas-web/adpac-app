import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';

const AI_INSIGHT_TYPES = ['ADJUST_BUDGET', 'PAUSE_CAMPAIGN', 'REWRITE_AD_COPY', 'ANOMALY_ALERT', 'ADD_NEGATIVE_KEYWORDS', 'REALLOCATE_BUDGET', 'ADJUST_BID_MODIFIER'];

// POST /api/ai-insights/[id]/dismiss
// Rejects an AI insight without executing it — for a recommendation you
// disagree with, or an anomaly alert you don't need to act on.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
  if (!AI_INSIGHT_TYPES.includes(actionLog.actionType)) {
    return NextResponse.json({ error: 'This action log entry is not an AI insight' }, { status: 400 });
  }

  // EDIT-level client access is enough — see approve/generate routes for the
  // same choice.
  if (!canEdit(await getClientAccess(me, actionLog.clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Insight is already ${actionLog.status}` }, { status: 400 });
  }

  const updated = await db.actionLog.update({
    where: { id: actionLog.id },
    data: { status: 'REJECTED', approvedByUserId: me.id },
  });
  return NextResponse.json({ actionLog: updated });
}
