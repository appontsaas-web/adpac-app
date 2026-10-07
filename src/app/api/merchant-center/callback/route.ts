import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, verifyMerchantAccess } from '@/lib/merchantCenter';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  let clientId: string | undefined;
  let merchantId: string | undefined;
  try {
    const p = JSON.parse(req.nextUrl.searchParams.get('state') ?? '{}');
    clientId = p.clientId;
    merchantId = p.merchantId;
  } catch {}
  if (req.nextUrl.searchParams.get('error')) return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?merchant=denied`));
  if (!code || !clientId || !merchantId) return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  try {
    const refreshToken = (await exchangeCodeForTokens(code)).refresh_token!;
    await verifyMerchantAccess(merchantId, refreshToken);
    await db.merchantCenterAccount.create({ data: { clientId, merchantId, refreshTokenEncrypted: encryptToken(refreshToken), status: 'connected' } });
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?merchant=connected`));
  } catch (err: any) {
    console.error('Merchant Center callback failed:', err.message);
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?merchant=error&message=${encodeURIComponent(err.message)}`));
  }
}
