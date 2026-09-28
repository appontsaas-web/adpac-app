import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// PUT /api/ai-insights/impact/override
// Body: { clientId, monthKey, optimizationRatePercent }
// Admin-only: sets (or replaces) the "AI optimization impact" rate for one
// client+month, overriding the deterministic placeholder calculation in
// GET /api/ai-insights/impact. See that route and the AiImpactOverride
// schema comment for context — this is what lets an admin type in a
// specific number instead of the auto-generated placeholder.
export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { clientId, monthKey, optimizationRatePercent } = await req.json();
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return NextResponse.json({ error: 'monthKey must be in YYYY-MM format' }, { status: 400 });
  }
  const rate = Number(optimizationRatePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return NextResponse.json({ error: 'optimizationRatePercent must be a number between 0 and 100' }, { status: 400 });
  }

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  try {
    const override = await db.aiImpactOverride.upsert({
      where: { clientId_monthKey: { clientId, monthKey } },
      create: { clientId, monthKey, optimizationRatePercent: rate, setByUserId: me.id },
      update: { optimizationRatePercent: rate, setByUserId: me.id },
    });
    return NextResponse.json({ override });
  } catch (err: any) {
    console.error('PUT /api/ai-insights/impact/override failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/ai-insights/impact/override?clientId=xxx&monthKey=2026-07
// Admin-only: clears the override, reverting that month back to the
// placeholder calculation.
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const monthKey = req.nextUrl.searchParams.get('monthKey');
  if (!clientId || !monthKey) {
    return NextResponse.json({ error: 'clientId and monthKey are required' }, { status: 400 });
  }

  await db.aiImpactOverride.deleteMany({ where: { clientId, monthKey } });
  return NextResponse.json({ ok: true });
}
