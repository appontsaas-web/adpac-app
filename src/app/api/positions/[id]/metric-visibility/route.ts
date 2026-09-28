import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { METRIC_CATALOG, isMetricPlatform } from '@/lib/metricCatalog';

// GET /api/positions/[id]/metric-visibility
// Admin-only. Returns { google: string[], meta: string[], snapchat: string[] }
// — the HIDDEN metric keys for this position, per platform (a metric absent
// from every list is visible). Always returns all three platform keys, even
// with empty arrays, so the admin UI doesn't need its own default-shape logic.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const rows = await db.hiddenMetric.findMany({ where: { positionId: params.id } });
  const result: Record<string, string[]> = { google: [], meta: [], snapchat: [] };
  for (const row of rows) {
    if (!result[row.platform]) result[row.platform] = [];
    result[row.platform].push(row.metricKey);
  }
  return NextResponse.json(result);
}

// POST /api/positions/[id]/metric-visibility  { platform, metricKey, hidden: boolean }
// Admin-only. Toggles one metric — creates the HiddenMetric row when hidden
// is true, deletes it when false. One call per checkbox click (not a bulk
// replace) so the admin UI can fire-and-forget on every toggle.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { platform, metricKey, hidden } = body;
  if (!isMetricPlatform(platform)) {
    return NextResponse.json({ error: 'platform must be one of: google, meta, snapchat' }, { status: 400 });
  }
  if (typeof metricKey !== 'string' || !METRIC_CATALOG[platform].some((m) => m.key === metricKey)) {
    return NextResponse.json({ error: `Unknown metric key "${metricKey}" for platform "${platform}"` }, { status: 400 });
  }
  if (typeof hidden !== 'boolean') {
    return NextResponse.json({ error: 'hidden (boolean) is required' }, { status: 400 });
  }

  const position = await db.position.findUnique({ where: { id: params.id } });
  if (!position) return NextResponse.json({ error: 'Position not found' }, { status: 404 });

  if (hidden) {
    await db.hiddenMetric.upsert({
      where: { positionId_platform_metricKey: { positionId: params.id, platform, metricKey } },
      create: { positionId: params.id, platform, metricKey },
      update: {},
    });
  } else {
    await db.hiddenMetric.deleteMany({ where: { positionId: params.id, platform, metricKey } });
  }
  return NextResponse.json({ ok: true });
}
