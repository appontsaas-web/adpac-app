import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { applyRecommendation } from '@/lib/googleAds';
import { decryptToken } from '@/lib/crypto';

// POST /api/recommendations/apply
// Body: { clientId, googleAdsAccountId, resourceName, summary }
// Applying a recommendation is a real write to the client's Google Ads
// account, so this only runs from an authenticated, human-driven click in
// the dashboard — it is itself the approval step, and it's logged either way.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { clientId, googleAdsAccountId, resourceName, summary } = await req.json();
  if (!clientId || !googleAdsAccountId || !resourceName) {
    return NextResponse.json({ error: 'clientId, googleAdsAccountId, and resourceName are required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'targeting'))) {
    return NextResponse.json({ error: 'Targeting management access required for this client' }, { status: 403 });
  }

  const account = await db.googleAdsAccount.findUnique({ where: { id: googleAdsAccountId } });
  if (!account) return NextResponse.json({ error: 'Google Ads account not found' }, { status: 404 });

  const log = await db.actionLog.create({
    data: {
      clientId,
      actionType: 'APPLY_GOOGLE_RECOMMENDATION',
      payloadJson: JSON.stringify({ resourceName, summary }),
      status: 'PENDING_APPROVAL',
      proposedBy: 'ai',
    },
  });

  try {
    const refreshToken = decryptToken(account.refreshTokenEncrypted);
    const result = await applyRecommendation(account.googleCustomerId, refreshToken, resourceName);

    await db.actionLog.update({
      where: { id: log.id },
      data: {
        status: 'EXECUTED',
        approvedByUserId: me.id,
        executedAt: new Date(),
      },
    });

    return NextResponse.json({ result });
  } catch (err: any) {
    console.error('applyRecommendation failed:', err.message);
    await db.actionLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: err.message } });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
