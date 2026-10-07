import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { renderInvoicePdf } from '@/lib/invoicePdf';

// Portal-session wrapper around the staff invoice PDF renderer: verifies the
// invoice belongs to the signed-in portal client, then reuses the same
// generator (flagged via a header the staff route trusts only from here).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const inv = await db.invoice.findUnique({ where: { id: params.id }, select: { clientId: true } });
  if (!inv || inv.clientId !== client.id) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  return renderInvoicePdf(params, { skipAuth: true });
}
