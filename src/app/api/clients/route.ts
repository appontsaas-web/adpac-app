import { isDisplayCurrency, displayAmountToUsdCents } from '@/lib/currency';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/clients — ADMIN sees every client; STAFF only sees clients
// they've been explicitly assigned (any permission level).
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clients = await db.client.findMany({
    where: me.role === 'ADMIN' ? undefined : { assignments: { some: { userId: me.id } } },
    orderBy: { createdAt: 'desc' },
    include: { googleAdsAccounts: true, campaigns: true },
  });
  return NextResponse.json({ clients });
}

// POST /api/clients — admin-only. Staff work within clients you assign
// them, not create their own.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const cur = String(body.displayCurrency || 'USD').toUpperCase();
  if (!isDisplayCurrency(cur)) return NextResponse.json({ error: `Unsupported currency "${cur}"` }, { status: 400 });

  const client = await db.client.create({
    data: {
      name: body.name,
      website: body.website || null,
      industry: body.industry || null,
      monthlyBudget: body.monthlyBudget ? displayAmountToUsdCents(Number(body.monthlyBudget), cur) : null,
      displayCurrency: cur === 'USD' ? null : cur,
      primaryGoal: body.primaryGoal || null,
      adLanguage: body.adLanguage || null,
      targetLocations: body.targetLocations || null,
      ownerUserId: me.id,
    },
  });

  // Note: the free quarter of validity does NOT happen here — it's
  // anchored to the client's first invoice, not this raw record creation
  // (see maybeGrantOnFirstInvoice in lib/validity.ts, called from the
  // invoice-creation routes). No token grant anymore — discontinued.

  return NextResponse.json({ client });
}
