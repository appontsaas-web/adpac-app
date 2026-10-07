import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = (await req.formData()).get('clientId');
  if (!clientId || typeof clientId !== 'string') return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  await db.merchantCenterAccount.deleteMany({ where: { clientId } });
  return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}`), { status: 303 });
}
