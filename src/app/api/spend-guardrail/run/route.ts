import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { runSpendGuardrailForAllClients, checkSpendGuardrail } from '@/lib/spendGuardrail';

// POST /api/spend-guardrail/run[?clientId=xxx]
// Runs the hard spend-ceiling check (see lib/spendGuardrail.ts) — either for
// every client with a monthly budget, or just one. Same two-caller pattern as
// /api/metrics/sync: an unattended scheduler (SYNC_SECRET header) or a
// signed-in admin.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const clientId = req.nextUrl.searchParams.get('clientId');

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (me.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
  }

  try {
    const results = clientId
      ? [await checkSpendGuardrail(clientId)].filter((r): r is NonNullable<typeof r> => r !== null)
      : await runSpendGuardrailForAllClients();
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
