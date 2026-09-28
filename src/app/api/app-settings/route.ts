import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { getRealImpactVisibleToStaff, setRealImpactVisibleToStaff } from '@/lib/appSettings';

// GET /api/app-settings — any signed-in user (used to decide what to render)
// PATCH /api/app-settings { realImpactVisibleToStaff } — admin-only
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return NextResponse.json({ realImpactVisibleToStaff: await getRealImpactVisibleToStaff() });
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.realImpactVisibleToStaff !== 'boolean') {
    return NextResponse.json({ error: 'realImpactVisibleToStaff (boolean) is required' }, { status: 400 });
  }

  const setting = await setRealImpactVisibleToStaff(body.realImpactVisibleToStaff, me.id);
  return NextResponse.json({ realImpactVisibleToStaff: setting.realImpactVisibleToStaff });
}
