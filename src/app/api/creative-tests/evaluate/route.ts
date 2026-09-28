import { NextRequest, NextResponse } from 'next/server';
import { generateAbTestInsights } from '@/lib/creativeTests';

// POST /api/creative-tests/evaluate
// A scheduler (cron) endpoint with no session — protect it with
// SYNC_SECRET, same pattern as /api/metrics/sync and /api/ai-insights/
// generate. Called once per scheduler cycle (see lib/scheduler.ts) after
// metrics sync, so it's always evaluating freshly-synced AdMetric/
// MetaAdMetric rows.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  if (!secret || secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await generateAbTestInsights();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Creative A/B test evaluation failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
