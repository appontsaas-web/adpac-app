import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { isMetricPlatform } from '@/lib/metricCatalog';

// GET /api/metric-visibility?platform=google
// Returns { hidden: string[] } — the metric keys the CURRENT signed-in user
// should not see on that platform's dashboard. ADMIN always gets an empty
// array (these restrictions are something admins set for staff, not
// something admins are themselves subject to — same "ADMIN bypasses
// positions entirely" rule as every other capability check in lib/access.ts).
// A STAFF user with no position assigned also gets an empty array — no
// position means no HiddenMetric rows could exist for them anyway.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform');
  if (!platform || !isMetricPlatform(platform)) {
    return NextResponse.json({ error: 'platform must be one of: google, meta, snapchat' }, { status: 400 });
  }

  if (me.role === 'ADMIN' || !me.position) {
    return NextResponse.json({ hidden: [] });
  }

  const rows: { metricKey: string }[] = await db.hiddenMetric.findMany({
    where: { positionId: me.position.id, platform },
    select: { metricKey: true },
  });
  return NextResponse.json({ hidden: rows.map((r) => r.metricKey) });
}
