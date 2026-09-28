import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// PATCH /api/campaigns/[id]
// Body: { targetLocations?: string[], hiddenFromList?: boolean }
// Either field can be sent alone or together.
//
// targetLocations: lets an operator edit the target locations on a draft
// before approving it — region-level location targeting is otherwise only
// set once at client creation and used blindly. Only allowed pre-approval:
// once a campaign is pushed to Google Ads (googleCampaignId set), editing
// the local draft wouldn't do anything to the live campaign, so we block it
// to avoid the false impression that it changed something real.
//
// hiddenFromList: purely a local display preference (see schema.prisma) —
// allowed regardless of status, since it never touches Google Ads or the
// local campaign data itself, just whether it shows in the default list.
// Admin-only by request — staff with campaign edit access can still edit
// targetLocations, but hiding/showing campaigns from the list is reserved
// for admins.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  if (body.targetLocations === undefined && body.hiddenFromList === undefined) {
    return NextResponse.json({ error: 'Provide targetLocations and/or hiddenFromList' }, { status: 400 });
  }

  const campaign = await db.campaign.findUnique({ where: { id: params.id } });
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  if (!(await hasCapability(me, campaign.clientId, 'campaigns'))) {
    return NextResponse.json({ error: 'Campaign management access required for this client' }, { status: 403 });
  }

  try {
    const data: Record<string, unknown> = {};

    if (body.targetLocations !== undefined) {
      if (!Array.isArray(body.targetLocations)) {
        return NextResponse.json({ error: 'targetLocations must be an array of strings' }, { status: 400 });
      }
      if (campaign.status !== 'DRAFT' && campaign.status !== 'PENDING_APPROVAL') {
        return NextResponse.json({ error: `Cannot edit a campaign that is already ${campaign.status}` }, { status: 400 });
      }
      if (campaign.googleCampaignId) {
        return NextResponse.json(
          { error: 'This campaign already exists on Google Ads — editing the local draft would not update it.' },
          { status: 400 }
        );
      }
      const draft = JSON.parse(campaign.aiBriefJson);
      draft.targetLocations = body.targetLocations;
      data.aiBriefJson = JSON.stringify(draft);
    }

    if (body.hiddenFromList !== undefined) {
      if (me.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Only admins can hide or unhide campaigns' }, { status: 403 });
      }
      data.hiddenFromList = !!body.hiddenFromList;
    }

    const updated = await db.campaign.update({ where: { id: campaign.id }, data });
    return NextResponse.json({ campaign: updated });
  } catch (err: any) {
    console.error('PATCH /api/campaigns/[id] failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id]
// Discards a draft. Only allowed while the campaign is still DRAFT or
// PENDING_APPROVAL and has never been pushed to Google Ads (no
// googleCampaignId) — once something exists on Google's side, "discarding"
// has to mean pausing/removing it there too, which is a different action
// than deleting our local record, so we deliberately don't allow it here.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const campaign = await db.campaign.findUnique({ where: { id: params.id } });
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  if (!(await hasCapability(me, campaign.clientId, 'campaigns'))) {
    return NextResponse.json({ error: 'Campaign management access required for this client' }, { status: 403 });
  }

  if (campaign.status !== 'DRAFT' && campaign.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Cannot discard a campaign that is already ${campaign.status}` }, { status: 400 });
  }
  if (campaign.googleCampaignId) {
    return NextResponse.json(
      { error: 'This campaign already exists on Google Ads — pause or remove it there instead of discarding.' },
      { status: 400 }
    );
  }

  // Clear dependent rows first — Campaign's relations don't cascade on
  // delete, so ActionLog/DailyMetric rows referencing this campaign would
  // otherwise block the delete with a foreign key constraint error.
  await db.$transaction([
    db.dailyMetric.deleteMany({ where: { campaignId: campaign.id } }),
    db.actionLog.deleteMany({ where: { campaignId: campaign.id } }),
    db.campaign.delete({ where: { id: campaign.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
