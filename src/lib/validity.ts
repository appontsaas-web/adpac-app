import { db } from './db';

// Account "subscription" validity + new-account free grant.
//
// - The "account creation date" used for validity purposes is NOT
//   Client.createdAt (when the admin added the client record in AdPac,
//   which can happen well before any billing relationship starts) — it's
//   the issuedAt date of the client's FIRST invoice, whatever its status.
//   See maybeGrantOnFirstInvoice, called after an invoice is created from
//   both POST /api/invoices and POST /api/invoices/recharge-request.
// - That first-invoice date anchors Client.validUntil = anchor + 3 months
//   (the free quarter), set by grantNewAccountBenefits. This used to also
//   create a 5000-token FREE_GRANT transaction backdated to anchor + 2
//   weeks — discontinued (both the past grants and the automatic one for
//   new clients) at the operator's request; the free quarter of validity
//   stays, only the free tokens were removed.
// - Validity renews when an invoice whose description names a Starter
//   Bundle variant is marked PAID (see renewValidityForPaidInvoice, called
//   from PATCH /api/invoices/[id]) — +3 months from whichever is later: the
//   current validUntil (if still active) or the payment date. That invoice
//   type extends validity ONLY — it deliberately does NOT also create a
//   TOPUP, unlike every other paid invoice. The match is deliberately loose
//   (description contains "starter bundle" AND "3 months", case-insensitive,
//   not a single exact phrase) so a tiered/renamed bundle — "Starter Bundle
//   Prime - 3 Months", say — is still recognized without needing a code
//   change every time a new variant name shows up. This is broad on
//   purpose: a false match wrongly withholds a token credit (safe-ish, easy
//   to spot and fix by hand), while a false negative wrongly grants BOTH a
//   validity renewal's worth of goodwill AND a full-price token top-up for
//   the same invoice — worse to get wrong silently.
// - This is purely informational right now: nothing in the app blocks or
//   restricts access when an account's validity has lapsed.

const STARTER_BUNDLE_KEYWORDS = ['starter bundle', '3 months'];

function addQuarter(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 3);
  return d;
}

export function isStarterBundleInvoice(description: string | null | undefined): boolean {
  if (!description) return false;
  const lower = description.toLowerCase();
  return STARTER_BUNDLE_KEYWORDS.every((kw) => lower.includes(kw));
}

// Idempotent — safe to call more than once for the same client: skips if
// validUntil is already set, so it only ever fires off the client's true
// first invoice. (Used to also create a 5000-token FREE_GRANT transaction —
// discontinued at the operator's request; only the free-quarter validity
// extension remains.)
export async function grantNewAccountBenefits(clientId: string, firstInvoiceIssuedAt: Date): Promise<void> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { validUntil: true } });
  if (client?.validUntil) return;

  await db.client.update({
    where: { id: clientId },
    data: { validUntil: addQuarter(firstInvoiceIssuedAt) },
  });
}

// Call after creating any invoice (POST /api/invoices, POST
// /api/invoices/recharge-request) — checks whether it was the client's
// first ever invoice and, if so, anchors validity + the free grant off it.
// A no-op for every invoice after the first.
export async function maybeGrantOnFirstInvoice(clientId: string, invoiceIssuedAt: Date): Promise<void> {
  const invoiceCount = await db.invoice.count({ where: { clientId } });
  if (invoiceCount !== 1) return; // not the first invoice for this client
  await grantNewAccountBenefits(clientId, invoiceIssuedAt);
}

// Extends a client's validity by 3 months, from whichever is later: their
// current validUntil (if it's still in the future — renewing early doesn't
// waste remaining time) or the invoice's payment date.
export async function renewValidityForPaidInvoice(clientId: string, paidAt: Date): Promise<Date> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { validUntil: true } });
  const base = client?.validUntil && client.validUntil > paidAt ? client.validUntil : paidAt;
  const newValidUntil = addQuarter(base);

  await db.client.update({ where: { id: clientId }, data: { validUntil: newValidUntil } });
  return newValidUntil;
}
