import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/crypto';
import { fetchShopifyReport } from '@/lib/shopify';

export const maxDuration = 120;

// GET /api/shopify?clientId=xxx&days=30 (max 60)
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 7), 60);
  const store = await db.shopifyStore.findFirst({ where: { clientId } });
  if (!store) return NextResponse.json({ error: 'Shopify is not connected' }, { status: 404 });
  try {
    return NextResponse.json(await fetchShopifyReport(store.shop, decryptToken(store.accessTokenEncrypted), days));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
