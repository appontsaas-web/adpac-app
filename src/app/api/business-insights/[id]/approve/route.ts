import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { postReviewReply } from '@/lib/googleBusinessProfile';
import { decryptToken } from '@/lib/crypto';
import { BusinessInsight } from '@/lib/businessInsights';

const BUSINESS_INSIGHT_TYPES = ['LOCATION_ANOMALY_ALERT', 'DRAFT_REVIEW_REPLY'];

// POST /api/business-insights/[id]/approve
// The one place an AI-drafted review reply actually posts to Google.
// LOCATION_ANOMALY_ALERT never calls Google at all — approving one just
// acknowledges it, since there's nothing to execute for a "heads up" alert.
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

  const insight = JSON.parse(actionLog.payloadJson) as BusinessInsight;

  // LOCATION_ANOMALY_ALERT is informational only — nothing to execute.
  if (insight.type === 'LOCATION_ANOMALY_ALERT') {
    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() },
    });
    return NextResponse.json({ actionLog: updated });
  }

  if (!actionLog.businessReviewId || !insight.proposedReplyText) {
    return NextResponse.json({ error: 'This insight has no associated review or reply text' }, { status: 400 });
  }

  const review = await db.businessReview.findUnique({
    where: { id: actionLog.businessReviewId },
    include: { location: { include: { account: true } } },
  });
  if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

  try {
    const refreshToken = decryptToken(review.location.account.refreshTokenEncrypted);
    await postReviewReply(review.gbpReviewName, refreshToken, insight.proposedReplyText);

    await db.businessReview.update({
      where: { id: review.id },
      data: { replyComment: insight.proposedReplyText, replyState: 'POSTED', replyUpdateTime: new Date() },
    });

    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'EXECUTED', approvedByUserId: me.id, executedAt: new Date() },
    });
    return NextResponse.json({ actionLog: updated });
  } catch (err: any) {
    console.error('Business insight approve failed:', err.message);
    await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    await db.businessReview.update({ where: { id: review.id }, data: { replyState: 'FAILED' } }).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
