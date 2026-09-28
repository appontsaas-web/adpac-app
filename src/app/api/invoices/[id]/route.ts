import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { getTokensPerDollar, getInvoiceTokenNet } from '@/lib/tokens';
import { isStarterBundleInvoice, renewValidityForPaidInvoice } from '@/lib/validity';

// PATCH /api/invoices/[id]
// Body may include any of:
//   status: "PAID" | "UNPAID"  — mark paid (with optional paidAt/paymentMethod)
//                                  or revert a paid invoice back to unpaid
//   invoiceNumber, amountCents, description, issuedAt — editable regardless of status
//
// Admin-only — Finance is never covered by per-client STAFF permissions,
// even EDIT. Edits/deletes are allowed on paid invoices too (to fix
// mistakes) rather than being locked out entirely.
//
// Token ledger side effect: an UNPAID->PAID transition here is the only
// thing that credits a client's prepaid token balance (see lib/tokens.ts) —
// amountCents/100 * the current TokenSetting.tokensPerDollar rate, recorded
// as a TOPUP. A PAID->UNPAID transition creates an offsetting REVERSAL.
// Editing an ALREADY-PAID invoice's paidAt/amount/description also re-syncs
// that invoice's own TOPUP (or validity renewal) to match — see the
// wasPaid && willBePaid branch below — so, e.g., correcting an invoice's
// payment date immediately moves the matching entry in the token balance
// history instead of leaving it stuck at the old date. This re-sync is
// scoped to just the one invoice being edited; it does NOT reprice every
// other invoice for the client at the current rate — that broader catch-up
// (for when the rate itself, or an AI-impact override, changes) is what the
// "↻ Refresh" button / recomputeClientTokens is for.
//
// Exception: an invoice whose description contains "Starter Bundle - 3
// Months" (case-insensitive) is treated as a validity renewal instead of a
// token top-up — see lib/validity.ts. Marking it PAID extends the client's
// account validity by 3 months and does NOT create a TOPUP. Unmarking it
// paid does not currently roll the validity extension back (same one-way
// caveat as everything else in this route that only reacts to the
// UNPAID->PAID direction).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const invoice = await db.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.status === 'PAID') {
    if (invoice.status === 'PAID' && body.paidAt === undefined && body.paymentMethod === undefined) {
      return NextResponse.json({ error: 'Invoice is already marked paid' }, { status: 400 });
    }
    data.status = 'PAID';
    if (body.paidAt) {
      const paidAt = new Date(body.paidAt);
      if (isNaN(paidAt.getTime())) {
        return NextResponse.json({ error: 'paidAt is not a valid date' }, { status: 400 });
      }
      data.paidAt = paidAt;
    } else if (invoice.status !== 'PAID') {
      data.paidAt = new Date();
    }
    if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod || null;
  } else if (body.status === 'UNPAID') {
    data.status = 'UNPAID';
    data.paidAt = null;
    data.paymentMethod = null;
  }

  if (body.invoiceNumber !== undefined) {
    const trimmed = String(body.invoiceNumber).trim();
    if (!trimmed) return NextResponse.json({ error: 'Invoice number cannot be blank' }, { status: 400 });
    if (trimmed !== invoice.invoiceNumber) {
      const existing = await db.invoice.findUnique({ where: { invoiceNumber: trimmed } });
      if (existing) return NextResponse.json({ error: `Invoice number "${trimmed}" is already in use` }, { status: 400 });
      data.invoiceNumber = trimmed;
    }
  }

  if (body.amountCents !== undefined) {
    const amount = Number(body.amountCents);
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amountCents must be a positive integer' }, { status: 400 });
    }
    data.amountCents = amount;
  }
  if (body.description !== undefined) data.description = body.description || null;
  if (body.issuedAt !== undefined) {
    const issuedAt = new Date(body.issuedAt);
    if (isNaN(issuedAt.getTime())) {
      return NextResponse.json({ error: 'issuedAt is not a valid date' }, { status: 400 });
    }
    data.issuedAt = issuedAt;
  }
  if (body.paymentLink !== undefined) {
    const link = String(body.paymentLink || '').trim();
    if (link && !/^https?:\/\//i.test(link)) {
      return NextResponse.json({ error: 'Payment link must be a valid http(s) URL' }, { status: 400 });
    }
    data.paymentLink = link || null;
  }

  const wasPaid = invoice.status === 'PAID';
  const willBePaid = data.status === 'PAID' ? true : data.status === 'UNPAID' ? false : wasPaid;

  try {
    const updated = await db.invoice.update({ where: { id: params.id }, data });

    if (!wasPaid && willBePaid) {
      if (isStarterBundleInvoice(updated.description)) {
        // "Starter Bundle - 3 Months" invoices renew validity only — no
        // token top-up for this invoice type.
        await renewValidityForPaidInvoice(updated.clientId, updated.paidAt ?? new Date());
      } else {
        // UNPAID -> PAID: top up tokens at the current rate. Use the final
        // amountCents (in case amount was edited in the same request).
        // createdAt is backdated to the invoice's paidAt (which itself can be
        // backdated via the "Date of payment" field) so the ledger reflects
        // when the invoice was actually paid, not when this API call ran.
        const rate = await getTokensPerDollar();
        const tokens = (updated.amountCents / 100) * rate;
        await db.tokenTransaction.create({
          data: {
            clientId: updated.clientId,
            invoiceId: updated.id,
            type: 'TOPUP',
            tokens,
            note: `Invoice ${updated.invoiceNumber} marked paid (${rate} tokens/$)`,
            createdByUserId: me.id,
            createdAt: updated.paidAt ?? new Date(),
          },
        });
      }
    } else if (wasPaid && !willBePaid) {
      // PAID -> UNPAID: reverse whatever this invoice net-contributed so far.
      // This one keeps "now" as its date — it's a real correction happening
      // today, not something that should look like it happened back on the
      // original payment date.
      const net = await getInvoiceTokenNet(updated.id);
      if (net !== 0) {
        await db.tokenTransaction.create({
          data: {
            clientId: updated.clientId,
            invoiceId: updated.id,
            type: 'REVERSAL',
            tokens: -net,
            note: `Invoice ${updated.invoiceNumber} unmarked paid`,
            createdByUserId: me.id,
          },
        });
      }
    } else if (wasPaid && willBePaid) {
      // Edit to an invoice that was already, and remains, PAID. paidAt,
      // amountCents, or description may have just changed — re-sync THIS
      // invoice's own ledger entry to match, so e.g. correcting the payment
      // date immediately moves its TOPUP in the balance history instead of
      // leaving a stale entry at the old date. Scoped to this one invoice
      // only (see the doc comment above) — unrelated invoices are untouched.
      const relevantFieldsChanged =
        data.paidAt !== undefined || data.amountCents !== undefined || data.description !== undefined;

      if (relevantFieldsChanged) {
        const wasStarterBundle = isStarterBundleInvoice(invoice.description);
        const isStarterBundleNow = isStarterBundleInvoice(updated.description);

        // Clear out whatever this invoice previously produced (a TOPUP, or
        // nothing if it was a Starter Bundle) before recreating it to match
        // the current data.
        await db.tokenTransaction.deleteMany({
          where: { invoiceId: updated.id, type: { in: ['TOPUP', 'REVERSAL'] } },
        });

        if (isStarterBundleNow) {
          if (!wasStarterBundle) {
            // The edit just reclassified this as a Starter Bundle invoice
            // (e.g. the description changed) — grant the validity renewal
            // it would have gotten had it been marked paid that way from
            // the start. If it was ALREADY a Starter Bundle invoice, it was
            // already renewed once when first marked paid; a later edit to
            // its date/amount doesn't renew validity a second time.
            await renewValidityForPaidInvoice(updated.clientId, updated.paidAt ?? new Date());
          }
        } else {
          // Normal paid invoice: (re)create its TOPUP at the CURRENT rate,
          // backdated to its (possibly just-edited) paidAt — same rate
          // philosophy the "↻ Refresh" recompute uses.
          const rate = await getTokensPerDollar();
          const tokens = (updated.amountCents / 100) * rate;
          await db.tokenTransaction.create({
            data: {
              clientId: updated.clientId,
              invoiceId: updated.id,
              type: 'TOPUP',
              tokens,
              note: `Invoice ${updated.invoiceNumber} edited (${rate} tokens/$)`,
              createdByUserId: me.id,
              createdAt: updated.paidAt ?? new Date(),
            },
          });
        }
      }
    }

    return NextResponse.json({ invoice: updated });
  } catch (err: any) {
    console.error('PATCH /api/invoices/[id] failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/invoices/[id] — admin-only.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const invoice = await db.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  await db.invoice.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
