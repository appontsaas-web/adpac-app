import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/tiktok/disconnect  { clientId }
// Only forgets the local link (ad account, its campaigns, their daily
// metrics) — doesn't touch anything on the TikTok side.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'tiktok'))) {
    return NextResponse.json({ error: 'TikTok Ads access required for this client' }, { status: 403 });
  }

  const accounts = await db.tikTokAdAccount.findMany({ where: { clientId } });
  for (const account of accounts) {
    const campaigns = await db.tikTokCampaign.findMany({ where: { adAccountId: account.id }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    if (campaignIds.length) {
      // ActionLog rows are the audit trail — never deleted. Null out their
      // tiktokCampaign pointer first so the FK constraint doesn't block
      // deleting the campaigns/metrics below.
      await db.actionLog.updateMany({ where: { tiktokCampaignId: { in: campaignIds } }, data: { tiktokCampaignId: null } });
      await db.tikTokDailyMetric.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await db.tikTokCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    }
  }
  await db.tikTokAdAccount.deleteMany({ where: { clientId } });

  return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?tab=tiktok`), { status: 303 });
}
