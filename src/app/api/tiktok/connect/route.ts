import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { getTikTokAuthUrl } from '@/lib/tiktok';

// GET /api/tiktok/connect?clientId=xxx
// No advertiser ID needs to be entered up front — the callback reads every
// advertiser ID TikTok's token-exchange response grants the authorizing
// login (see exchangeCodeForTokens in lib/tiktok.ts) and either connects
// the one match or sends the operator to a picker, same "discover after
// authorizing" pattern as Meta/Google Business Profile/Snapchat. Requires
// EDIT client access + the tiktok capability, same gate as connecting
// Google Ads/Meta/Snapchat.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'tiktok'))) {
    return NextResponse.json({ error: 'TikTok Ads access required for this client' }, { status: 403 });
  }

  const state = JSON.stringify({ clientId });
  const url = getTikTokAuthUrl(state);
  return NextResponse.redirect(url);
}
