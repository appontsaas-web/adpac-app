import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { GtmTagRequest, GtmTagType } from '@/lib/googleTagManager';

const VALID_TYPES: GtmTagType[] = ['GA4_CONFIG', 'GOOGLE_ADS_CONVERSION', 'REMARKETING'];

// POST /api/gtm-deployments
// Body: { clientId, type, name, measurementId?, conversionId?, conversionLabel? }
// Writes nothing to Google yet — this only records what's being requested as
// a PENDING_APPROVAL ActionLog row (actionType "DEPLOY_GTM_TAG"). A human
// with tagManager capability approves it via
// /api/gtm-deployments/[id]/approve before anything is created or published
// on the client's real GTM container.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { clientId, type, name, measurementId, conversionId, conversionLabel } = body;

  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!(await hasCapability(me, clientId, 'tagManager'))) {
    return NextResponse.json({ error: 'Tag Manager access required for this client' }, { status: 403 });
  }

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (type === 'GA4_CONFIG' && !measurementId) {
    return NextResponse.json({ error: 'measurementId is required for a GA4_CONFIG tag' }, { status: 400 });
  }
  if ((type === 'GOOGLE_ADS_CONVERSION' || type === 'REMARKETING') && !conversionId) {
    return NextResponse.json({ error: 'conversionId is required for this tag type' }, { status: 400 });
  }
  if (type === 'GOOGLE_ADS_CONVERSION' && !conversionLabel) {
    return NextResponse.json({ error: 'conversionLabel is required for a GOOGLE_ADS_CONVERSION tag' }, { status: 400 });
  }

  const container = await db.googleTagManagerContainer.findFirst({ where: { clientId } });
  if (!container) return NextResponse.json({ error: 'No GTM container connected for this client' }, { status: 404 });

  const payload: GtmTagRequest = { type, name, measurementId, conversionId, conversionLabel };

  const actionLog = await db.actionLog.create({
    data: {
      clientId,
      actionType: 'DEPLOY_GTM_TAG',
      payloadJson: JSON.stringify(payload),
      status: 'PENDING_APPROVAL',
      proposedBy: me.id,
    },
  });

  return NextResponse.json({ actionLog });
}
