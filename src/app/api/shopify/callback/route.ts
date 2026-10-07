import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { exchangeCodeForToken, normalizeShop, verifyCallbackHmac, verifyShopAccess, verifyState } from '@/lib/shopify';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

// GET /api/shopify/callback?code&hmac&shop&state&timestamp
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const state = verifyState(params.get('state'));
  const back = (qs: string) => absoluteUrl(`/dashboard/clients/${state?.clientId ?? ''}?${qs}`);

  if (!state || !verifyCallbackHmac(params) || normalizeShop(params.get('shop') ?? '') !== state.shop) {
    return NextResponse.json({ error: 'Invalid Shopify callback' }, { status: 400 });
  }
  const me = await getCurrentUser();
  if (!me || !(await canViewReporting(me, state.clientId))) return NextResponse.json({ error: 'Not authorised' }, { status: 403 });

  const code = params.get('code');
  if (!code) return NextResponse.redirect(back('shopify=denied'));
  try {
    const { accessToken, scope } = await exchangeCodeForToken(state.shop, code);
    await verifyShopAccess(state.shop, accessToken);
    await db.shopifyStore.create({ data: { clientId: state.clientId, shop: state.shop, accessTokenEncrypted: encryptToken(accessToken), scope, status: 'connected' } });
    return NextResponse.redirect(back('shopify=connected'));
  } catch (err: any) {
    console.error('Shopify callback failed:', err.message);
    return NextResponse.redirect(back(`shopify=error&message=${encodeURIComponent(err.message)}`));
  }
}
