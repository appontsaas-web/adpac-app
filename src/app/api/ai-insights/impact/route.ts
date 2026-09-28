import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getClientAccess, canEdit } from '@/lib/access';
import { db } from '@/lib/db';
import { getOptimizationRatePercent } from '@/lib/tokens';

// GET /api/ai-insights/impact?clientId=xxx
//
// Showcase-only metric for the AI Insights panel, broken down by calendar
// month so months can be compared side by side (e.g. "July: 3%, $X" vs.
// "August: 4.5%, $Y"). Always starts at July 2026 (when AI optimization
// tracking begins for this showcase) and runs through the current month —
// the range grows on its own each month rather than being picked by the
// user. Per month:
//   - totalConversionValueCents is real — summed straight from DailyMetric
//     for the client's campaigns over that calendar month.
//   - optimizationRatePercent is NOT a measured figure; there's no real
//     attribution model yet for how much of a client's results are
//     specifically due to AI-approved changes vs. everything else. It's a
//     deterministic pseudo-random value in the 3-6% range, seeded from
//     clientId+month so the same month always shows the same number instead
//     of jumping around on every reload — but it is still a placeholder, not
//     a computed result. An admin can override any month's rate directly
//     (see PUT /api/ai-insights/impact/override) — those take precedence
//     over the placeholder. This route delegates the override-or-placeholder
//     lookup to getOptimizationRatePercent in lib/tokens.ts, shared with
//     ensureDailySpend so the rate used for token spend math always matches
//     the rate shown here. Swap the placeholder itself out for something
//     derived from lib/aiInsights.ts's computeOutcomes() (the real
//     before/after tracking already built there) before this is ever shown
//     to a real client without an override set.
//   - tokensSpent is a read-only rollup, NOT recomputed here — token spend
//     is driven by ensureDailySpend in lib/tokens.ts (triggered from
//     /api/metrics/sync), which locks in each day's tokens using the
//     impact value as the basis, distributed across days by that day's
//     share of month-to-date ad spend. This just sums that month's already
//     locked-in daily SPEND transactions for display.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  if (!canEdit(await getClientAccess(me, clientId))) {
    return NextResponse.json({ error: 'Edit access required for this client' }, { status: 403 });
  }

  const campaigns = await db.campaign.findMany({ where: { clientId }, select: { id: true } });
  const campaignIds = campaigns.map((c) => c.id);

  // Build calendar-month windows from July 2026 through the current month,
  // oldest first (so a table/chart reads left-to-right chronologically).
  const now = new Date();
  const trackingStart = new Date(2026, 6, 1); // July 2026 (month is 0-indexed)
  const monthsElapsed =
    (now.getFullYear() - trackingStart.getFullYear()) * 12 + (now.getMonth() - trackingStart.getMonth());
  const windows: { monthKey: string; label: string; start: Date; end: Date }[] = [];
  for (let i = 0; i <= Math.max(0, monthsElapsed); i++) {
    const start = new Date(trackingStart.getFullYear(), trackingStart.getMonth() + i, 1);
    const end = new Date(trackingStart.getFullYear(), trackingStart.getMonth() + i + 1, 0, 23, 59, 59, 999);
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    const label = start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    windows.push({ monthKey, label, start, end });
  }

  const overrides = await db.aiImpactOverride.findMany({
    where: { clientId, monthKey: { in: windows.map((w) => w.monthKey) } },
  });
  const overrideMonths = new Set(overrides.map((o) => o.monthKey));

  // Read-only rollup of daily SPEND transactions (see ensureDailySpend in
  // lib/tokens.ts) grouped by month, for display alongside impact value.
  const spendRows = await db.tokenTransaction.findMany({
    where: { clientId, type: 'SPEND', dayKey: { not: null } },
    select: { dayKey: true, tokens: true },
  });
  const spentByMonth = new Map<string, number>();
  for (const row of spendRows) {
    const monthKey = row.dayKey!.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
    spentByMonth.set(monthKey, (spentByMonth.get(monthKey) ?? 0) - row.tokens); // tokens stored negative
  }

  const results = await Promise.all(
    windows.map(async ({ monthKey, label, start, end }) => {
      const totalConversionValueCents = campaignIds.length
        ? (
            await db.dailyMetric.aggregate({
              where: { campaignId: { in: campaignIds }, date: { gte: start, lte: end } },
              _sum: { conversionValueCents: true },
            })
          )._sum.conversionValueCents ?? 0
        : 0;

      const optimizationRatePercent = await getOptimizationRatePercent(clientId, monthKey);
      const isOverride = overrideMonths.has(monthKey);
      const impactValueCents = Math.round(totalConversionValueCents * (optimizationRatePercent / 100));
      const tokensSpent = spentByMonth.get(monthKey) ?? 0;

      return { monthKey, label, totalConversionValueCents, optimizationRatePercent, impactValueCents, isOverride, tokensSpent };
    })
  );

  return NextResponse.json({ months: results });
}
