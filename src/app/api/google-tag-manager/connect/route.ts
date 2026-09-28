import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { getGoogleTagManagerAuthUrl } from '@/lib/googleTagManager';

// GET /api/google-tag-manager/connect?clientId=xxx&accountId=xxx&containerId=xxx
// Same shape as /api/google-ads/connect — operator enters the GTM
// account/container IDs the client gave them rather than us guessing from
// OAuth (the authorizing login may have access to many containers).
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const accountId = req.nextUrl.searchParams.get('accountId');
  const containerId = req.nextUrl.searchParams.get('containerId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'tagManager'))) {
    return NextResponse.json({ error: 'Tag Manager access required for this client' }, { status: 403 });
  }

  if (!accountId || !/^\d+$/.test(accountId) || !containerId || !/^\d+$/.test(containerId)) {
    return NextResponse.json(
      { error: 'accountId and containerId are required and must be numeric digits only' },
      { status: 400 }
    );
  }

  const state = JSON.stringify({ clientId, accountId, containerId });
  const url = getGoogleTagManagerAuthUrl(state);
  return NextResponse.redirect(url);
}
