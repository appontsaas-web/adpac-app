import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { PENDING_TIKTOK_CONNECT_COOKIE, PendingTikTokConnect } from '../../callback/pendingConnectCookie';

// POST /api/tiktok/connect/finish  { clientId, advertiserId }
// Completes a connect that /api/tiktok/callback deferred to the picker
// because the login had access to more than one advertiser account — same
// shape as /api/snapchat/connect/finish/route.ts.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  const advertiserId = formData.get('advertiserId');
  if (!clientId || typeof clientId !== 'string' || !advertiserId || typeof advertiserId !== 'string') {
    return NextResponse.json({ error: 'clientId and advertiserId are required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'tiktok'))) {
    return NextResponse.json({ error: 'TikTok Ads access required for this client' }, { status: 403 });
  }

  const cookieVal = req.cookies.get(PENDING_TIKTOK_CONNECT_COOKIE)?.value;
  if (!cookieVal) {
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?tiktok=error&tab=tiktok&message=${encodeURIComponent('Your selection expired — please reconnect.')}`),
      { status: 303 }
    );
  }

  let pending: PendingTikTokConnect;
  try {
    pending = JSON.parse(cookieVal);
  } catch {
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?tiktok=error&tab=tiktok&message=${encodeURIComponent('Something went wrong — please reconnect.')}`),
      { status: 303 }
    );
  }
  if (pending.clientId !== clientId) {
    return NextResponse.json({ error: 'clientId mismatch' }, { status: 400 });
  }
  const chosen = pending.accounts.find((a) => a.id === advertiserId);
  if (!chosen) {
    return NextResponse.json({ error: 'Selected advertiser account was not in the original list' }, { status: 400 });
  }

  await db.tikTokAdAccount.create({
    data: {
      clientId,
      advertiserId: chosen.id,
      refreshTokenEncrypted: pending.refreshTokenEncrypted,
      currencyCode: chosen.currency ?? null,
      timezone: chosen.timezone ?? null,
      status: 'connected',
    },
  });

  const res = NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?tiktok=connected&tab=tiktok`), { status: 303 });
  res.cookies.delete(PENDING_TIKTOK_CONNECT_COOKIE);
  return res;
}
