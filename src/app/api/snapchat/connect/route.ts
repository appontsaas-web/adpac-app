import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { getSnapchatAuthUrl } from '@/lib/snapchat';

// GET /api/snapchat/connect?clientId=xxx
// No ad account ID needs to be entered up front — the callback lists every
// Organization + Ad Account the authorizing Snapchat login can manage (see
// listOrgAdAccounts in lib/snapchat.ts) and either connects the one match or
// sends the operator to a picker, same "discover after authorizing" pattern
// as Meta/Google Business Profile. Requires EDIT client access + the
// snapchat capability, same gate as connecting Google Ads/Meta/GTM.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'snapchat'))) {
    return NextResponse.json({ error: 'Snapchat Ads access required for this client' }, { status: 403 });
  }

  const state = JSON.stringify({ clientId });
  const url = getSnapchatAuthUrl(state);
  return NextResponse.redirect(url);
}
