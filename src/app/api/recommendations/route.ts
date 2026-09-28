import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { fetchRecommendations } from '@/lib/googleAds';
import { decryptToken } from '@/lib/crypto';

// GET /api/recommendations?googleAdsAccountId=xxx
// Surfaces Google's own AI-generated optimization suggestions for the
// account — the fastest, most defensible "AI optimization" feature to ship
// in phase 1, since Google already built and validated the underlying model.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const googleAdsAccountId = req.nextUrl.searchParams.get('googleAdsAccountId');
  if (!googleAdsAccountId) {
    return NextResponse.json({ error: 'googleAdsAccountId is required' }, { status: 400 });
  }

  const account = await db.googleAdsAccount.findUnique({ where: { id: googleAdsAccountId } });
  if (!account) return NextResponse.json({ error: 'Google Ads account not found' }, { status: 404 });

  if (!(await hasCapability(me, account.clientId, 'targeting'))) {
    return NextResponse.json({ error: 'Targeting management access required for this client' }, { status: 403 });
  }

  try {
    const refreshToken = decryptToken(account.refreshTokenEncrypted);
    const recommendations = await fetchRecommendations(account.googleCustomerId, refreshToken);
    return NextResponse.json({ recommendations });
  } catch (err: any) {
    console.error('fetchRecommendations failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
