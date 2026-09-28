import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// PATCH /api/clients/[id]
// Body: any subset of { name, website, industry, monthlyBudget, primaryGoal, adLanguage, targetLocations, spendGuardrailEnabled }
// Used to edit an existing client — e.g. setting ad language/target locations
// on a client that was created before those fields existed. Only TargetingForm
// calls this today for the general fields, gated behind the "targeting"
// capability. spendGuardrailEnabled is a financial safety toggle (see
// lib/spendGuardrail.ts) and is checked separately, admin-only, regardless of
// targeting capability — a staff member who can edit targeting shouldn't
// thereby be able to disable the client's spend ceiling.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const wantsGuardrailChange = body.spendGuardrailEnabled !== undefined;
  const wantsOtherFields = Object.keys(body).some((k) => k !== 'spendGuardrailEnabled');

  if (wantsGuardrailChange && me.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required to change the spend guardrail' }, { status: 403 });
  }
  if (wantsOtherFields && !(await hasCapability(me, params.id, 'targeting'))) {
    return NextResponse.json({ error: 'Targeting management access required for this client' }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.website !== undefined) data.website = body.website || null;
  if (body.industry !== undefined) data.industry = body.industry || null;
  if (body.monthlyBudget !== undefined) {
    data.monthlyBudget = body.monthlyBudget ? Math.round(Number(body.monthlyBudget) * 100) : null;
  }
  if (body.primaryGoal !== undefined) data.primaryGoal = body.primaryGoal || null;
  if (body.adLanguage !== undefined) data.adLanguage = body.adLanguage || null;
  if (body.targetLocations !== undefined) data.targetLocations = body.targetLocations || null;
  if (body.spendGuardrailEnabled !== undefined) data.spendGuardrailEnabled = !!body.spendGuardrailEnabled;

  try {
    const client = await db.client.update({ where: { id: params.id }, data });
    return NextResponse.json({ client });
  } catch (err: any) {
    console.error('PATCH /api/clients/[id] failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
