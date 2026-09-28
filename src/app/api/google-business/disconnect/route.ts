import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/google-business/disconnect  { clientId }
// Only forgets the local link (account, its locations, their metrics and
// reviews) — doesn't touch anything on the Google side.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await req.formData();
  const clientId = formData.get('clientId');
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'businessProfile'))) {
    return NextResponse.json({ error: 'Business Profile access required for this client' }, { status: 403 });
  }

  const accounts = await db.googleBusinessProfileAccount.findMany({ where: { clientId } });
  for (const account of accounts) {
    const locations = await db.businessLocation.findMany({ where: { accountId: account.id }, select: { id: true } });
    const locationIds = locations.map((l) => l.id);
    if (locationIds.length) {
      const reviews = await db.businessReview.findMany({ where: { locationId: { in: locationIds } }, select: { id: true } });
      const reviewIds = reviews.map((r) => r.id);
      // ActionLog rows are the audit trail — never deleted. Null out their
      // location/review pointers first so the FK constraint doesn't block
      // deleting the locations/reviews/metrics below.
      await db.actionLog.updateMany({ where: { locationId: { in: locationIds } }, data: { locationId: null } });
      if (reviewIds.length) {
        await db.actionLog.updateMany({ where: { businessReviewId: { in: reviewIds } }, data: { businessReviewId: null } });
      }
      await db.locationMetric.deleteMany({ where: { locationId: { in: locationIds } } });
      await db.businessReview.deleteMany({ where: { locationId: { in: locationIds } } });
      await db.businessLocation.deleteMany({ where: { id: { in: locationIds } } });
    }
  }
  await db.googleBusinessProfileAccount.deleteMany({ where: { clientId } });

  return NextResponse.redirect(new URL(`/dashboard/clients/${clientId}`, req.url), { status: 303 });
}
