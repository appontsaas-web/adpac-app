import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { getMetaAuthUrl } from '@/lib/meta';

// GET /api/meta/connect?clientId=xxx
// No ad account ID needs to be entered up front — the callback lists the ad
// accounts the authorizing Meta login can manage (see listAdAccounts in
// lib/meta.ts) and picks the first one, same "discover after authorizing"
// pattern as Google Business Profile. Requires EDIT client access + the
// meta capability, same gate as connecting Google Ads/GTM/Business Profile.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'meta'))) {
    return NextResponse.json({ error: 'Meta Ads access required for this client' }, { status: 403 });
  }

  const state = JSON.stringify({ clientId });
  const url = getMetaAuthUrl(state);
  return NextResponse.redirect(url);
}
