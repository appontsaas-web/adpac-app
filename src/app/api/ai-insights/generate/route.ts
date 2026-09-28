import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';
import { computeSignals, generateInsights } from '@/lib/aiInsights';
import { getMonthlyGoalContext } from '@/lib/monthlyGoal';

// POST /api/ai-insights/generate  { clientId }
// Runs the deterministic pacing/anomaly computation, hands it to Claude, and
// writes each returned insight as a PENDING_APPROVAL ActionLog row — nothing
// is executed on Google Ads here. Two ways to call this, same pattern as
// /api/metrics/sync:
//   1. A signed-in operator clicking "Run AI review" — needs campaigns
//      capability (EDIT access), same as any other campaign-affecting action.
//   2. A scheduler with no session — protect it with SYNC_SECRET:
//      x-sync-secret header, scans every client with a LIVE campaign.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    // EDIT-level client access is enough — unlike direct campaign edits, this
    // isn't gated behind a specific Position capability (see approve/dismiss
    // routes for the same choice).
    if (!canEdit(await getClientAccess(me, clientId))) {
      return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
    }
  }

  const clientIds = clientId
    ? [clientId]
    : (
        await db.client.findMany({
          where: { campaigns: { some: { status: 'LIVE' } } },
          select: { id: true },
        })
      ).map((c) => c.id);

  let created = 0;
  const errors: string[] = [];

  for (const id of clientIds) {
    try {
      const { campaignSignals, pacing, ga4Signal, ga4Error, pastDecisions } = await computeSignals(id);
      if (campaignSignals.length === 0) continue;
      // GA4 being unreachable shouldn't block the review — just surface it
      // as a non-fatal note alongside whatever insights still come back.
      if (ga4Error) errors.push(`${id}: GA4 context unavailable — ${ga4Error}`);

      const monthlyGoal = await getMonthlyGoalContext(id);
      const insights = await generateInsights(campaignSignals, pacing, ga4Signal, pastDecisions, monthlyGoal);
      const signalByCampaignId = new Map(campaignSignals.map((s) => [s.campaignId, s]));
      for (const insight of insights) {
        // Snapshot the deterministic last7d-vs-prior14d numbers this insight
        // was actually based on, alongside the AI's write-up — lets the
        // approval UI show a real before/after chart instead of just text,
        // and keeps a permanent record of what the recommendation was
        // reacting to even after the live numbers have since moved on.
        const signal = signalByCampaignId.get(insight.campaignId);
        const payload = {
          ...insight,
          ...(signal && {
            signalSnapshot: {
              last7dAvgDailyCostCents: signal.last7d.avgDailyCostCents,
              prior14dAvgDailyCostCents: signal.prior14d.avgDailyCostCents,
              last7dAvgDailyConversions: signal.last7d.avgDailyConversions,
              prior14dAvgDailyConversions: signal.prior14d.avgDailyConversions,
              last7dCtr: signal.last7d.ctr,
              prior14dCtr: signal.prior14d.ctr,
            },
          }),
        };
        await db.actionLog.create({
          data: {
            clientId: id,
            campaignId: insight.campaignId,
            actionType: insight.type,
            payloadJson: JSON.stringify(payload),
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
