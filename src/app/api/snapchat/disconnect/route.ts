import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/snapchat/disconnect  { clientId }
// Only forgets the local link (ad account, its campaigns, their daily
// metrics) — doesn't touch anything on the Snapchat side.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'snapchat'))) {
    return NextResponse.json({ error: 'Snapchat Ads access required for this client' }, { status: 403 });
  }

  const accounts = await db.snapAdAccount.findMany({ where: { clientId } });
  for (const account of accounts) {
    const campaigns = await db.snapCampaign.findMany({ where: { adAccountId: account.id }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    if (campaignIds.length) {
      // ActionLog rows are the audit trail — never deleted. Null out their
      // snapCampaign pointer first so the FK constraint doesn't block
      // deleting the campaigns/metrics below.
      await db.actionLog.updateMany({ where: { snapCampaignId: { in: campaignIds } }, data: { snapCampaignId: null } });
      await db.snapDailyMetric.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await db.snapCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    }
  }
  await db.snapAdAccount.deleteMany({ where: { clientId } });

  return NextResponse.redirect(new URL(`/dashboard/clients/${clientId}?tab=snapchat`, req.url), { status: 303 });
}
