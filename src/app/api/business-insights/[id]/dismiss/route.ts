import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { BusinessInsight } from '@/lib/businessInsights';

const BUSINESS_INSIGHT_TYPES = ['LOCATION_ANOMALY_ALERT', 'DRAFT_REVIEW_REPLY'];

// POST /api/business-insights/[id]/dismiss
// Rejects a business insight without executing it — for a drafted reply you
// disagree with, or a location alert you don't need to act on.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
  if (!BUSINESS_INSIGHT_TYPES.includes(actionLog.actionType)) {
    return NextResponse.json({ error: 'This action log entry is not a business insight' }, { status: 400 });
  }

  if (!(await hasCapability(me, actionLog.clientId, 'businessProfile'))) {
    return NextResponse.json({ error: 'Business Profile access required for this client' }, { status: 403 });
  }

  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Insight is already ${actionLog.status}` }, { status: 400 });
  }

  const updated = await db.actionLog.update({
    where: { id: actionLog.id },
    data: { status: 'REJECTED', approvedByUserId: me.id },
  });

  if (actionLog.businessReviewId) {
    const insight = JSON.parse(actionLog.payloadJson) as BusinessInsight;
    if (insight.type === 'DRAFT_REVIEW_REPLY') {
      await db.businessReview.update({ where: { id: actionLog.businessReviewId }, data: { replyState: 'REJECTED' } });
    }
  }

  return NextResponse.json({ actionLog: updated });
}
