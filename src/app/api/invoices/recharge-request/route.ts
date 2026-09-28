import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewFinance } from '@/lib/access';
import { db } from '@/lib/db';
import { maybeGrantOnFirstInvoice } from '@/lib/validity';
import { generateInvoiceNumber } from '@/lib/invoiceNumber';

// POST /api/invoices/recharge-request
// Body: { clientId, amountCents, note? }
//
// Self-serve counterpart to POST /api/invoices (which stays admin-only).
// Anyone who can already see a client's invoices (admin, or STAFF whose
// Position has canViewInvoices — see canViewFinance) can ask for a specific
// dollar amount to be added to that client's token balance. This creates a
// normal UNPAID invoice right away — same shape as one admin would create
// by hand — just tagged source: "RECHARGE_REQUEST" and requestedByUserId so
// it's easy to spot and review. Nothing is paid or credited automatically;
// admin still reviews it and marks it PAID the usual way (which is what
// actually tops up tokens, per PATCH /api/invoices/[id]).
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { clientId, amountCents, note } = await req.json();
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!(await canViewFinance(me, clientId))) {
    return NextResponse.json({ error: 'Finance access required for this client' }, { status: 403 });
  }

  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amountCents must be a positive integer (in cents)' }, { status: 400 });
  }

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const trimmedNote = note ? String(note).trim().slice(0, 300) : '';
  const description = trimmedNote ? `Recharge request: ${trimmedNote}` : 'Recharge request';
  const userId = me.id; // captured for the closure below — TS can't narrow `me` through it

  // Same auto-numbering style as POST /api/invoices (see
  // lib/invoiceNumber.ts), retried once on a rare collision.
  async function createWithNumber(attempt = 0): Promise<any> {
    const invoiceNumber = await generateInvoiceNumber();
    try {
      return await db.invoice.create({
        data: {
          clientId,
          invoiceNumber,
          amountCents: amount,
          description,
          status: 'UNPAID',
          source: 'RECHARGE_REQUEST',
          requestedByUserId: userId,
        },
      });
    } catch (err: any) {
      if (attempt < 3 && String(err.message).includes('Unique constraint')) {
        return createWithNumber(attempt + 1);
      }
      throw err;
    }
  }

  try {
    const invoice = await createWithNumber();
    await maybeGrantOnFirstInvoice(clientId, invoice.issuedAt);
    return NextResponse.json({ invoice });
  } catch (err: any) {
    console.error('POST /api/invoices/recharge-request failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
