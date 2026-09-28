import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { computeMetaSignals, generateMetaInsights } from '@/lib/metaInsights';
import { getMonthlyGoalContext } from '@/lib/monthlyGoal';

// POST /api/meta-insights/generate  { clientId }
// Runs the deterministic campaign-metric computation, hands it to Claude,
// and writes each returned insight as a PENDING_APPROVAL ActionLog row
// (metaCampaignId set, campaignId left null) — nothing is executed here.
// Two ways to call this, same pattern as /api/ai-insights/generate and
// /api/business-insights/generate:
//   1. A signed-in operator — needs the meta capability (which itself
//      requires EDIT client access — see hasCapability).
//   2. A scheduler with no session — protect it with SYNC_SECRET:
//      x-sync-secret header, scans every client with a connected Meta ad account.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!(await hasCapability(me, clientId, 'meta'))) {
      return NextResponse.json({ error: 'Meta Ads access required for this client' }, { status: 403 });
    }
  }

  const clientIds = clientId
    ? [clientId]
    : (
        await db.client.findMany({
          where: { metaAdAccounts: { some: {} } },
          select: { id: true },
        })
      ).map((c) => c.id);

  let created = 0;
  const errors: string[] = [];

  for (const id of clientIds) {
    try {
      const { campaignSignals, pastDecisions } = await computeMetaSignals(id);
      if (campaignSignals.length === 0) continue;

      const monthlyGoal = await getMonthlyGoalContext(id);
      const insights = await generateMetaInsights(campaignSignals, pastDecisions, monthlyGoal);
      for (const insight of insights) {
        await db.actionLog.create({
          data: {
            clientId: id,
            metaCampaignId: insight.campaignId,
            actionType: insight.type,
            payloadJson: JSON.stringify(insight),
            status: 'PENDING_APPROVAL',
            proposedBy: 'ai',
          },
        });
        created++;
      }
    } catch (err: any) {
      errors.push(`${id}: ${err.message}`);
    }
  }

  return NextResponse.json({ created, errors });
}
