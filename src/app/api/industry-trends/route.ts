import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { generateIndustryTrend } from '@/lib/industryTrends';

// POST /api/industry-trends  { clientId }
// Admin-only — see lib/industryTrends.ts for why: this aggregates other
// clients' performance data (rounded averages only, never named), which a
// staff member scoped to a single client shouldn't be able to trigger.
// Computed live on each call rather than stored — cheap (a handful of
// aggregate queries + one Claude call) and always reflects the latest synced
// metrics, same choice as the Creative A/B Testing panel's live stats.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  try {
    const result = await generateIndustryTrend(clientId);
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error('Industry trend generation failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
