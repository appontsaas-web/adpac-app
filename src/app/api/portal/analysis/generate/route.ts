import { NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { getAnalysis, runFreeAnalysis } from '@/lib/freeAnalysis';
import { db } from '@/lib/db';
import { getLocale } from '@/lib/i18n/server';

export const maxDuration = 300;

// POST /api/portal/analysis/generate — syncs the connected account and builds
// the one-time 48h report. Idempotent: if one already exists/generating, no-op.
export async function POST() {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true } });
  if (!c?.isFreeAnalysis) return NextResponse.json({ error: 'Not available' }, { status: 403 });

  const existing = await getAnalysis(client.id);
  if (existing && (existing.status === 'READY' || existing.status === 'EXPIRED' || existing.status === 'GENERATING')) {
    return NextResponse.json({ ok: true, status: existing.status });
  }
  try {
    await runFreeAnalysis(client.id, getLocale() === 'ar' ? 'ar' : 'en');
    return NextResponse.json({ ok: true, status: 'READY' });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
