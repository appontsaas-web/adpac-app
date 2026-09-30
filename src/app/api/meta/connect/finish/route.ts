import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { PENDING_META_CONNECT_COOKIE, PendingMetaConnect } from '../../callback/pendingConnectCookie';

// POST /api/meta/connect/finish  (form body: clientId, metaAdAccountId)
// Completes a connect flow that had more than one ad account to choose
// from (see /api/meta/callback) — reads the pending token + account list
// back out of the short-lived cookie set there, validates the chosen
// account is actually one that was offered, and creates the MetaAdAccount
// row for it. The cookie is single-use: cleared here whether this succeeds
// or the picker page is simply abandoned (a stale token sitting in a
// cookie past its own 10-minute expiry is harmless, but no reason to keep
// it around once used).
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  const metaAdAccountId = formData.get('metaAdAccountId');
  if (!clientId || typeof clientId !== 'string' || !metaAdAccountId || typeof metaAdAccountId !== 'string') {
    return NextResponse.json({ error: 'clientId and metaAdAccountId are required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'meta'))) {
    return NextResponse.json({ error: 'Meta Ads access required for this client' }, { status: 403 });
  }

  const raw = req.cookies.get(PENDING_META_CONNECT_COOKIE)?.value;
  if (!raw) {
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?meta=error&tab=meta&message=${encodeURIComponent('Your ad account selection expired — reconnect to try again.')}`)
    );
  }

  let pending: PendingMetaConnect;
  try {
    pending = JSON.parse(raw);
  } catch {
    const res = NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?meta=error&tab=meta&message=${encodeURIComponent('Your ad account selection was invalid — reconnect to try again.')}`)
    );
    res.cookies.delete(PENDING_META_CONNECT_COOKIE);
    return res;
  }

  if (pending.clientId !== clientId) {
    const res = NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?meta=error&tab=meta&message=${encodeURIComponent('That selection was for a different client — reconnect to try again.')}`)
    );
    res.cookies.delete(PENDING_META_CONNECT_COOKIE);
    return res;
  }

  const chosen = pending.accounts.find((a) => a.id === metaAdAccountId);
  if (!chosen) {
    return NextResponse.json({ error: 'That ad account was not one of the accounts offered' }, { status: 400 });
  }

  await db.metaAdAccount.create({
    data: {
      clientId,
      metaAdAccountId: chosen.id,
      accessTokenEncrypted: pending.accessTokenEncrypted,
      tokenExpiresAt: pending.tokenExpiresAt ? new Date(pending.tokenExpiresAt) : null,
      currencyCode: chosen.currency ?? null,
      status: 'connected',
    },
  });

  const res = NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?meta=connected&tab=meta`), { status: 303 });
  res.cookies.delete(PENDING_META_CONNECT_COOKIE);
  return res;
}
