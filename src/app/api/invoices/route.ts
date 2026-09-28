import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { maybeGrantOnFirstInvoice } from '@/lib/validity';
import { generateInvoiceNumber } from '@/lib/invoiceNumber';

// POST /api/invoices
// Body: { clientId, amountCents, description?, issuedAt? }
// Creates a manual, UNPAID invoice for a client. Phase 1 has no payment
// processor — this is purely a record AdPac staff create and later mark
// paid by hand (see PATCH /api/invoices/[id]) once payment is confirmed
// through whatever channel the client actually paid with. Admin-only —
// Finance is never covered by per-client STAFF permissions.
//
// issuedAt defaults to now (via the schema default) if omitted — but an
// invoice is often written up after the fact (e.g. backdating to the 1st of
// the month it covers), so it's editable here rather than always being
// "whenever I happened to click Create".
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { clientId, amountCents, description, invoiceNumber: customNumber, paymentLink, issuedAt: issuedAtInput } = await req.json();
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amountCents must be a positive integer (in cents)' }, { status: 400 });
  }
  if (paymentLink && !/^https?:\/\//i.test(String(paymentLink))) {
    return NextResponse.json({ error: 'Payment link must be a valid http(s) URL' }, { status: 400 });
  }
  let issuedAt: Date | undefined;
  if (issuedAtInput) {
    issuedAt = new Date(issuedAtInput);
    if (isNaN(issuedAt.getTime())) {
      return NextResponse.json({ error: 'issuedAt is not a valid date' }, { status: 400 });
    }
  }

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const userId = me.id; // captured for the closures below — TS can't narrow `me` through them
  const link = paymentLink ? String(paymentLink).trim() : null;

  if (customNumber) {
    const trimmed = String(customNumber).trim();
    if (!trimmed) return NextResponse.json({ error: 'Invoice number cannot be blank' }, { status: 400 });
    const existing = await db.invoice.findUnique({ where: { invoiceNumber: trimmed } });
    if (existing) return NextResponse.json({ error: `Invoice number "${trimmed}" is already in use` }, { status: 400 });

    try {
      const invoice = await db.invoice.create({
        data: {
          clientId,
          invoiceNumber: trimmed,
          amountCents: amount,
          description: description || null,
          paymentLink: link,
          status: 'UNPAID',
          createdByUserId: userId,
          ...(issuedAt && { issuedAt }),
        },
      });
      await maybeGrantOnFirstInvoice(clientId, invoice.issuedAt);
      return NextResponse.json({ invoice });
    } catch (err: any) {
      console.error('POST /api/invoices failed:', err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // No invoice number supplied — auto-assign one in the same style as the
  // numbers already used on some of Nesf Shawaya's invoices (see
  // lib/invoiceNumber.ts), not the plain sequential INV-0001 scheme this
  // used to generate. Retries once on a rare collision (e.g. two invoices
  // created in the same instant) rather than failing outright.
  async function createWithNumber(attempt = 0): Promise<any> {
    const invoiceNumber = await generateInvoiceNumber();
    try {
      return await db.invoice.create({
        data: {
          clientId,
          invoiceNumber,
          amountCents: amount,
          description: description || null,
          paymentLink: link,
          status: 'UNPAID',
          createdByUserId: userId,
          ...(issuedAt && { issuedAt }),
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
    console.error('POST /api/invoices failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
