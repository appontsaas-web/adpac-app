import { NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { resetFreeAnalysisConnection } from '@/lib/freeAnalysis';
import { db } from '@/lib/db';

// POST /api/portal/analysis/reset — disconnect the current ad account so the
// prospect can connect a different one (any platform) before a report exists.
export async function POST() {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true } });
  if (!c?.isFreeAnalysis) return NextResponse.json({ error: 'Not available' }, { status: 403 });
  const r = await resetFreeAnalysisConnection(client.id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
