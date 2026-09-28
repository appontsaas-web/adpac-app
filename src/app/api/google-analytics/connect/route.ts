import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { getGoogleAnalyticsAuthUrl } from '@/lib/googleAnalytics';

// GET /api/google-analytics/connect?clientId=xxx&propertyId=123456789
// Same shape as /api/google-ads/connect: the operator enters the GA4
// property ID the client gave them (found in GA4 Admin > Property Settings),
// we do NOT try to discover it from OAuth and guess — the authorizing login
// may have access to many properties across many clients.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const propertyId = req.nextUrl.searchParams.get('propertyId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await canViewReporting(me, clientId))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  if (!propertyId || !/^\d+$/.test(propertyId)) {
    return NextResponse.json({ error: 'propertyId is required and must be numeric digits only' }, { status: 400 });
  }

  const state = JSON.stringify({ clientId, propertyId });
  const url = getGoogleAnalyticsAuthUrl(state);
  return NextResponse.redirect(url);
}
