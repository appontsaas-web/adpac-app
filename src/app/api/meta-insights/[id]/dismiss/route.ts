import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

const META_INSIGHT_TYPES = ['META_ADJUST_BUDGET', 'META_PAUSE_CAMPAIGN', 'META_ANOMALY_ALERT'];

// POST /api/meta-insights/[id]/dismiss
// Rejects a Meta insight without executing it.
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

  const updated = await db.actionLog.update({
    where: { id: actionLog.id },
    data: { status: 'REJECTED', approvedByUserId: me.id },
  });

  return NextResponse.json({ actionLog: updated });
}
