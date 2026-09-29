import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';

// ---------------------------------------------------------------------------
// Industry Trend & Analysis — compares one client's ad performance against
// the average of AdPac's OTHER clients sharing the same Client.industry
// value, over the trailing 30 days. This is deliberately scoped to AdPac's
// own client portfolio, not external market research: AdPac has no access
// to any third-party industry-benchmark data source, and claiming otherwise
// would be the same kind of overstatement as the old fake "AI tokens"
// pricing quota. Every number here is computed from real DailyMetric/
// MetaDailyMetric/SnapDailyMetric rows already in the database — Claude's
// only job is writing a short narrative around numbers it's given, same
// split as lib/aiInsights.ts and lib/funnelInsights.ts.
//
// Admin-only (see /api/industry-trends): this aggregates OTHER clients'
// performance data, even though only rounded, unnamed averages are ever
// returned — a staff member scoped to one client shouldn't see numbers
// derived from clients they don't have access to.
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 30;
const MIN_PEER_COUNT = 2; // fewer than this and an "average" is really just one other account

export interface PlatformTotals {
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  ctr: number | null; // clicks / impressions
  cpcCents: number | null; // costCents / clicks
  conversionRate: number | null; // conversions / clicks
  cpaCents: number | null; // costCents / conversions
}

async function computeClientTotals(clientId: string, since: Date, until: Date): Promise<PlatformTotals> {
  const [google, meta, snap] = await Promise.all([
    db.dailyMetric.aggregate({
      _sum: { impressions: true, clicks: true, costCents: true, conversions: true },
      where: { date: { gte: since, lte: until }, campaign: { clientId } },
    }),
    db.metaDailyMetric.aggregate({
      _sum: { impressions: true, clicks: true, costCents: true, conversions: true },
      where: { date: { gte: since, lte: until }, campaign: { adAccount: { clientId } } },
    }),
    db.snapDailyMetric.aggregate({
      _sum: { impressions: true, clicks: true, costCents: true, conversions: true },
      where: { date: { gte: since, lte: until }, campaign: { adAccount: { clientId } } },
    }),
  ]);

  const impressions = (google._sum.impressions ?? 0) + (meta._sum.impressions ?? 0) + (snap._sum.impressions ?? 0);
  const clicks = (google._sum.clicks ?? 0) + (meta._sum.clicks ?? 0) + (snap._sum.clicks ?? 0);
  const costCents = (google._sum.costCents ?? 0) + (meta._sum.costCents ?? 0) + (snap._sum.costCents ?? 0);
  const conversions = (google._sum.conversions ?? 0) + (meta._sum.conversions ?? 0) + (snap._sum.conversions ?? 0);

  return {
    impressions,
    clicks,
    costCents,
    conversions,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpcCents: clicks > 0 ? costCents / clicks : null,
    conversionRate: clicks > 0 ? conversions / clicks : null,
    cpaCents: conversions > 0 ? costCents / conversions : null,
  };
}

function average(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export interface IndustryBenchmark {
  industry: string;
  peerCount: number;
  windowDays: number;
  client: PlatformTotals;
  peerAverage: {
    ctr: number | null;
    cpcCents: number | null;
    conversionRate: number | null;
    cpaCents: number | null;
  };
}

/**
 * Returns null if the client has no industry set, has no spend in the
 * window, or fewer than MIN_PEER_COUNT other clients share that industry
 * with spend in the window — in every one of those cases there isn't a
 * meaningful comparison to make.
 */
export async function computeIndustryBenchmark(clientId: string): Promise<IndustryBenchmark | null> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { industry: true } });
  if (!client?.industry) return null;

  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const clientTotals = await computeClientTotals(clientId, since, until);
  if (clientTotals.clicks === 0) return null;

  const peers = await db.client.findMany({
    where: { industry: client.industry, id: { not: clientId } },
    select: { id: true },
  });
  if (peers.length < MIN_PEER_COUNT) return null;

  const peerTotals = await Promise.all(peers.map((p) => computeClientTotals(p.id, since, until)));
  const peersWithSpend = peerTotals.filter((t) => t.clicks > 0);
  if (peersWithSpend.length < MIN_PEER_COUNT) return null;

  return {
    industry: client.industry,
    peerCount: peersWithSpend.length,
    windowDays: WINDOW_DAYS,
    client: clientTotals,
    peerAverage: {
      ctr: average(peersWithSpend.map((t) => t.ctr).filter((v): v is number => v !== null)),
      cpcCents: average(peersWithSpend.map((t) => t.cpcCents).filter((v): v is number => v !== null)),
      conversionRate: average(peersWithSpend.map((t) => t.conversionRate).filter((v): v is number => v !== null)),
      cpaCents: average(peersWithSpend.map((t) => t.cpaCents).filter((v): v is number => v !== null)),
    },
  };
}

const SYSTEM_PROMPT = `You write a short performance comparison for an ad agency's internal dashboard (AdPac). You're given one client's CTR/CPC/conversion rate/CPA over the last 30 days, alongside the AVERAGE of that agency's OTHER clients in the same industry (peerCount tells you how many). This is AdPac's own portfolio data, not external market research — never write as if it's an industry-wide statistic or cite any source other than "AdPac's other <industry> clients."

Write 2-3 sentences: state plainly whether this client is ahead of, behind, or in line with its peer average, citing the actual numbers given (as %, and cost in dollars — costs are given in cents, convert them). Then one sentence of a concrete, plausible reason or suggestion IF the client is clearly behind on something (e.g. conversion rate) — otherwise skip that sentence. Do not invent any number not given to you. Do not claim certainty about causes; use language like "may suggest" or "worth checking whether."

Respond with ONLY a JSON object: {"narrative": "the 2-4 sentences described above"}`;

export interface IndustryTrendResult {
  benchmark: IndustryBenchmark;
  narrative: string;
}

export async function generateIndustryTrend(clientId: string): Promise<IndustryTrendResult | null> {
  const benchmark = await computeIndustryBenchmark(clientId);
  if (!benchmark) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');
  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(benchmark) }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  let narrative = '';
  if (textBlock && textBlock.type === 'text') {
    try {
      const parsed = JSON.parse(textBlock.text);
      if (typeof parsed.narrative === 'string') narrative = parsed.narrative;
    } catch {
      // fall through with empty narrative — the numeric benchmark is still useful on its own
    }
  }

  return { benchmark, narrative };
}
