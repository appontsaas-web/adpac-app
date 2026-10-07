import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, verifySiteAccess } from '@/lib/searchConsole';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

// GET /api/search-console/callback?code=...&state=<JSON: {clientId, siteUrl}>
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  let clientId: string | undefined;
  let siteUrl: string | undefined;
  try {
    if (stateRaw) {
      const p = JSON.parse(stateRaw);
      clientId = p.clientId;
      siteUrl = p.siteUrl;
    }
  } catch {}

  if (req.nextUrl.searchParams.get('error')) return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?searchConsole=denied`));
  if (!code || !clientId || !siteUrl) return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token!;
    await verifySiteAccess(siteUrl, refreshToken);
    await db.searchConsoleSite.create({ data: { clientId, siteUrl, refreshTokenEncrypted: encryptToken(refreshToken), status: 'connected' } });
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?searchConsole=connected`));
  } catch (err: any) {
    console.error('Search Console OAuth callback failed:', err.message);
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?searchConsole=error&message=${encodeURIComponent(err.message)}`));
  }
}
