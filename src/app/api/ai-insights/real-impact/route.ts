import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { computeRealImpact } from '@/lib/realImpact';

// GET /api/ai-insights/real-impact?clientId=xxx
// The real-measured counterpart to /api/ai-insights/impact — see
// lib/realImpact.ts for the full methodology. Same auth as the placeholder
// route (EDIT access to the client). Read-only: nothing here writes to the
// token ledger or any other billing figure — this is purely a second,
// separately-computed view for comparing against the existing Impact card.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!canEdit(await getClientAccess(me, clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  try {
    const result = await computeRealImpact(clientId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
