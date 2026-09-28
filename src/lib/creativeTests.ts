import { db } from './db';
import type { CreativeTest, CreativeTestVariant } from '@prisma/client';

// ---------------------------------------------------------------------------
// Creative A/B testing — compares 2+ existing ads (already living in the
// SAME ad group / ad set, so they're genuinely splitting the same traffic)
// using performance already being synced into AdMetric / MetaAdMetric. No
// new Google Ads/Meta API calls are needed to read variant performance —
// this only aggregates rows already on disk.
//
// Winner determination is deterministic statistics (a two-proportion
// z-test), never an LLM call — same reasoning as the rest of
// lib/aiInsights.ts's doc comment: arithmetic belongs in plain TypeScript,
// not a model's judgment. generateAbTestInsights() below is the one place
// this creates a PENDING_APPROVAL ActionLog row; nothing here ever calls
// setAdStatus directly — see /api/creative-tests/winners/[id]/approve for
// the one place an approved winner actually pauses the loser.
// ---------------------------------------------------------------------------

const MIN_TEST_DAYS = 3; // don't call a winner off a couple of noisy hours
const MIN_CLICKS_FOR_CONVERSION_METRIC = 50; // per variant
const MIN_TOTAL_CONVERSIONS_FOR_CONVERSION_METRIC = 10; // across all variants combined
const MIN_IMPRESSIONS_FOR_CTR_METRIC = 1000; // per variant, fallback metric when conversion volume is too low
const SIGNIFICANCE_P = 0.05;

export interface VariantStats {
  adId: string;
  label: string;
  adGroupId: string | null;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  ctr: number;
  conversionRate: number;
}

export type TestMetric = 'CONVERSION_RATE' | 'CTR';

export interface TestEvaluation {
  hasWinner: boolean;
  reason: string; // always set — either why there's no winner yet, or a summary of the winning comparison
  metric?: TestMetric;
  pValue?: number; // the worst (largest, i.e. least significant) pairwise p-value between the winner and every loser
  winnerAdId?: string;
  winnerLabel?: string;
  loserVariants?: { adId: string; label: string }[];
  variantStats: VariantStats[];
}

/** Pulls every AdMetric/MetaAdMetric row for this test's variants dated on/after the test's startedAt, and sums them per variant. */
export async function aggregateVariantStats(
  test: CreativeTest & { variants: CreativeTestVariant[] }
): Promise<VariantStats[]> {
  const adIds = test.variants.map((v) => v.adId);
  if (adIds.length === 0) return [];

  const rows =
    test.platform === 'GOOGLE_ADS'
      ? await db.adMetric.findMany({
          where: { campaignId: test.campaignId!, adId: { in: adIds }, date: { gte: test.startedAt } },
        })
      : await db.metaAdMetric.findMany({
          where: { campaignId: test.metaCampaignId!, adId: { in: adIds }, date: { gte: test.startedAt } },
        });

  const byAdId = new Map<string, { impressions: number; clicks: number; costCents: number; conversions: number }>();
  for (const r of rows) {
    const existing = byAdId.get(r.adId) ?? { impressions: 0, clicks: 0, costCents: 0, conversions: 0 };
    existing.impressions += r.impressions;
    existing.clicks += r.clicks;
    existing.costCents += r.costCents;
    existing.conversions += r.conversions;
    byAdId.set(r.adId, existing);
  }

  return test.variants.map((v) => {
    const agg = byAdId.get(v.adId) ?? { impressions: 0, clicks: 0, costCents: 0, conversions: 0 };
    return {
      adId: v.adId,
      label: v.label,
      adGroupId: v.adGroupId,
      impressions: agg.impressions,
      clicks: agg.clicks,
      costCents: agg.costCents,
      conversions: agg.conversions,
      ctr: agg.impressions > 0 ? agg.clicks / agg.impressions : 0,
      conversionRate: agg.clicks > 0 ? agg.conversions / agg.clicks : 0,
    };
  });
}

// Standard normal CDF via the Abramowitz-Stegun erf approximation (accurate
// to ~1.5e-7) — no stats library needed for a two-proportion z-test.
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

/** Two-proportion z-test (pooled), two-tailed. x = successes (clicks or conversions), n = trials (impressions or clicks). Returns the p-value. */
export function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 1;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (p1 - p2) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/**
 * Decides whether this test has a statistically significant winner yet.
 * Prefers conversion rate (the metric that actually matters) once there's
 * enough volume; falls back to CTR — a real but weaker signal — when
 * conversion volume is too thin to trust. Never calls out a winner before
 * MIN_TEST_DAYS has elapsed, even with enough raw volume, since early days
 * of a test are disproportionately affected by day-of-week noise.
 */
export function evaluateTest(test: CreativeTest, stats: VariantStats[]): TestEvaluation {
  if (stats.length < 2) return { hasWinner: false, reason: 'Fewer than 2 variants have data', variantStats: stats };

  const daysRunning = (Date.now() - test.startedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysRunning < MIN_TEST_DAYS) {
    return { hasWinner: false, reason: `Only ${daysRunning.toFixed(1)} day(s) into the test — waiting for at least ${MIN_TEST_DAYS}`, variantStats: stats };
  }

  const totalConversions = stats.reduce((a, s) => a + s.conversions, 0);
  const allHaveEnoughClicks = stats.every((s) => s.clicks >= MIN_CLICKS_FOR_CONVERSION_METRIC);

  let metric: TestMetric;
  let getX: (s: VariantStats) => number;
  let getN: (s: VariantStats) => number;

  if (allHaveEnoughClicks && totalConversions >= MIN_TOTAL_CONVERSIONS_FOR_CONVERSION_METRIC) {
    metric = 'CONVERSION_RATE';
    getX = (s) => s.conversions;
    getN = (s) => s.clicks;
  } else if (stats.every((s) => s.impressions >= MIN_IMPRESSIONS_FOR_CTR_METRIC)) {
    metric = 'CTR';
    getX = (s) => s.clicks;
    getN = (s) => s.impressions;
  } else {
    return { hasWinner: false, reason: 'Not enough traffic yet on one or more variants', variantStats: stats };
  }

  const withRate = stats.map((s) => ({ s, rate: getN(s) > 0 ? getX(s) / getN(s) : 0 }));
  withRate.sort((a, b) => b.rate - a.rate);
  const best = withRate[0];
  const rest = withRate.slice(1);

  let worstP = 0;
  for (const other of rest) {
    const p = twoProportionPValue(getX(best.s), getN(best.s), getX(other.s), getN(other.s));
    worstP = Math.max(worstP, p);
  }

  if (worstP >= SIGNIFICANCE_P) {
    return {
      hasWinner: false,
      reason: `No statistically significant difference yet (${metric === 'CONVERSION_RATE' ? 'conversion rate' : 'CTR'}, worst pairwise p=${worstP.toFixed(3)})`,
      metric,
      pValue: worstP,
      variantStats: stats,
    };
  }

  return {
    hasWinner: true,
    reason: `${best.s.label} beats every other variant on ${metric === 'CONVERSION_RATE' ? 'conversion rate' : 'CTR'} (worst pairwise p=${worstP.toFixed(3)})`,
    metric,
    pValue: worstP,
    winnerAdId: best.s.adId,
    winnerLabel: best.s.label,
    loserVariants: rest.map((r) => ({ adId: r.s.adId, label: r.s.label })),
    variantStats: stats,
  };
}

export interface AbTestWinnerPayload {
  type: 'AB_TEST_WINNER';
  testId: string;
  testName: string;
  metric: TestMetric;
  pValue: number;
  winnerAdId: string;
  winnerLabel: string;
  loserVariants: { adId: string; label: string }[];
  summary: string;
  rationale: string;
  variantStats: VariantStats[];
}

/**
 * Evaluates every RUNNING CreativeTest and, for any that just reached
 * significance, creates a PENDING_APPROVAL ActionLog (actionType
 * 'AB_TEST_WINNER') and flips the test to WINNER_FOUND so it isn't
 * re-evaluated (and re-alerted) every cycle. Meant to be called from the
 * same scheduler cycle as generateInsights/Meta insights — see
 * /api/creative-tests/evaluate and lib/scheduler.ts.
 */
export async function generateAbTestInsights(): Promise<{ created: number; evaluated: number }> {
  const tests = await db.creativeTest.findMany({ where: { status: 'RUNNING' }, include: { variants: true } });
  let created = 0;

  for (const test of tests) {
    if (test.variants.length < 2) continue;
    const stats = await aggregateVariantStats(test);
    const result = evaluateTest(test, stats);
    if (!result.hasWinner || !result.winnerAdId || !result.winnerLabel || !result.loserVariants || !result.metric || result.pValue === undefined) {
      continue;
    }

    const winner = stats.find((s) => s.adId === result.winnerAdId)!;
    const metricLabel = result.metric === 'CONVERSION_RATE' ? 'conversion rate' : 'CTR';
    const winnerRate = result.metric === 'CONVERSION_RATE' ? winner.conversionRate : winner.ctr;
    const payload: AbTestWinnerPayload = {
      type: 'AB_TEST_WINNER',
      testId: test.id,
      testName: test.name,
      metric: result.metric,
      pValue: result.pValue,
      winnerAdId: result.winnerAdId,
      winnerLabel: result.winnerLabel,
      loserVariants: result.loserVariants,
      summary: `"${test.name}": variant ${result.winnerLabel} is the statistically significant winner (${metricLabel} ${(winnerRate * 100).toFixed(2)}%)`,
      rationale: `${result.reason}. Approving will pause the losing variant(s): ${result.loserVariants.map((v) => v.label).join(', ')}.`,
      variantStats: stats,
    };

    await db.actionLog.create({
      data: {
        clientId: test.clientId,
        campaignId: test.platform === 'GOOGLE_ADS' ? test.campaignId : null,
        metaCampaignId: test.platform === 'META' ? test.metaCampaignId : null,
        creativeTestId: test.id,
        actionType: 'AB_TEST_WINNER',
        payloadJson: JSON.stringify(payload),
        status: 'PENDING_APPROVAL',
        proposedBy: 'ai',
      },
    });
    await db.creativeTest.update({ where: { id: test.id }, data: { status: 'WINNER_FOUND' } });
    created++;
  }

  return { created, evaluated: tests.length };
}
