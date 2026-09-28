import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

const METRIC_TYPES = ['SPEND', 'CONVERSIONS', 'CPA', 'ROAS', 'LEADS'] as const;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// GET /api/clients/[id]/monthly-goal[?monthKey=2026-09]
// Gated behind canViewReporting — same read bar as the performance
// dashboards themselves, since the goal is reporting context, not a write
// to any ad platform. Defaults to the current calendar month (UTC) when
// monthKey is omitted.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await canViewReporting(me, params.id))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  const monthKey = req.nextUrl.searchParams.get('monthKey') ?? currentMonthKey();
  const goal = await db.clientMonthlyGoal.findUnique({
    where: { clientId_monthKey: { clientId: params.id, monthKey } },
    include: { setByUser: { select: { name: true, email: true } } },
  });
  return NextResponse.json({ monthKey, goal });
}

// PUT /api/clients/[id]/monthly-goal  { monthKey?, metricType?, targetValue?, note? }
// Same access bar as GET — any staff with reporting access can set the
// goal, not just EDIT-level staff, because "inform what the goal is" is
// declarative context, not a change to a live campaign. One goal per
// client per month (see schema's @@unique) — setting a new one for a month
// that already has one overwrites it rather than versioning, since only the
// CURRENT stated goal should steer optimization (see ClientMonthlyGoal's
// doc comment in schema.prisma).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await canViewReporting(me, params.id))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const monthKey: string = body.monthKey ?? currentMonthKey();
  const metricType: string | null = body.metricType ?? null;
  const targetValue: number | null = body.targetValue !== undefined && body.targetValue !== null && body.targetValue !== '' ? Number(body.targetValue) : null;
  const note: string | null = body.note?.trim() || null;

  if (metricType && !(METRIC_TYPES as readonly string[]).includes(metricType)) {
    return NextResponse.json({ error: `metricType must be one of: ${METRIC_TYPES.join(', ')}` }, { status: 400 });
  }
  if (metricType && (targetValue === null || isNaN(targetValue))) {
    return NextResponse.json({ error: 'targetValue is required when metricType is set' }, { status: 400 });
  }
  if (!metricType && !note) {
    return NextResponse.json({ error: 'Set either a metric target or a note (or both)' }, { status: 400 });
  }

  const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const goal = await db.clientMonthlyGoal.upsert({
    where: { clientId_monthKey: { clientId: params.id, monthKey } },
    create: { clientId: params.id, monthKey, metricType, targetValue: metricType ? targetValue : null, note, setByUserId: me.id },
    update: { metricType, targetValue: metricType ? targetValue : null, note, setByUserId: me.id },
    include: { setByUser: { select: { name: true, email: true } } },
  });
  return NextResponse.json({ goal });
}
