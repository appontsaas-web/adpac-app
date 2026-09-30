import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, getAdvertiserInfo } from '@/lib/tiktok';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';
import { PENDING_TIKTOK_CONNECT_COOKIE } from './pendingConnectCookie';

// GET /api/tiktok/callback?auth_code=...&state=<JSON: {clientId}>
// Same "exactly one match connects immediately, more than one goes through
// a cookie-backed picker" flow as /api/snapchat/callback/route.ts — see
// that file's comment for the full rationale. TikTok's token-exchange
// response already lists every advertiser_id the authorizing Business
// Center login can access, so this skips straight to enriching those IDs
// with display info (getAdvertiserInfo) rather than needing a separate
// "list what this login can see" call the way Snapchat's callback does.
//
// TikTok's redirect uses `auth_code` as the query param name (not the more
// common `code`) — confirmed against the live docs before writing this.
export async function GET(req: NextRequest) {
  const authCode = req.nextUrl.searchParams.get('auth_code');
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
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?tiktok=denied&tab=tiktok`));
  }
  if (!authCode || !clientId) {
    return NextResponse.json({ error: 'Missing auth_code or state (clientId)' }, { status: 400 });
  }

  try {
    const { refreshToken, accessToken, advertiserIds } = await exchangeCodeForTokens(authCode);
    const accountsRaw = await getAdvertiserInfo(advertiserIds, accessToken);
    if (accountsRaw.length === 0) {
      throw new Error(
        'No TikTok advertiser accounts found for this login. Make sure the client has added your ' +
          'TikTok Business Center account to their advertiser account first.'
      );
    }

    if (accountsRaw.length === 1) {
      const account = accountsRaw[0];
      await db.tikTokAdAccount.create({
        data: {
          clientId,
          advertiserId: account.id,
          refreshTokenEncrypted: encryptToken(refreshToken),
          currencyCode: account.currency ?? null,
          timezone: account.timezone ?? null,
          status: 'connected',
        },
      });
      return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?tiktok=connected&tab=tiktok`));
    }

    const res = NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?tiktok=choose&tab=tiktok`));
    res.cookies.set(
      PENDING_TIKTOK_CONNECT_COOKIE,
      JSON.stringify({
        clientId,
        refreshTokenEncrypted: encryptToken(refreshToken),
        accounts: accountsRaw.map((a) => ({ id: a.id, name: a.name, currency: a.currency, timezone: a.timezone })),
      }),
      { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 }
    );
    return res;
  } catch (err: any) {
    console.error('TikTok OAuth callback failed:', err.message);
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?tiktok=error&tab=tiktok&message=${encodeURIComponent(err.message)}`)
    );
  }
}
