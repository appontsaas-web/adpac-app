import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/marketing-plans?clientId=...
// Lists every MarketingPlan for a client, newest first — for the staff
// review panel on the client page.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!canEdit(await getClientAccess(me, clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  const plans = await db.marketingPlan.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ plans });
}
