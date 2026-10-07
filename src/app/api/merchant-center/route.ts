import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/crypto';
import { fetchMerchantReport } from '@/lib/merchantCenter';

export const maxDuration = 120;

// GET /api/merchant-center?clientId=xxx&days=30
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 7), 90);
  const acct = await db.merchantCenterAccount.findFirst({ where: { clientId } });
  if (!acct) return NextResponse.json({ error: 'Merchant Center is not connected' }, { status: 404 });
  try {
    return NextResponse.json(await fetchMerchantReport(acct.merchantId, decryptToken(acct.refreshTokenEncrypted), days));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
