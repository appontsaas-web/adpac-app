import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/creative-tests/winners/[id]/dismiss
// Rejects a called winner without pausing anything — e.g. you disagree with
// the significance call, or want to let the test keep running longer.
// Sets the test back to RUNNING (not re-alerted again until the numbers
// materially change, since aggregateVariantStats/evaluateTest are always
// computed fresh — a dismissed call with the same stats would just fail
// significance again next cycle anyway... except a still-clear winner would
// immediately re-fire. To actually respect "no, stop testing this", archive
// the test instead of leaving it RUNNING.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });
  if (actionLog.actionType !== 'AB_TEST_WINNER') {
    return NextResponse.json({ error: 'This action log entry is not a Creative A/B Test winner' }, { status: 400 });
  }
  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Already ${actionLog.status}` }, { status: 400 });
  }

  const capability = actionLog.campaignId ? 'campaigns' : 'meta';
  if (!(await hasCapability(me, actionLog.clientId, capability))) {
    return NextResponse.json({ error: `${capability === 'campaigns' ? 'Campaign management' : 'Meta Ads'} access required for this client` }, { status: 403 });
  }

  const updated = await db.actionLog.update({
    where: { id: actionLog.id },
    data: { status: 'REJECTED', approvedByUserId: me.id },
  });
  if (actionLog.creativeTestId) {
    await db.creativeTest.update({ where: { id: actionLog.creativeTestId }, data: { status: 'ARCHIVED', endedAt: new Date() } });
  }
  return NextResponse.json({ actionLog: updated });
}
