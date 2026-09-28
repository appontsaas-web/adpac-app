import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewFinance } from '@/lib/access';
import { db } from '@/lib/db';
import { getTokensPerDollar, getClientTokenBalance } from '@/lib/tokens';

// GET /api/clients/[id]/tokens — a client's current prepaid token balance
// plus its transaction history and the current conversion rate. Gated the
// same way as invoices (canViewFinance): admin always, or STAFF whose
// Position has canViewInvoices.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await canViewFinance(me, params.id))) {
    return NextResponse.json({ error: 'Finance access required for this client' }, { status: 403 });
  }

  // No `take` cap here — a client with months of daily SPEND rows plus
  // TOPUP/REVERSAL history easily exceeds a couple hundred rows, and this is
  // a financial ledger the admin needs full visibility into, not a feed
  // that's fine to truncate. (A cap here previously silently hid everything
  // older than the most recent 50 transactions from the "Show history"
  // table, even though the balance total above was always computed
  // correctly over the full, uncapped history.)
  const [balance, tokensPerDollar, transactionsRaw] = await Promise.all([
    getClientTokenBalance(params.id),
    getTokensPerDollar(),
    db.tokenTransaction.findMany({
      where: { clientId: params.id },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Daily SPEND notes spell out the MTD-proportional formula inputs (rate,
  // month-to-date impact value, ad spend split) — internal pricing detail
  // that isn't meant for staff. Redact that note entirely for non-admins;
  // everything else about the row (date, type, token amount) still shows.
  // TOPUP/REVERSAL notes (e.g. "Invoice 6U437IKL 0053 repriced at current
  // rate (5 tokens/$)", "Invoice X marked paid (5 tokens/$)", "Invoice X
  // unmarked paid") all name the invoice but otherwise describe the pricing
  // mechanics — reduce any of these, for non-admins, to just "Invoice
  // <number>" rather than trying to strip the rate out phrase-by-phrase (an
  // earlier version of this only removed the trailing "(N tokens/$)",
  // leaving "repriced at current rate" behind — still pricing-adjacent
  // wording, not what was asked for). Both stripped server-side (not just
  // hidden in the UI) so neither is visible via the network response either.
  const INVOICE_NOTE = /^Invoice (\S+)/;
  const isAdmin = me.role === 'ADMIN';
  const transactions = isAdmin
    ? transactionsRaw
    : transactionsRaw.map((tx) => {
        if (tx.type === 'SPEND') return { ...tx, note: null };
        const match = tx.note?.match(INVOICE_NOTE);
        if (match) return { ...tx, note: `Invoice ${match[1]}` };
        return tx;
      });

  // The $-per-token conversion rate is pricing/margin detail, admin-only —
  // staff see the resulting balance and history, not the rate that produced
  // it. Omitted server-side (not just hidden in the UI) for the same reason
  // as the SPEND note redaction above.
  return NextResponse.json({ balance, tokensPerDollar: isAdmin ? tokensPerDollar : null, transactions });
}
