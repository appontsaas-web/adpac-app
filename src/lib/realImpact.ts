import { db } from './db';

// ---------------------------------------------------------------------------
// Real-measured AI impact — an alternative to the placeholder-based Impact
// card (see /api/ai-insights/impact, AIImpactCard.tsx). That card applies a
// pseudo-random "optimization rate" to a client's total conversion value;
// this one instead sums up the actual, day-by-day measured effect of every
// AI insight a human has approved, using the same before/after data already
// shown per-insight in AIInsightsPanel (signalSnapshot + real DailyMetric
// rows since execution). Deliberately kept as a SEPARATE card/route rather
// than replacing the existing one, so both can be shown side by side and
// compared before deciding which one to keep — see AIImpactCard.tsx and
// RealAIImpactCard.tsx.
//
// Method, per executed insight (ADJUST_BUDGET / PAUSE_CAMPAIGN /
// REWRITE_AD_COPY / ADD_NEGATIVE_KEYWORDS / REALLOCATE_BUDGET /
// ADJUST_BID_MODIFIER — ANOMALY_ALERT is excluded, it's informational and
// proposes no change to measure):
//   1. Baseline = signalSnapshot.last7dAvgDailyConversions, frozen at the
//      moment the insight was approved (same number AIInsightsPanel already
//      shows as "before"). An insight approved before signalSnapshot existed
//      has no baseline and is excluded — counted separately as unmeasurable
//      rather than guessed at.
//   2. For each day of real DailyMetric data synced since execution, delta =
//      that day's actual conversions minus the baseline. This can be
//      negative — a change that didn't help shows as a real loss here, not
//      hidden, which is the whole point of this being the "real" version.
//   3. Each day's delta is monetized using that campaign's own all-time
//      average value per conversion (totalConversionValueCents /
//      totalConversions), not the placeholder's blended total-conversion-
//      value-times-a-rate approach.
//   4. Attribution window per insight is capped at the NEXT insight executed
//      on the same campaign (or today, if there isn't one yet) — otherwise
//      two changes close together on the same campaign would double-count
//      the same days' results. This is a real, disclosed limitation: it
//      can't separate which of two overlapping changes actually drove a
//      result, so it just stops crediting the earlier one once a later one
//      starts.
//   5. Each day's monetized delta is bucketed into the calendar month it
//      actually happened in (not the month the insight was approved), same
//      window as the placeholder card (July 2026 - present) for side-by-side
//      comparison.
// ---------------------------------------------------------------------------

const AI_INSIGHT_TYPES = [
  'ADJUST_BUDGET',
  'PAUSE_CAMPAIGN',
  'REWRITE_AD_COPY',
  'ADD_NEGATIVE_KEYWORDS',
  'REALLOCATE_BUDGET',
  'ADJUST_BID_MODIFIER',
]; // ANOMALY_ALERT deliberately excluded — see doc comment above

export interface RealImpactMonth {
  monthKey: string;
  label: string;
  measuredImpactValueCents: number;
  insightsContributing: number; // distinct insights with at least one day of data landing in this month
}

export interface RealImpactSummary {
  months: RealImpactMonth[];
  totalMeasuredImpactValueCents: number;
  insightsMeasured: number; // had a baseline AND at least one day of post-execution data
  insightsPending: number; // had a baseline but no post-execution data synced yet
  insightsUnmeasurable: number; // executed before signalSnapshot existed — no baseline to compare against
}

export async function computeRealImpact(clientId: string): Promise<RealImpactSummary> {
  const logs = await db.actionLog.findMany({
    where: { clientId, actionType: { in: AI_INSIGHT_TYPES }, status: 'EXECUTED', campaignId: { not: null }, executedAt: { not: null } },
    orderBy: { executedAt: 'asc' },
    select: { id: true, campaignId: true, executedAt: true, payloadJson: true },
  });

  // Build calendar-month windows the same way the placeholder Impact card
  // does — July 2026 through the current month — so the two cards line up
  // for side-by-side comparison.
  const now = new Date();
  const trackingStart = new Date(2026, 6, 1);
  const monthsElapsed = (now.getFullYear() - trackingStart.getFullYear()) * 12 + (now.getMonth() - trackingStart.getMonth());
  const monthWindows: { monthKey: string; label: string }[] = [];
  for (let i = 0; i <= Math.max(0, monthsElapsed); i++) {
    const start = new Date(trackingStart.getFullYear(), trackingStart.getMonth() + i, 1);
    monthWindows.push({
      monthKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    });
  }
  const monthlyTotals = new Map<string, { valueCents: number; insightIds: Set<string> }>();
  for (const w of monthWindows) monthlyTotals.set(w.monthKey, { valueCents: 0, insightIds: new Set() });

  if (logs.length === 0) {
    return {
      months: monthWindows.map((w) => ({ monthKey: w.monthKey, label: w.label, measuredImpactValueCents: 0, insightsContributing: 0 })),
      totalMeasuredImpactValueCents: 0,
      insightsMeasured: 0,
      insightsPending: 0,
      insightsUnmeasurable: 0,
    };
  }

  // Group by campaign, sorted by executedAt, to compute each insight's
  // non-overlapping attribution window (see doc comment above).
  const byCampaign = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = byCampaign.get(log.campaignId as string) ?? [];
    list.push(log);
    byCampaign.set(log.campaignId as string, list);
  }

  // Average value per conversion per campaign, computed once from all-time
  // DailyMetric — the monetization basis for every insight on that campaign.
  const campaignIds = Array.from(byCampaign.keys());
  const avgValuePerConversionCents = new Map<string, number>();
  for (const campaignId of campaignIds) {
    const agg = await db.dailyMetric.aggregate({
      where: { campaignId },
      _sum: { conversions: true, conversionValueCents: true },
    });
    const totalConversions = agg._sum.conversions ?? 0;
    const totalValue = agg._sum.conversionValueCents ?? 0;
    avgValuePerConversionCents.set(campaignId, totalConversions > 0 ? totalValue / totalConversions : 0);
  }

  let insightsMeasured = 0;
  let insightsPending = 0;
  let insightsUnmeasurable = 0;

  for (const [campaignId, campaignLogs] of byCampaign) {
    const valuePerConversion = avgValuePerConversionCents.get(campaignId) ?? 0;

    for (let i = 0; i < campaignLogs.length; i++) {
      const log = campaignLogs[i];
      const executedAt = log.executedAt as Date;
      const windowEndExclusive = campaignLogs[i + 1]?.executedAt ?? now;

      let baseline: number | null = null;
      try {
        const payload = JSON.parse(log.payloadJson);
        baseline = payload.signalSnapshot?.last7dAvgDailyConversions ?? null;
      } catch {
        /* ignore malformed payload */
      }
      if (baseline === null) {
        insightsUnmeasurable++;
        continue;
      }

      const windowStart = new Date(executedAt);
      windowStart.setHours(0, 0, 0, 0);
      const rows = await db.dailyMetric.findMany({
        where: { campaignId, date: { gte: windowStart, lt: windowEndExclusive } },
        select: { date: true, conversions: true },
      });

      if (rows.length === 0) {
        insightsPending++;
        continue;
      }

      let contributed = false;
      for (const row of rows) {
        const delta = row.conversions - baseline;
        const dayValueCents = delta * valuePerConversion;
        const monthKey = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
        const bucket = monthlyTotals.get(monthKey);
        if (!bucket) continue; // outside the tracked window (e.g. before July 2026) — shouldn't normally happen
        bucket.valueCents += dayValueCents;
        bucket.insightIds.add(log.id);
        contributed = true;
      }
      if (contributed) insightsMeasured++;
      else insightsPending++;
    }
  }

  const months: RealImpactMonth[] = monthWindows.map((w) => {
    const bucket = monthlyTotals.get(w.monthKey)!;
    return {
      monthKey: w.monthKey,
      label: w.label,
      measuredImpactValueCents: Math.round(bucket.valueCents),
      insightsContributing: bucket.insightIds.size,
    };
  });

  return {
    months,
    totalMeasuredImpactValueCents: months.reduce((a, m) => a + m.measuredImpactValueCents, 0),
    insightsMeasured,
    insightsPending,
    insightsUnmeasurable,
  };
}
