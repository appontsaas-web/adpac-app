import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { listLocations, fetchLocationPerformance, listReviews } from '@/lib/googleBusinessProfile';
import { decryptToken } from '@/lib/crypto';

// POST /api/google-business/sync[?accountId=xxx&days=30]
// Pulls locations (upserting BusinessLocation), their daily performance
// (upserting LocationMetric), and their reviews (upserting BusinessReview)
// for every connected Business Profile account — or just one, scoped by
// accountId. Same two-caller pattern as /api/metrics/sync: an unattended
// scheduler (SYNC_SECRET header) or a signed-in operator with the
// businessProfile capability for that client.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  const secretOk = process.env.SYNC_SECRET && secret === process.env.SYNC_SECRET;
  const accountId = req.nextUrl.searchParams.get('accountId');

  if (!secretOk) {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (accountId) {
      const account = await db.googleBusinessProfileAccount.findUnique({ where: { id: accountId } });
      if (!account) return NextResponse.json({ error: 'Business Profile account not found' }, { status: 404 });
      if (!(await hasCapability(me, account.clientId, 'businessProfile'))) {
        return NextResponse.json({ error: 'Business Profile access required for this client' }, { status: 403 });
      }
    } else if (me.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required to sync all accounts at once' }, { status: 403 });
    }
  }

  const accounts = await db.googleBusinessProfileAccount.findMany({
    where: { status: 'connected', ...(accountId ? { id: accountId } : {}) },
  });

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1), 365);
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);

  let locationsSynced = 0;
  let metricsSynced = 0;
  let reviewsSynced = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const refreshToken = decryptToken(account.refreshTokenEncrypted);

      const gbpLocations = await listLocations(account.gbpAccountId, refreshToken);
      for (const gbpLoc of gbpLocations) {
        const location = await db.businessLocation.upsert({
          where: { accountId_gbpLocationId: { accountId: account.id, gbpLocationId: gbpLoc.name } },
          create: {
            accountId: account.id,
            gbpLocationId: gbpLoc.name,
            title: gbpLoc.title,
            address: gbpLoc.address,
            primaryPhone: gbpLoc.primaryPhone,
            openStatus: gbpLoc.openInfo,
          },
          update: {
            title: gbpLoc.title,
            address: gbpLoc.address,
            primaryPhone: gbpLoc.primaryPhone,
            openStatus: gbpLoc.openInfo,
          },
        });
        locationsSynced++;

        // Performance metrics — a failure for one location (e.g. quota not
        // yet approved for this account) shouldn't block the others.
        try {
          const perf = await fetchLocationPerformance(gbpLoc.name, refreshToken, since, until);
          for (const row of perf) {
            await db.locationMetric.upsert({
              where: { locationId_date: { locationId: location.id, date: new Date(row.date) } },
              create: {
                locationId: location.id,
                date: new Date(row.date),
                searchImpressions: row.searchImpressions,
                mapsImpressions: row.mapsImpressions,
                callClicks: row.callClicks,
                websiteClicks: row.websiteClicks,
                directionRequests: row.directionRequests,
                conversations: row.conversations,
                bookings: row.bookings,
              },
              update: {
                searchImpressions: row.searchImpressions,
                mapsImpressions: row.mapsImpressions,
                callClicks: row.callClicks,
                websiteClicks: row.websiteClicks,
                directionRequests: row.directionRequests,
                conversations: row.conversations,
                bookings: row.bookings,
              },
            });
            metricsSynced++;
          }
        } catch (err: any) {
          errors.push(`${gbpLoc.name} performance: ${err.message}`);
        }

        // Reviews — the reviews API wants the accounts/*/locations/* path,
        // not the bare locations/* resource name the other two APIs use.
        try {
          const accountAndLocationPath = `${account.gbpAccountId}/${gbpLoc.name}`;
          const reviews = await listReviews(accountAndLocationPath, refreshToken);
          for (const r of reviews) {
            await db.businessReview.upsert({
              where: { locationId_gbpReviewName: { locationId: location.id, gbpReviewName: r.name } },
              create: {
                locationId: location.id,
                gbpReviewName: r.name,
                reviewerName: r.reviewerName,
                starRating: r.starRating,
                comment: r.comment,
                createTime: new Date(r.createTime),
                updateTime: new Date(r.updateTime),
                // Never downgrade a reply already POSTED locally just because
                // Google's hasReply flag disagrees on this pass — replyState
                // only ever gets set here on first sight of a review.
                replyState: r.hasReply ? 'POSTED' : 'NONE',
              },
              update: {
                reviewerName: r.reviewerName,
                starRating: r.starRating,
                comment: r.comment,
                updateTime: new Date(r.updateTime),
              },
            });
            reviewsSynced++;
          }
        } catch (err: any) {
          errors.push(`${gbpLoc.name} reviews: ${err.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`${account.gbpAccountId}: ${err.message}`);
    }
  }

  return NextResponse.json({ locationsSynced, metricsSynced, reviewsSynced, errors });
}
