import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, listOrgAdAccounts } from '@/lib/snapchat';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';
import { PENDING_SNAPCHAT_CONNECT_COOKIE } from './pendingConnectCookie';

// GET /api/snapchat/callback?code=...&state=<JSON: {clientId}>
// Same "exactly one match connects immediately, more than one goes through
// a cookie-backed picker" flow as /api/meta/callback/route.ts — see that
// file's comment for the full rationale. Snapchat's login can have access
// to several Organizations, each with several Ad Accounts, so this is at
// least as likely to be ambiguous as Meta's flat ad-account list was.
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
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?snapchat=denied&tab=snapchat`));
  }
  if (!code || !clientId) {
    return NextResponse.json({ error: 'Missing code or state (clientId)' }, { status: 400 });
  }

  try {
    const { refreshToken } = await exchangeCodeForTokens(code);

    const accounts = await listOrgAdAccounts(refreshToken);
    if (accounts.length === 0) {
      throw new Error(
        'No Snapchat ad accounts found for this login. Make sure the client has added your Snapchat ' +
          'account as a member on their Organization in Snap Business Manager first.'
      );
    }

    if (accounts.length === 1) {
      const account = accounts[0];
      await db.snapAdAccount.create({
        data: {
          clientId,
          organizationId: account.organizationId,
          snapAdAccountId: account.id,
          refreshTokenEncrypted: encryptToken(refreshToken),
          currencyCode: account.currency ?? null,
          timezone: account.timezone ?? null,
          status: 'connected',
        },
      });
      return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?snapchat=connected&tab=snapchat`));
    }

    const res = NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?snapchat=choose&tab=snapchat`));
    res.cookies.set(
      PENDING_SNAPCHAT_CONNECT_COOKIE,
      JSON.stringify({
        clientId,
        refreshTokenEncrypted: encryptToken(refreshToken),
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          organizationId: a.organizationId,
          organizationName: a.organizationName,
          currency: a.currency,
          timezone: a.timezone,
        })),
      }),
      { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 }
    );
    return res;
  } catch (err: any) {
    console.error('Snapchat OAuth callback failed:', err.message);
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?snapchat=error&tab=snapchat&message=${encodeURIComponent(err.message)}`)
    );
  }
}
