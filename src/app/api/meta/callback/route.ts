import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, listAdAccounts } from '@/lib/meta';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';
import { PENDING_META_CONNECT_COOKIE } from './pendingConnectCookie';

// GET /api/meta/callback?code=...&state=<JSON: {clientId}>
// After exchanging the code (already upgraded to a long-lived ~60-day token
// inside exchangeCodeForToken), lists the ad accounts the authorizing Meta
// login can manage — same "operator's own login, added as an admin/
// advertiser on the client's asset" trust model as every other integration
// in this app.
//
// A login often has access to MORE than one ad account (an agency operator
// is commonly an admin/advertiser across several of their own or their
// clients' businesses) — auto-picking the first one, as this used to do, is
// a real footgun: it can silently connect the wrong business's ad account
// to a client with no error at all (only a telltale sign of zero campaigns
// ever syncing). So: exactly one ad account connects immediately (no
// ambiguity to resolve); more than one stores the token + account list in a
// short-lived httpOnly cookie and redirects to the client page with
// ?meta=choose, where the operator picks the right one (see
// /api/meta/connect/finish, which reads this same cookie).
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  let clientId: string | undefined;
  try {
    if (stateRaw) {
      const parsed = JSON.parse(stateRaw);
      clientId = parsed.clientId;
    }
  } catch {
    // fall through to the missing-fields check below
  }

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/clients/${clientId}?meta=denied&tab=meta`, req.url));
  }
  if (!code || !clientId) {
    return NextResponse.json({ error: 'Missing code or state (clientId)' }, { status: 400 });
  }

  try {
    const { accessToken, expiresAt } = await exchangeCodeForToken(code);

    const adAccounts = await listAdAccounts(accessToken);
    if (adAccounts.length === 0) {
      throw new Error(
        'No Meta ad accounts found for this login. Make sure the client has added your Meta ' +
          'account as an admin/advertiser on their ad account (Business Settings > Ad Accounts) first.'
      );
    }

    if (adAccounts.length === 1) {
      const account = adAccounts[0];
      await db.metaAdAccount.create({
        data: {
          clientId,
          metaAdAccountId: account.id,
          accessTokenEncrypted: encryptToken(accessToken),
          tokenExpiresAt: expiresAt,
          currencyCode: account.currency ?? null,
          status: 'connected',
        },
      });
      return NextResponse.redirect(new URL(`/dashboard/clients/${clientId}?meta=connected&tab=meta`, req.url));
    }

    // Multiple ad accounts — stash everything needed to finish connecting
    // (already-encrypted token, so the cookie never holds it in plaintext)
    // and send the operator to the picker instead of guessing.
    const res = NextResponse.redirect(new URL(`/dashboard/clients/${clientId}?meta=choose&tab=meta`, req.url));
    res.cookies.set(PENDING_META_CONNECT_COOKIE, JSON.stringify({
      clientId,
      accessTokenEncrypted: encryptToken(accessToken),
      tokenExpiresAt: expiresAt ? expiresAt.toISOString() : null,
      accounts: adAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // 10 minutes — plenty to pick from a short list, short enough not to linger
    });
    return res;
  } catch (err: any) {
    console.error('Meta OAuth callback failed:', err.message);
    return NextResponse.redirect(
      new URL(`/dashboard/clients/${clientId}?meta=error&tab=meta&message=${encodeURIComponent(err.message)}`, req.url)
    );
  }
}
