import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { computeBusinessSignals, generateBusinessInsights } from '@/lib/businessInsights';
import { getMonthlyGoalContext } from '@/lib/monthlyGoal';

// POST /api/business-insights/generate  { clientId }
// Runs the deterministic location-metric/unanswered-review computation,
// hands it to Claude, and writes each returned insight as a
// PENDING_APPROVAL ActionLog row (locationId or businessReviewId set,
// campaignId left null) — nothing is posted to Google here. Two ways to
// call this, same pattern as /api/ai-insights/generate:
//   1. A signed-in operator — needs the businessProfile capability (which
//      itself requires EDIT client access — see hasCapability).
//   2. A scheduler with no session — protect it with SYNC_SECRET:
//      x-sync-secret header, scans every client with a connected GBP account.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!(await hasCapability(me, clientId, 'businessProfile'))) {
      return NextResponse.json({ error: 'Business Profile access required for this client' }, { status: 403 });
    }
  }

  const clientIds = clientId
    ? [clientId]
    : (
        await db.client.findMany({
          where: { businessProfileAccounts: { some: {} } },
          select: { id: true },
        })
      ).map((c) => c.id);

  let created = 0;
  const errors: string[] = [];

  for (const id of clientIds) {
    try {
      const { locationSignals, unansweredReviews, pastDecisions } = await computeBusinessSignals(id);
      if (locationSignals.length === 0 && unansweredReviews.length === 0) continue;

      const monthlyGoal = await getMonthlyGoalContext(id);
      const insights = await generateBusinessInsights(locationSignals, unansweredReviews, pastDecisions, monthlyGoal);
      for (const insight of insights) {
        await db.actionLog.create({
          data: {
            clientId: id,
            locationId: insight.locationId ?? null,
            businessReviewId: insight.businessReviewId ?? null,
            actionType: insight.type,
            payloadJson: JSON.stringify(insight),
            status: 'PENDING_APPROVAL',
            proposedBy: 'ai',
          },
        });
        // Mark the review as having a draft awaiting a human so the next
        // generate run doesn't propose a second draft for the same review
        // (see UNANSWERED_STATES in lib/businessInsights.ts).
        if (insight.type === 'DRAFT_REVIEW_REPLY' && insight.businessReviewId) {
          await db.businessReview.update({
            where: { id: insight.businessReviewId },
            data: { replyState: 'PENDING_APPROVAL' },
          });
        }
        created++;
      }
    } catch (err: any) {
      errors.push(`${id}: ${err.message}`);
    }
  }

  return NextResponse.json({ created, errors });
}
