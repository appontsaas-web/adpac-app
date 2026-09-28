import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { getGoogleBusinessAuthUrl } from '@/lib/googleBusinessProfile';

// GET /api/google-business/connect?clientId=xxx
// Unlike GA4/GTM, no account/property ID needs to be entered up front —
// Business Profile accounts are discoverable via the Account Management API
// once authorized (see listAccounts in lib/googleBusinessProfile.ts), so the
// callback picks the account itself. Requires EDIT client access + the
// businessProfile capability, same gate as connecting Google Ads or GTM.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'businessProfile'))) {
    return NextResponse.json({ error: 'Business Profile access required for this client' }, { status: 403 });
  }

  const state = JSON.stringify({ clientId });
  const url = getGoogleBusinessAuthUrl(state);
  return NextResponse.redirect(url);
}
