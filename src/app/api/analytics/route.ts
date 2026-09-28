import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import { runGA4Report } from '@/lib/googleAnalytics';
import { decryptToken } from '@/lib/crypto';

// GET /api/analytics?clientId=xxx&days=30
// GET /api/analytics?clientId=xxx&since=2026-06-01&until=2026-06-30
// Runs a live GA4 Data API report for a client's connected property — no
// local caching/sync table, unlike /api/metrics (see lib/googleAnalytics.ts
// for why). Same days/since/until options so date ranges can stay in sync
// with the Google Ads reporting dashboard.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await canViewReporting(me, clientId))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  const property = await db.googleAnalyticsProperty.findFirst({ where: { clientId } });
  if (!property) return NextResponse.json({ error: 'No GA4 property connected for this client' }, { status: 404 });

  const sinceParam = req.nextUrl.searchParams.get('since');
  const untilParam = req.nextUrl.searchParams.get('until');
  let since: string;
  let until: string;
  if (sinceParam && untilParam) {
    since = sinceParam;
    until = untilParam;
  } else {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
    const untilDate = new Date();
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    since = sinceDate.toISOString().slice(0, 10);
    until = untilDate.toISOString().slice(0, 10);
  }

  try {
    const refreshToken = decryptToken(property.refreshTokenEncrypted);
    const report = await runGA4Report(property.ga4PropertyId, refreshToken, since, until);
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: `GA4 report failed: ${err.message}` }, { status: 502 });
  }
}
