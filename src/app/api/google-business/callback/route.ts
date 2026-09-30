import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, listAccounts } from '@/lib/googleBusinessProfile';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

// GET /api/google-business/callback?code=...&state=<JSON: {clientId}>
// After exchanging the code, lists the Business Profile accounts the
// authorizing login can see and stores the first one — same "operator's own
// Google login, invited as a user on the client's asset" trust model as
// GA4/GTM. If the login has access to more than one account (rare — most
// agency logins are invited onto exactly one client's Business Profile),
// only the first is linked; disconnect and reconnect with a different login
// to pick a different account.
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
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?gbp=denied`));
  }
  if (!code || !clientId) {
    return NextResponse.json({ error: 'Missing code or state (clientId)' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token!;

    const accounts = await listAccounts(refreshToken);
    if (accounts.length === 0) {
      throw new Error(
        'No Business Profile accounts found for this Google login. Make sure the client has added ' +
          'your Google account as a Manager or Owner on their Business Profile first.'
      );
    }
    const account = accounts[0];

    await db.googleBusinessProfileAccount.create({
      data: {
        clientId,
        gbpAccountId: account.name,
        refreshTokenEncrypted: encryptToken(refreshToken),
        status: 'connected',
      },
    });

    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?gbp=connected`));
  } catch (err: any) {
    console.error('Google Business Profile OAuth callback failed:', err.message);
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?gbp=error&message=${encodeURIComponent(err.message)}`)
    );
  }
}
