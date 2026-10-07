import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/crypto';
import { fetchSearchConsoleReport } from '@/lib/searchConsole';

// GET /api/search-console?clientId=xxx&days=28
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 28), 7), 90);

  const site = await db.searchConsoleSite.findFirst({ where: { clientId } });
  if (!site) return NextResponse.json({ error: 'Search Console is not connected' }, { status: 404 });
  try {
    return NextResponse.json(await fetchSearchConsoleReport(site.siteUrl, decryptToken(site.refreshTokenEncrypted), days));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
