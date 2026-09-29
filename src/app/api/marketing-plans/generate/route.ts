import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';
import { generatePersonaPlan } from '@/lib/personaBuilder';

// POST /api/marketing-plans/generate  { clientId, periodType, periodLabel }
// Staff-triggered (EDIT access) — builds personas/ad copy/plan from the
// client's latest MonthlyInput + real audience demographic data, and saves
// it as a DRAFT MarketingPlan for staff to review before sending to the
// client. See lib/personaBuilder.ts.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  const periodType = body.periodType === 'QUARTERLY' ? 'QUARTERLY' : 'MONTHLY';
  const periodLabel = String(body.periodLabel ?? '').trim();
  if (!clientId || !periodLabel) {
    return NextResponse.json({ error: 'clientId and periodLabel are required' }, { status: 400 });
  }
  if (!canEdit(await getClientAccess(me, clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  try {
    const outcome = await generatePersonaPlan(clientId);
    if ('error' in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: 400 });
    }

    const plan = await db.marketingPlan.create({
      data: {
        clientId,
        periodType,
        periodLabel,
        monthlyInputId: outcome.monthlyInputId,
        status: 'DRAFT',
        personasJson: JSON.stringify(outcome.result.personas),
        adCopyJson: JSON.stringify(outcome.result.adCopy),
        planJson: JSON.stringify({
          objectives: outcome.result.objectives,
          narrative: outcome.result.narrative,
          proposedActions: outcome.result.proposedActions,
        }),
        createdByUserId: me.id,
      },
    });

    return NextResponse.json({ plan });
  } catch (err: any) {
    console.error('Marketing plan generation failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
