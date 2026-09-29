import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { generateFunnelInsight, generateFunnelInsights } from '@/lib/funnelInsights';
import { db } from '@/lib/db';

// POST /api/funnel-insights/generate  { clientId? }
// Two ways to call this, same pattern as /api/ai-insights/generate and
// /api/creative-tests/evaluate:
//   1. A scheduler (cron) with no session — protect it with SYNC_SECRET,
//      runs the funnel review for every client with a connected GA4
//      property.
//   2. A signed-in operator clicking "Run funnel review" for one client —
//      needs EDIT access to that client.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;

  if (secretOk) {
    try {
      const result = await generateFunnelInsights();
      return NextResponse.json(result);
    } catch (err: any) {
      console.error('Funnel insight generation failed:', err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!canEdit(await getClientAccess(me, clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  try {
    const insight = await generateFunnelInsight(clientId);
    if (!insight) return NextResponse.json({ created: 0 });
    await db.actionLog.create({
      data: {
        clientId,
        actionType: 'FUNNEL_OPTIMIZATION',
        payloadJson: JSON.stringify({ type: 'FUNNEL_OPTIMIZATION', ...insight }),
        status: 'PENDING_APPROVAL',
        proposedBy: 'ai',
      },
    });
    return NextResponse.json({ created: 1 });
  } catch (err: any) {
    console.error('Funnel insight generation failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
