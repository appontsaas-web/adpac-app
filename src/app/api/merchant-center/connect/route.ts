import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { getMerchantCenterAuthUrl } from '@/lib/merchantCenter';

// GET /api/merchant-center/connect?clientId=xxx&merchantId=123456789
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get('clientId');
  const merchantId = (req.nextUrl.searchParams.get('merchantId') ?? '').trim();
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewReporting(me, clientId))) return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  if (!/^\d{4,15}$/.test(merchantId)) return NextResponse.json({ error: 'merchantId must be digits only' }, { status: 400 });
  return NextResponse.redirect(getMerchantCenterAuthUrl(JSON.stringify({ clientId, merchantId })));
}
