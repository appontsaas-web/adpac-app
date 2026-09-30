import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/google-tag-manager/disconnect  { clientId }
// Only forgets the local link — doesn't touch anything on the Google side or
// remove any tags already published to the client's container.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'tagManager'))) {
    return NextResponse.json({ error: 'Tag Manager access required for this client' }, { status: 403 });
  }

  await db.googleTagManagerContainer.deleteMany({ where: { clientId } });

  return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}`), { status: 303 });
}
