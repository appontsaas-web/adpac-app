import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/positions — admin-only. Lists all position templates.
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const positions = await db.position.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ positions });
}

// POST /api/positions — admin-only. Creates a new position template.
// Body: { name, canManageCampaigns?, canManageGoogleAds?, canManageTargeting?, canViewInvoices? }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json();
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Position name is required' }, { status: 400 });

  const existing = await db.position.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: `A position named "${name}" already exists` }, { status: 400 });

  const position = await db.position.create({
    data: {
      name,
      canManageCampaigns: !!body.canManageCampaigns,
      canManageGoogleAds: !!body.canManageGoogleAds,
      canManageTargeting: !!body.canManageTargeting,
      canViewInvoices: !!body.canViewInvoices,
      canViewReporting: !!body.canViewReporting,
      canManageTagManager: !!body.canManageTagManager,
      canManageBusinessProfile: !!body.canManageBusinessProfile,
      canManageMeta: !!body.canManageMeta,
      canManageSnapchat: !!body.canManageSnapchat,
    },
  });
  return NextResponse.json({ position });
}
