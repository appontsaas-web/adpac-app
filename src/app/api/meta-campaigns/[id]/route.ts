import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// PATCH /api/meta-campaigns/[id]
// Body: { hiddenFromList: boolean }
// Purely a local display preference (see MetaCampaign.hiddenFromList in
// schema.prisma) — never touches Meta or the underlying synced campaign
// data, just whether it shows in the reporting breakdown table. Admin-only,
// same restriction as the Google Ads equivalent (/api/campaigns/[id]).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  if (body.hiddenFromList === undefined) {
    return NextResponse.json({ error: 'Provide hiddenFromList' }, { status: 400 });
  }

  const campaign = await db.metaCampaign.findUnique({ where: { id: params.id }, include: { adAccount: true } });
  if (!campaign) return NextResponse.json({ error: 'Meta campaign not found' }, { status: 404 });

  if (!(await hasCapability(me, campaign.adAccount.clientId, 'meta'))) {
    return NextResponse.json({ error: 'Meta Ads access required for this client' }, { status: 403 });
  }
  if (me.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only admins can hide or unhide campaigns' }, { status: 403 });
  }

  const updated = await db.metaCampaign.update({
    where: { id: campaign.id },
    data: { hiddenFromList: !!body.hiddenFromList },
  });
  return NextResponse.json({ campaign: updated });
}
