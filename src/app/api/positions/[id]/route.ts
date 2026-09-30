import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// PATCH /api/positions/[id] — admin-only. Body: any subset of
// { name, canManageCampaigns, canManageGoogleAds, canManageTargeting }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const position = await db.position.findUnique({ where: { id: params.id } });
  if (!position) return NextResponse.json({ error: 'Position not found' }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: 'Position name cannot be blank' }, { status: 400 });
    if (name !== position.name) {
      const existing = await db.position.findUnique({ where: { name } });
      if (existing) return NextResponse.json({ error: `A position named "${name}" already exists` }, { status: 400 });
      data.name = name;
    }
  }
  if (body.canManageCampaigns !== undefined) data.canManageCampaigns = !!body.canManageCampaigns;
  if (body.canManageGoogleAds !== undefined) data.canManageGoogleAds = !!body.canManageGoogleAds;
  if (body.canManageTargeting !== undefined) data.canManageTargeting = !!body.canManageTargeting;
  if (body.canViewInvoices !== undefined) data.canViewInvoices = !!body.canViewInvoices;
  if (body.canViewReporting !== undefined) data.canViewReporting = !!body.canViewReporting;
  if (body.canManageTagManager !== undefined) data.canManageTagManager = !!body.canManageTagManager;
  if (body.canManageBusinessProfile !== undefined) data.canManageBusinessProfile = !!body.canManageBusinessProfile;
  if (body.canManageMeta !== undefined) data.canManageMeta = !!body.canManageMeta;
  if (body.canManageSnapchat !== undefined) data.canManageSnapchat = !!body.canManageSnapchat;
  if (body.canManageTikTok !== undefined) data.canManageTikTok = !!body.canManageTikTok;

  const updated = await db.position.update({ where: { id: params.id }, data });
  return NextResponse.json({ position: updated });
}

// DELETE /api/positions/[id] — admin-only. Anyone currently holding this
// position is unassigned (positionId set to null) rather than blocked —
// they just lose those capabilities until given a new position.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const position = await db.position.findUnique({ where: { id: params.id } });
  if (!position) return NextResponse.json({ error: 'Position not found' }, { status: 404 });

  await db.user.updateMany({ where: { positionId: params.id }, data: { positionId: null } });
  await db.position.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
