import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { PENDING_SNAPCHAT_CONNECT_COOKIE, PendingSnapchatConnect } from '../../callback/pendingConnectCookie';

// POST /api/snapchat/connect/finish  { clientId, snapAdAccountId }
// Completes a connect that /api/snapchat/callback deferred to the picker
// because the login had access to more than one ad account — same shape as
// /api/meta/connect/finish/route.ts.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  const snapAdAccountId = formData.get('snapAdAccountId');
  if (!clientId || typeof clientId !== 'string' || !snapAdAccountId || typeof snapAdAccountId !== 'string') {
    return NextResponse.json({ error: 'clientId and snapAdAccountId are required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'snapchat'))) {
    return NextResponse.json({ error: 'Snapchat Ads access required for this client' }, { status: 403 });
  }

  const cookieVal = req.cookies.get(PENDING_SNAPCHAT_CONNECT_COOKIE)?.value;
  if (!cookieVal) {
    return NextResponse.redirect(
      new URL(`/dashboard/clients/${clientId}?snapchat=error&tab=snapchat&message=${encodeURIComponent('Your selection expired — please reconnect.')}`, req.url),
      { status: 303 }
    );
  }

  let pending: PendingSnapchatConnect;
  try {
    pending = JSON.parse(cookieVal);
  } catch {
    return NextResponse.redirect(
      new URL(`/dashboard/clients/${clientId}?snapchat=error&tab=snapchat&message=${encodeURIComponent('Something went wrong — please reconnect.')}`, req.url),
      { status: 303 }
    );
  }
  if (pending.clientId !== clientId) {
    return NextResponse.json({ error: 'clientId mismatch' }, { status: 400 });
  }
  const chosen = pending.accounts.find((a) => a.id === snapAdAccountId);
  if (!chosen) {
    return NextResponse.json({ error: 'Selected ad account was not in the original list' }, { status: 400 });
  }

  await db.snapAdAccount.create({
    data: {
      clientId,
      organizationId: chosen.organizationId,
      snapAdAccountId: chosen.id,
      refreshTokenEncrypted: pending.refreshTokenEncrypted,
      currencyCode: chosen.currency ?? null,
      timezone: chosen.timezone ?? null,
      status: 'connected',
    },
  });

  const res = NextResponse.redirect(new URL(`/dashboard/clients/${clientId}?snapchat=connected&tab=snapchat`, req.url), { status: 303 });
  res.cookies.delete(PENDING_SNAPCHAT_CONNECT_COOKIE);
  return res;
}
