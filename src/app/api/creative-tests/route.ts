import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { aggregateVariantStats, evaluateTest } from '@/lib/creativeTests';

// GET /api/creative-tests?clientId=... — list every test for this client
// (any status), each with live-computed variant stats and evaluation, so
// the UI never has to separately poll for "how's it doing".
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!canEdit(await getClientAccess(me, clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  const tests = await db.creativeTest.findMany({
    where: { clientId },
    include: {
      variants: true,
      actionLogs: { where: { actionType: 'AB_TEST_WINNER', status: 'PENDING_APPROVAL' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const withStats = await Promise.all(
    tests.map(async (test) => {
      const stats = await aggregateVariantStats(test);
      const evaluation = test.status === 'RUNNING' || test.status === 'WINNER_FOUND' ? evaluateTest(test, stats) : null;
      return { ...test, stats, evaluation };
    })
  );

  return NextResponse.json({ tests: withStats });
}

// POST /api/creative-tests — start a new test from 2+ already-existing ads
// in the same ad group (Google) or ad set (Meta). Body:
//   { clientId, platform: 'GOOGLE_ADS'|'META', campaignId or metaCampaignId,
//     groupId, name, variants: [{ adId, adGroupId?, label }, ...] }
// Doesn't touch Google Ads/Meta at all — the ads already exist and are
// already live; this only starts tracking them as a test from this moment
// forward (see startedAt / aggregateVariantStats).
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { clientId, platform, campaignId, metaCampaignId, groupId, name, variants } = body;

  if (!clientId || !platform || !groupId || !name || !Array.isArray(variants) || variants.length < 2) {
    return NextResponse.json({ error: 'clientId, platform, groupId, name, and at least 2 variants are required' }, { status: 400 });
  }
  if (platform !== 'GOOGLE_ADS' && platform !== 'META') {
    return NextResponse.json({ error: "platform must be 'GOOGLE_ADS' or 'META'" }, { status: 400 });
  }
  if (platform === 'GOOGLE_ADS' && !campaignId) {
    return NextResponse.json({ error: 'campaignId is required for a Google Ads test' }, { status: 400 });
  }
  if (platform === 'META' && !metaCampaignId) {
    return NextResponse.json({ error: 'metaCampaignId is required for a Meta test' }, { status: 400 });
  }

  const capability = platform === 'GOOGLE_ADS' ? 'campaigns' : 'meta';
  if (!(await hasCapability(me, clientId, capability))) {
    return NextResponse.json({ error: `${platform === 'GOOGLE_ADS' ? 'Campaign management' : 'Meta Ads'} access required for this client` }, { status: 403 });
  }

  const test = await db.creativeTest.create({
    data: {
      clientId,
      platform,
      campaignId: platform === 'GOOGLE_ADS' ? campaignId : null,
      metaCampaignId: platform === 'META' ? metaCampaignId : null,
      groupId,
      name,
      createdByUserId: me.id,
      variants: {
        create: variants.map((v: { adId: string; adGroupId?: string; label: string }) => ({
          adId: v.adId,
          adGroupId: platform === 'GOOGLE_ADS' ? v.adGroupId ?? groupId : null,
          label: v.label,
        })),
      },
    },
    include: { variants: true },
  });

  return NextResponse.json({ test });
}
