import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPortalClient, currentPeriodKey } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';

// POST /api/portal/monthly-input  { goalText, targetAudienceText, budgetNotes?, competitorNotes?, additionalNotes? }
// Upserts the CURRENT calendar month's MonthlyInput for the signed-in
// portal client — this is the form /portal forces before showing anything
// else. Re-submitting the same month overwrites it (a client updating their
// answer mid-month is expected, not an error).
export async function POST(req: NextRequest) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const goalText = String(body.goalText ?? '').trim();
  const targetAudienceText = String(body.targetAudienceText ?? '').trim();
  if (!goalText || !targetAudienceText) {
    return NextResponse.json({ error: 'goalText and targetAudienceText are required' }, { status: 400 });
  }

  const periodKey = currentPeriodKey();
  const input = await db.monthlyInput.upsert({
    where: { clientId_periodKey: { clientId: client.id, periodKey } },
    create: {
      clientId: client.id,
      periodKey,
      goalText,
      targetAudienceText,
      budgetNotes: body.budgetNotes || null,
      competitorNotes: body.competitorNotes || null,
      additionalNotes: body.additionalNotes || null,
    },
    update: {
      goalText,
      targetAudienceText,
      budgetNotes: body.budgetNotes || null,
      competitorNotes: body.competitorNotes || null,
      additionalNotes: body.additionalNotes || null,
      submittedAt: new Date(),
    },
  });

  return NextResponse.json({ input });
}
