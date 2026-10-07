import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { getSearchConsoleAuthUrl } from '@/lib/searchConsole';

// GET /api/search-console/connect?clientId=xxx&siteUrl=https://example.com/
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get('clientId');
  const siteUrl = (req.nextUrl.searchParams.get('siteUrl') ?? '').trim();
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  if (!/^(https?:\/\/.+|sc-domain:.+)$/.test(siteUrl) || siteUrl.length > 300) {
    return NextResponse.json({ error: 'siteUrl must look like "https://example.com/" or "sc-domain:example.com"' }, { status: 400 });
  }
  return NextResponse.redirect(getSearchConsoleAuthUrl(JSON.stringify({ clientId, siteUrl })));
}
