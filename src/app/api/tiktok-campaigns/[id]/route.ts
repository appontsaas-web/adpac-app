import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// PATCH /api/tiktok-campaigns/[id]  { hiddenFromList: boolean }
// Admin-only local display-preference toggle — same as /api/snap-campaigns/[id].
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json();
  if (typeof body.hiddenFromList !== 'boolean') {
    return NextResponse.json({ error: 'hiddenFromList (boolean) is required' }, { status: 400 });
  }

  const campaign = await db.tikTokCampaign.findUnique({ where: { id: params.id } });
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const updated = await db.tikTokCampaign.update({
    where: { id: params.id },
    data: { hiddenFromList: body.hiddenFromList },
  });
  return NextResponse.json({ campaign: updated });
}
