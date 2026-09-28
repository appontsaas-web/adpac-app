import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { getGoogleAdsAuthUrl } from '@/lib/googleAds';

// GET /api/google-ads/connect?clientId=xxx&customerId=1234567890
// Redirects the browser to Google's OAuth consent screen (needed to obtain a
// refresh token) and carries the *manually entered* Google Ads Customer ID
// through in `state`. We deliberately do NOT ask Google which accounts are
// accessible and guess — that previously linked the wrong account whenever
// the authorizing Google login had access to more than one Ads account.
// Since AdPac creates client accounts directly inside its own Manager (MCC)
// account, the operator already knows the exact Customer ID to link.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const customerId = req.nextUrl.searchParams.get('customerId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'googleAds'))) {
    return NextResponse.json({ error: 'Google Ads management access required for this client' }, { status: 403 });
  }

  if (!customerId || !/^\d{10}$/.test(customerId)) {
    return NextResponse.json(
      { error: 'customerId is required and must be exactly 10 digits (no dashes)' },
      { status: 400 }
    );
  }

  // `state` round-trips through Google so the callback knows which client
  // and which customer ID this connection belongs to. In production,
  // sign/encrypt this to prevent tampering — kept plain here for readability.
  // Not manually URI-encoded here — googleapis' generateAuthUrl() encodes
  // the state value itself when building the query string.
  const state = JSON.stringify({ clientId, customerId });
  const url = getGoogleAdsAuthUrl(state);
  return NextResponse.redirect(url);
}
