import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewReporting } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/metrics/pacing?googleAdsAccountId=xxx
// Budget pacing for the CURRENT calendar month — deliberately not affected
// by the dashboard's own date-range picker (7d/30d/custom), since "pacing"
// only means anything relative to a real billing month. For each
// non-removed campaign with a daily budget set: month-to-date spend (from
// the existing, already-synced DailyMetric — no new Google Ads API call),
// the monthly budget implied by dailyBudgetCents × days in this month,
// the "expected" MTD spend if pacing exactly on budget (monthlyBudget ×
// days elapsed ÷ days in month), and a naive projected end-of-month total
// (today's daily average × days in month) so a campaign that's going to
// blow through or badly underspend its budget shows up well before the
// 30th, not after.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const googleAdsAccountId = req.nextUrl.searchParams.get('googleAdsAccountId');
  if (!googleAdsAccountId) {
    return NextResponse.json({ error: 'googleAdsAccountId is required' }, { status: 400 });
  }

  const account = await db.googleAdsAccount.findUnique({ where: { id: googleAdsAccountId } });
  if (!account) return NextResponse.json({ error: 'Google Ads account not found' }, { status: 404 });
  if (!(await canViewReporting(me, account.clientId))) {
    return NextResponse.json({ error: 'Reporting access required for this client' }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate(); // today counts as elapsed — its partial spend is still real spend
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const campaigns = await db.campaign.findMany({
    where: { googleAdsAccountId, status: { notIn: ['REJECTED'] } },
    select: { id: true, name: true, status: true, dailyBudgetCents: true, hiddenFromList: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const metrics = campaignIds.length
    ? await db.dailyMetric.findMany({
        where: { campaignId: { in: campaignIds }, date: { gte: monthStart, lte: todayEnd } },
        select: { campaignId: true, costCents: true },
      })
    : [];
  const spendByCampaign = new Map<string, number>();
  for (const m of metrics) {
    spendByCampaign.set(m.campaignId, (spendByCampaign.get(m.campaignId) ?? 0) + m.costCents);
  }

  const rows = campaigns
    .filter((c) => c.status === 'LIVE' && !c.hiddenFromList && c.dailyBudgetCents > 0)
    .map((c) => {
      const monthToDateSpendCents = spendByCampaign.get(c.id) ?? 0;
      const monthlyBudgetCents = c.dailyBudgetCents * daysInMonth;
      const expectedSpendCents = Math.round((monthlyBudgetCents * daysElapsed) / daysInMonth);
      const projectedEndOfMonthCents = Math.round((monthToDateSpendCents / daysElapsed) * daysInMonth);
      const pacePct = expectedSpendCents > 0 ? (monthToDateSpendCents / expectedSpendCents) * 100 : null;
      return {
        campaignId: c.id,
        name: c.name,
        dailyBudgetCents: c.dailyBudgetCents,
        monthlyBudgetCents,
        monthToDateSpendCents,
        expectedSpendCents,
        projectedEndOfMonthCents,
        pacePct, // 100 = exactly on pace; >100 = overspending pace; <100 = underspending pace
      };
    })
    .sort((a, b) => b.monthToDateSpendCents - a.monthToDateSpendCents);

  const totals = rows.reduce(
    (acc, r) => {
      acc.monthlyBudgetCents += r.monthlyBudgetCents;
      acc.monthToDateSpendCents += r.monthToDateSpendCents;
      acc.expectedSpendCents += r.expectedSpendCents;
      acc.projectedEndOfMonthCents += r.projectedEndOfMonthCents;
      return acc;
    },
    { monthlyBudgetCents: 0, monthToDateSpendCents: 0, expectedSpendCents: 0, projectedEndOfMonthCents: 0 }
  );

  return NextResponse.json({
    monthLabel: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    daysElapsed,
    daysInMonth,
    campaigns: rows,
    totals,
  });
}
