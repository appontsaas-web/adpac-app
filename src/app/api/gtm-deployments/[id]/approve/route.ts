import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { createTagAndTrigger, publishVersion, GtmTagRequest } from '@/lib/googleTagManager';
import { decryptToken } from '@/lib/crypto';

// POST /api/gtm-deployments/[id]/approve
// The one place this integration actually touches a client's live site
// tracking. Creates the tag + trigger in the container's workspace, then
// immediately publishes a new version — GTM has no "paused" state like a
// Google Ads campaign does, so approving here means it goes live right away.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const actionLog = await db.actionLog.findUnique({ where: { id: params.id } });
  if (!actionLog) return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
  if (actionLog.actionType !== 'DEPLOY_GTM_TAG') {
    return NextResponse.json({ error: 'This action log entry is not a GTM tag deployment' }, { status: 400 });
  }

  if (!(await hasCapability(me, actionLog.clientId, 'tagManager'))) {
    return NextResponse.json({ error: 'Tag Manager access required for this client' }, { status: 403 });
  }

  if (actionLog.status !== 'PENDING_APPROVAL') {
    return NextResponse.json({ error: `Deployment is already ${actionLog.status}` }, { status: 400 });
  }

  const container = await db.googleTagManagerContainer.findFirst({ where: { clientId: actionLog.clientId } });
  if (!container) {
    return NextResponse.json({ error: 'No GTM container connected for this client' }, { status: 400 });
  }

  const payload = JSON.parse(actionLog.payloadJson) as GtmTagRequest;

  try {
    const refreshToken = decryptToken(container.refreshTokenEncrypted);

    const { tagId, triggerId } = await createTagAndTrigger(
      container.gtmAccountId,
      container.gtmContainerId,
      container.workspaceId,
      refreshToken,
      payload
    );
    const { versionId } = await publishVersion(
      container.gtmAccountId,
      container.gtmContainerId,
      container.workspaceId,
      refreshToken,
      `AdPac: ${payload.name}`
    );

    const updated = await db.actionLog.update({
      where: { id: actionLog.id },
      data: {
        status: 'EXECUTED',
        approvedByUserId: me.id,
        executedAt: new Date(),
        payloadJson: JSON.stringify({ ...payload, gtmTagId: tagId, gtmTriggerId: triggerId, gtmVersionId: versionId }),
      },
    });

    return NextResponse.json({ actionLog: updated });
  } catch (err: any) {
    console.error('GTM deployment approve failed:', err.message);
    await db.actionLog.update({
      where: { id: actionLog.id },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
