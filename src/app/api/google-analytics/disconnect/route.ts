import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/google-analytics/disconnect  { clientId }
// Only forgets the local link — doesn't touch anything on the Google side.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  if (!(await canViewReporting(me, clientId))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  await db.googleAnalyticsProperty.deleteMany({ where: { clientId } });

  return NextResponse.redirect(new URL(`/dashboard/clients/${clientId}`, req.url), { status: 303 });
}
