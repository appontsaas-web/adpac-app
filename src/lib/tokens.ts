import { db } from './db';
import { isStarterBundleInvoice } from './validity';

// Prepaid token credit system.
//
// - TokenSetting is a single global row (id "global") holding the current
//   tokensPerDollar conversion rate, admin-editable via PUT /api/token-settings.
// - TokenTransaction is an append-only ledger per client. A client's token
//   balance is always the sum of their TokenTransaction.tokens — never a
//   mutable counter field — so the full history stays auditable, same
//   spirit as ActionLog.
// - Invoices drive the ledger automatically (see PATCH /api/invoices/[id]):
//   marking an invoice PAID creates a TOPUP; unmarking it creates a REVERSAL
//   that nets that invoice's contribution back to zero.
// - Spending is driven by the AI optimization impact value (same figure
//   shown on the Impact card: that month's total conversion value × the
//   optimization rate for that month), but distributed across days instead
//   of charged as one monthly lump sum — see ensureDailySpend below, called
//   from /api/metrics/sync. A day's token spend is that day's share of the
//   month-to-date ad spend, applied to the month-to-date impact value: a
//   day with more real ad spend that month gets charged proportionally
//   more tokens than a light day, even though both derive from the same
//   underlying monthly impact figure. (Two earlier versions existed: one
//   locked in a single lump sum per month, another spent tokens on raw ad
//   spend with no impact-value basis at all — both were reversed; see the
//   TokenTransaction.monthKey comment in schema.prisma.)

const TOKEN_SETTING_ID = 'global';

// Every $0.50 (50 cents) of (month-to-date impact value, that day's share)
// spends 1 token — see ensureDailySpend.
const SPEND_CENTS_PER_TOKEN = 50;

export async function getTokensPerDollar(): Promise<number> {
  const setting = await db.tokenSetting.findUnique({ where: { id: TOKEN_SETTING_ID } });
  return setting?.tokensPerDollar ?? 5;
}

export async function setTokensPerDollar(rate: number, userId?: string) {
  return db.tokenSetting.upsert({
    where: { id: TOKEN_SETTING_ID },
    create: { id: TOKEN_SETTING_ID, tokensPerDollar: rate, updatedByUserId: userId ?? null },
    update: { tokensPerDollar: rate, updatedByUserId: userId ?? null },
  });
}

export async function getClientTokenBalance(clientId: string): Promise<number> {
  const agg = await db.tokenTransaction.aggregate({
    where: { clientId },
    _sum: { tokens: true },
  });
  return agg._sum.tokens ?? 0;
}

// Net tokens already credited/reversed for a specific invoice (0 if none,
// or if a prior TOPUP was fully reversed) — used to size a REVERSAL so it
// exactly cancels out that invoice's contribution regardless of any rate
// change since the original TOPUP.
export async function getInvoiceTokenNet(invoiceId: string): Promise<number> {
  const agg = await db.tokenTransaction.aggregate({
    where: { invoiceId },
    _sum: { tokens: true },
  });
  return agg._sum.tokens ?? 0;
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC
}

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Shared with GET /api/ai-insights/impact, which used to duplicate this
// hash inline — the two must stay identical, since ensureDailySpend's token
// math and the Impact card's displayed rate need to agree on the same
// number for the same client+month. An explicit AiImpactOverride for that
// client+month always wins; otherwise falls back to a deterministic
// pseudo-random value in [3, 6], seeded from clientId+month so it's stable
// across reloads without being a real measured figure.
export async function getOptimizationRatePercent(clientId: string, monthKey: string): Promise<number> {
  const override = await db.aiImpactOverride.findUnique({
    where: { clientId_monthKey: { clientId, monthKey } },
  });
  if (override) return override.optimizationRatePercent;

  const seed = `${clientId}:${monthKey}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return Math.round((3 + (hash % 301) / 100) * 100) / 100; // 3.00–6.00
}

// Ensures exactly one SPEND transaction exists for this client+day. The
// basis is the AI optimization impact value — same figure as the Impact
// card (month-to-date conversion value × that month's optimization rate) —
// not raw ad spend. Ad spend is only used to weight how that month's
// impact-value total is split across days: this day's tokens are that
// day's share of month-to-date ad spend, applied to the month-to-date
// impact value (in cents, at 1 token per $0.50 of impact value). A day with
// heavier ad spend that month gets charged proportionally more tokens than
// a light day, even on the same month-to-date impact total.
//
// Called from POST /api/metrics/sync right after a day's DailyMetric rows
// are synced — the first call for a given day locks it in using whatever
// month-to-date totals are known at that moment (even for today, mid-month,
// while more spend and conversion value could still come in for later
// days — that's expected: each day is locked in with the data available
// when it's synced, and is NOT retroactively adjusted as later days add
// more to the month-to-date totals). Every call after that for the same day
// is a no-op. Sums across ALL of the client's campaigns (not just one
// Google Ads account), since spend and impact are tracked per client.
//
// createdAt is backdated to the day itself (or "now", if the day is today
// and that's earlier than end-of-day) so the ledger reads as having
// happened on the actual ad-spend date, not whenever this sync ran.
//
// Returns the tokens spent for this day either way (existing or just
// created), so callers can surface it without a second query. Returns 0
// (and records nothing) for a day with no real ad spend yet, OR for a day
// before the client's first invoice.
//
// That first-invoice floor matters because DailyMetric can hold ad-spend
// history from well before the client's paying relationship with AdPac
// began — e.g. a "Backfill 12 months" sync pulls whatever performance
// history Google Ads has for the connected account, which can reach back
// past when the client actually signed up. Without this guard, a sync like
// that would charge tokens for years of ad spend that happened before the
// client ever had a token balance to spend from (this is exactly what
// happened to Louzan Abaya on 2026-09-25: a 12-month backfill created 216
// SPEND rows back to 2025-09-24, nine months before their 2026-07-11 first
// invoice, and had to be cleaned up by hand).
export async function ensureDailySpend(clientId: string, date: Date): Promise<number> {
  const dayKey = dayKeyOf(date);
  const existing = await db.tokenTransaction.findFirst({
    where: { clientId, dayKey, type: 'SPEND' },
  });
  if (existing) return -existing.tokens; // stored as a negative debit; return the positive "spent" amount

  const firstInvoice = await db.invoice.findFirst({
    where: { clientId },
    orderBy: { issuedAt: 'asc' },
    select: { issuedAt: true },
  });
  if (!firstInvoice || dayKey < dayKeyOf(firstInvoice.issuedAt)) return 0;

  const campaigns = await db.campaign.findMany({ where: { clientId }, select: { id: true } });
  const campaignIds = campaigns.map((c) => c.id);
  if (campaignIds.length === 0) return 0;

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  // That day's own ad spend — nothing to lock in yet if this day has none.
  const dayAgg = await db.dailyMetric.aggregate({
    where: { campaignId: { in: campaignIds }, date: { gte: dayStart, lte: dayEnd } },
    _sum: { costCents: true },
  });
  const dayCostCents = dayAgg._sum.costCents ?? 0;
  if (dayCostCents <= 0) return 0; // nothing to record yet for this day

  // Month-to-date totals: from the 1st of this day's month through the end
  // of this day (inclusive) — the same window used for the Impact card's
  // monthly rollup, just truncated to "so far this month" instead of the
  // full month.
  const monthKey = monthKeyOf(date);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const mtdAgg = await db.dailyMetric.aggregate({
    where: { campaignId: { in: campaignIds }, date: { gte: monthStart, lte: dayEnd } },
    _sum: { costCents: true, conversionValueCents: true },
  });
  const totalCostMTDCents = mtdAgg._sum.costCents ?? 0;
  const totalConversionValueMTDCents = mtdAgg._sum.conversionValueCents ?? 0;
  if (totalCostMTDCents <= 0) return 0; // guard — shouldn't happen since dayCostCents > 0 is included in this sum

  const ratePercent = await getOptimizationRatePercent(clientId, monthKey);
  const impactValueMTDCents = Math.round(totalConversionValueMTDCents * (ratePercent / 100));
  const monthTokensMTD = impactValueMTDCents / SPEND_CENTS_PER_TOKEN;
  const dayShare = dayCostCents / totalCostMTDCents;
  const tokensSpent = monthTokensMTD * dayShare;

  const now = new Date();
  const createdAt = dayEnd < now ? dayEnd : now;

  await db.tokenTransaction.create({
    data: {
      clientId,
      monthKey,
      dayKey,
      type: 'SPEND',
      tokens: -tokensSpent,
      note: `Impact-value spend for ${dayKey}: month-to-date impact $${(impactValueMTDCents / 100).toFixed(2)} (rate ${ratePercent.toFixed(2)}%) × day share ${(dayShare * 100).toFixed(1)}% of MTD ad spend ($${(dayCostCents / 100).toFixed(2)} of $${(totalCostMTDCents / 100).toFixed(2)})`,
      createdAt,
    },
  });
  return tokensSpent;
}

// Re-derives a client's entire token ledger from CURRENT inputs — the
// explicit "catch it up" action behind the admin Refresh button (see
// POST /api/clients/[id]/tokens/recompute). Several things in this file are
// deliberately NOT retroactive on their own: changing the global
// tokensPerDollar rate only affects invoices marked paid afterward, and an
// edited AiImpactOverride only affects days not yet synced (see the
// ensureDailySpend comment above) — both by the same "lock it in once"
// ledger philosophy. This function is the deliberate override of that: call
// it after editing the rate, an override, or an invoice, and it rebuilds
// everything to match what's on file right now.
//
// Two things stay untouched on purpose: FREE_GRANT (a one-time historical
// fact — 5000 tokens dated off the first invoice, not rate-dependent) and
// Client.validUntil (validity is a date, not a token amount — nothing here
// would change it). Everything else is fully rebuilt:
//
//   - TOPUP: every PAID invoice is reset to a single, correct contribution —
//     any existing TOPUP/REVERSAL rows tied to that invoice are deleted (so
//     a past mark/unmark/remark cycle can't leave stale duplicates behind)
//     and, unless the invoice is a Starter Bundle (validity-only — see
//     isStarterBundleInvoice), recreated as amountCents × the CURRENT
//     tokensPerDollar rate, backdated to the invoice's paidAt. Re-running
//     this is safe — it always converges on the same correct value.
//   - SPEND: every existing row for the client is deleted, then
//     ensureDailySpend is called for every day from the client's first
//     invoice through today. Since nothing is locked in anymore (it was
//     just deleted), each call re-locks that day fresh using whatever
//     AiImpactOverride rate is on file NOW, instead of the day being a
//     no-op against its old locked-in value.
export async function recomputeClientTokens(
  clientId: string
): Promise<{ invoicesReconciled: number; daysRelocked: number; balance: number }> {
  const rate = await getTokensPerDollar();

  const paidInvoices = await db.invoice.findMany({
    where: { clientId, status: 'PAID' },
    select: { id: true, invoiceNumber: true, amountCents: true, paidAt: true, description: true },
  });

  let invoicesReconciled = 0;
  for (const inv of paidInvoices) {
    const existingRows = await db.tokenTransaction.findMany({
      where: { invoiceId: inv.id, type: { in: ['TOPUP', 'REVERSAL'] } },
    });
    for (const row of existingRows) {
      await db.tokenTransaction.delete({ where: { id: row.id } });
    }

    if (isStarterBundleInvoice(inv.description)) continue; // validity-only — no TOPUP

    const tokens = (inv.amountCents / 100) * rate;
    await db.tokenTransaction.create({
      data: {
        clientId,
        invoiceId: inv.id,
        type: 'TOPUP',
        tokens,
        note: `Invoice ${inv.invoiceNumber} repriced at current rate (${rate} tokens/$)`,
        createdAt: inv.paidAt ?? new Date(),
      },
    });
    invoicesReconciled++;
  }

  // Wipe and rebuild the whole SPEND history day by day — see the doc
  // comment above for why deleting first (rather than calling
  // ensureDailySpend directly) is what makes this actually pick up new
  // AiImpactOverride rates instead of hitting the existing-row no-op.
  await db.tokenTransaction.deleteMany({ where: { clientId, type: 'SPEND' } });

  const firstInvoice = await db.invoice.findFirst({
    where: { clientId },
    orderBy: { issuedAt: 'asc' },
    select: { issuedAt: true },
  });

  let daysRelocked = 0;
  if (firstInvoice) {
    const todayCap = new Date();
    todayCap.setHours(23, 59, 59, 999);
    const cursor = new Date(firstInvoice.issuedAt);
    while (cursor <= todayCap) {
      const spent = await ensureDailySpend(clientId, new Date(cursor));
      if (spent > 0) daysRelocked++;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const balance = await getClientTokenBalance(clientId);
  return { invoicesReconciled, daysRelocked, balance };
}
