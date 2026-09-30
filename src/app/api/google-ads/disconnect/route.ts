import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/google-ads/disconnect  { clientId }
// Removes a client's linked Google Ads account so it can be reconnected
// (e.g. with a corrected Customer ID). Does not touch anything on the
// Google Ads side — this only forgets the local link.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // The form that posts here is a plain HTML form (application/x-www-form-urlencoded),
  // not JSON, so we read it with formData() rather than req.json().
  const formData = await req.formData();
  const clientId = formData.get('clientId');
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'googleAds'))) {
    return NextResponse.json({ error: 'Google Ads management access required for this client' }, { status: 403 });
  }

  await db.googleAdsAccount.deleteMany({ where: { clientId } });

  return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}`), { status: 303 });
}
