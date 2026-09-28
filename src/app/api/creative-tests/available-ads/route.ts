import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/creative-tests/available-ads?platform=GOOGLE_ADS&campaignId=...
//   or ?platform=META&metaCampaignId=...
// Lists the distinct ads already known from synced AdMetric/MetaAdMetric
// rows for this campaign, each with its most recent name/status and its
// ad group / ad set id — the picker list for starting a new test. No new
// Google Ads/Meta API call — this is just a distinct-by-adId read over data
// already being synced for the reporting dashboard.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform');
  const campaignId = req.nextUrl.searchParams.get('campaignId');
  const metaCampaignId = req.nextUrl.searchParams.get('metaCampaignId');

  if (platform === 'GOOGLE_ADS') {
    if (!campaignId) return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (!canEdit(await getClientAccess(me, campaign.clientId))) {
      return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
    }

    const rows = await db.adMetric.findMany({
      where: { campaignId },
      orderBy: { date: 'desc' },
    });
    const byAdId = new Map<string, { adId: string; adGroupId: string; headline: string; status: string }>();
    for (const r of rows) {
      if (!byAdId.has(r.adId)) {
        byAdId.set(r.adId, { adId: r.adId, adGroupId: r.adGroupId, headline: r.headline, status: r.status });
      }
    }
    return NextResponse.json({ ads: Array.from(byAdId.values()) });
  }

  if (platform === 'META') {
    if (!metaCampaignId) return NextResponse.json({ error: 'metaCampaignId is required' }, { status: 400 });
    const campaign = await db.metaCampaign.findUnique({ where: { id: metaCampaignId }, include: { adAccount: true } });
    if (!campaign) return NextResponse.json({ error: 'Meta campaign not found' }, { status: 404 });
    if (!canEdit(await getClientAccess(me, campaign.adAccount.clientId))) {
      return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
    }

    const rows = await db.metaAdMetric.findMany({
      where: { campaignId: metaCampaignId },
      orderBy: { date: 'desc' },
    });
    const byAdId = new Map<string, { adId: string; adSetId: string; name: string; status: string }>();
    for (const r of rows) {
      if (!byAdId.has(r.adId)) {
        byAdId.set(r.adId, { adId: r.adId, adSetId: r.adSetId, name: r.name, status: r.status });
      }
    }
    return NextResponse.json({ ads: Array.from(byAdId.values()) });
  }

  return NextResponse.json({ error: "platform must be 'GOOGLE_ADS' or 'META'" }, { status: 400 });
}
