import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { GET as staffPdf } from '@/app/api/invoices/[id]/pdf/route';

// Portal-session wrapper around the staff invoice PDF renderer: verifies the
// invoice belongs to the signed-in portal client, then reuses the same
// generator (flagged via a header the staff route trusts only from here).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const inv = await db.invoice.findUnique({ where: { id: params.id }, select: { clientId: true } });
  if (!inv || inv.clientId !== client.id) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  return staffPdf(req, { params }, { skipAuth: true });
}
