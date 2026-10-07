import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { getShopifyAuthUrl, normalizeShop, signState } from '@/lib/shopify';

// GET /api/shopify/connect?clientId=xxx&shop=my-store.myshopify.com
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get('clientId');
  const shop = normalizeShop(req.nextUrl.searchParams.get('shop') ?? '');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  if (!shop) return NextResponse.json({ error: 'Enter the store as my-store.myshopify.com' }, { status: 400 });
  return NextResponse.redirect(getShopifyAuthUrl(shop, signState(clientId, shop)));
}
