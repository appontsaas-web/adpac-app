import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';

// ---------------------------------------------------------------------------
// Persona Building & Audience Study — combines the client's own stated goal
// and target audience (MonthlyInput, collected via the Client Portal) with
// REAL demographic performance data already synced from Google Ads/Meta
// (AudienceMetric/MetaAudienceMetric: age, gender, location, device — see
// prisma/schema.prisma). Claude's job is synthesis and writing — building
// named personas, drafting ad copy per persona, and writing a plan — not
// inventing demographic numbers; every dimensionValue Claude sees is real,
// pulled straight from the connected accounts.
//
// Output feeds a MarketingPlan row (status DRAFT) for staff to review before
// sending to the client. See /api/marketing-plans/generate.
// ---------------------------------------------------------------------------

const LOOKBACK_DAYS = 90;
const TOP_N_PER_DIMENSION = 6;

export interface DemographicRow {
  platform: 'google' | 'meta';
  dimension: string;
  value: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
}

async function aggregateDemographics(clientId: string): Promise<DemographicRow[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [googleRows, metaRows] = await Promise.all([
    db.audienceMetric.groupBy({
      by: ['dimension', 'dimensionValue'],
      where: { date: { gte: since }, campaign: { clientId } },
      _sum: { impressions: true, clicks: true, costCents: true, conversions: true },
    }),
    db.metaAudienceMetric.groupBy({
      by: ['dimension', 'dimensionValue'],
      where: { date: { gte: since }, campaign: { adAccount: { clientId } } },
      _sum: { impressions: true, clicks: true, costCents: true, conversions: true },
    }),
  ]);

  const toRows = (rows: typeof googleRows, platform: 'google' | 'meta'): DemographicRow[] =>
    rows.map((r) => ({
      platform,
      dimension: r.dimension,
      value: r.dimensionValue,
      impressions: r._sum.impressions ?? 0,
      clicks: r._sum.clicks ?? 0,
      costCents: r._sum.costCents ?? 0,
      conversions: r._sum.conversions ?? 0,
    }));

  const all = [...toRows(googleRows, 'google'), ...toRows(metaRows, 'meta')];

  // Cap to the top N rows per (platform, dimension) by clicks, so a long-tail
  // location list doesn't blow out the prompt — Claude only needs the
  // dimensions that actually have volume.
  const grouped = new Map<string, DemographicRow[]>();
  for (const row of all) {
    const key = `${row.platform}:${row.dimension}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  const capped: DemographicRow[] = [];
  for (const rows of grouped.values()) {
    rows.sort((a, b) => b.clicks - a.clicks);
    capped.push(...rows.slice(0, TOP_N_PER_DIMENSION));
  }
  return capped;
}

interface CampaignRef {
  campaignId: string;
  platform: 'GOOGLE_ADS' | 'META';
  name: string;
}

async function fetchLiveCampaignRefs(clientId: string): Promise<CampaignRef[]> {
  const [google, meta] = await Promise.all([
    db.campaign.findMany({
      where: { clientId, status: 'LIVE' },
      select: { id: true, name: true },
    }),
    db.metaCampaign.findMany({
      where: { adAccount: { clientId }, status: 'ACTIVE' },
      select: { id: true, name: true },
    }),
  ]);
  return [
    ...google.map((c) => ({ campaignId: c.id, platform: 'GOOGLE_ADS' as const, name: c.name })),
    ...meta.map((c) => ({ campaignId: c.id, platform: 'META' as const, name: c.name })),
  ];
}

const PersonaSchema = z.object({
  name: z.string().max(60), // e.g. "Budget-Conscious Bethany"
  summary: z.string().max(400),
  demographicBasis: z.string().max(300), // must cite real dimensionValues given, e.g. "Skews 25-34, mobile, US/Canada — our top-converting segment"
  motivations: z.array(z.string().max(150)).min(1).max(5),
  painPoints: z.array(z.string().max(150)).min(1).max(5),
});

const PersonaAdCopySchema = z.object({
  personaName: z.string(), // must match a Persona.name given above
  headlines: z.array(z.string().max(30)).min(3).max(10),
  descriptions: z.array(z.string().max(90)).min(2).max(4),
});

const ProposedActionSchema = z.object({
  campaignId: z.string(), // must be one of the campaignIds given
  personaName: z.string(), // must match a Persona.name given above
  proposedHeadlines: z.array(z.string().max(30)).min(8).max(15),
  proposedDescriptions: z.array(z.string().max(90)).min(2).max(4),
  rationale: z.string().max(400),
});

const PlanResponseSchema = z.object({
  personas: z.array(PersonaSchema).min(1).max(4),
  adCopy: z.array(PersonaAdCopySchema).min(1).max(4),
  objectives: z.string().max(600), // 2-4 sentences, grounded in the client's own goalText
  narrative: z.string().max(1200), // the fuller written plan
  proposedActions: z.array(ProposedActionSchema).max(6),
});

export type PersonaPlanResult = z.infer<typeof PlanResponseSchema>;

const SYSTEM_PROMPT = `You are a media strategist at AdPac, an ad management agency. You build audience personas, draft ad copy, and write a plan for one client, for one period (month or quarter).

You are given:
- The client's own stated goal and target audience for this period (in their own words).
- Real demographic performance data pulled from their connected Google Ads/Meta accounts over the last 90 days (age/gender/location/device breakdowns, with real impressions/clicks/cost/conversions) — this is ACTUAL data, not a guess.
- A list of their currently live campaigns (id, platform, name) you may reference.

Build 1-4 personas. Each persona's demographicBasis MUST cite real dimension values from the data given (e.g. "This segment is 68% of clicks and has the highest conversion rate") — never invent a demographic split that isn't supported by the data. Motivations and pain points may reasonably be INFERRED from the client's stated goal/audience combined with the demographic data, but say so as inference, not fact.

For each persona, draft ad copy (headlines <=30 chars, descriptions <=90 chars) reflecting that persona's likely motivations.

Then write a short "objectives" (what this period is trying to achieve, grounded in the client's own goalText) and a longer "narrative" (the fuller plan — how the personas/copy connect to real campaign changes).

Finally, propose 0-6 concrete actions: rewriting an EXISTING live campaign's ad copy toward one of your personas. Each proposedAction must reference a real campaignId from the list given WHOSE platform IS "GOOGLE_ADS" — ad copy rewrites can only be executed on Google Ads campaigns right now, never a "META" campaignId, even though you may reference Meta campaigns/data elsewhere in your reasoning. Headlines/descriptions must follow the same length limits. Only propose an action where you have a genuine, specific reason tied to the data — it's fine to propose zero if nothing stands out.

Respond with ONLY a JSON object matching this shape:
{"personas": [{"name","summary","demographicBasis","motivations":[],"painPoints":[]}], "adCopy": [{"personaName","headlines":[],"descriptions":[]}], "objectives": "...", "narrative": "...", "proposedActions": [{"campaignId","personaName","proposedHeadlines":[],"proposedDescriptions":[],"rationale"}]}`;

export async function generatePersonaPlan(clientId: string): Promise<{
  result: PersonaPlanResult;
  monthlyInputId: string;
} | { error: string }> {
  const monthlyInput = await db.monthlyInput.findFirst({
    where: { clientId },
    orderBy: { submittedAt: 'desc' },
  });
  if (!monthlyInput) {
    return { error: 'This client has no submitted monthly input yet — nothing to build a plan from.' };
  }

  const [demographics, campaigns] = await Promise.all([
    aggregateDemographics(clientId),
    fetchLiveCampaignRefs(clientId),
  ]);
  if (demographics.length === 0) {
    return { error: 'No audience demographic data synced yet for this client — sync metrics first.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');
  const anthropic = new Anthropic({ apiKey });

  const userMessage = JSON.stringify({
    goalText: monthlyInput.goalText,
    targetAudienceText: monthlyInput.targetAudienceText,
    budgetNotes: monthlyInput.budgetNotes,
    competitorNotes: monthlyInput.competitorNotes,
    additionalNotes: monthlyInput.additionalNotes,
    demographics,
    liveCampaigns: campaigns,
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  // Only Google Ads campaigns are valid proposedActions targets — see
  // lib/googleAds.ts's updateResponsiveSearchAd, the only ad-copy write path
  // that exists right now. A Meta ad-copy write function doesn't exist yet,
  // so a Meta campaignId here would create an ActionLog that can never
  // actually execute.
  const validCampaignIds = new Set(campaigns.filter((c) => c.platform === 'GOOGLE_ADS').map((c) => c.campaignId));

  for (let attempt = 1; attempt <= 2; attempt++) {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      messages.push(
        { role: 'assistant', content: textBlock.text },
        { role: 'user', content: 'That was not valid JSON. Respond again with ONLY a valid JSON object matching the schema.' }
      );
      continue;
    }

    const validated = PlanResponseSchema.safeParse(parsed);
    if (!validated.success) {
      if (attempt < 2) {
        messages.push(
          { role: 'assistant', content: textBlock.text },
          {
            role: 'user',
            content: 'That response failed validation: ' + JSON.stringify(validated.error.issues) + '. Respond again with the complete corrected JSON object, no prose.',
          }
        );
      }
      continue;
    }

    // Defense in depth: drop any proposed action referencing a campaignId we
    // never gave it, same discipline as lib/aiInsights.ts.
    const personaNames = new Set(validated.data.personas.map((p) => p.name));
    const sanitized: PersonaPlanResult = {
      ...validated.data,
      adCopy: validated.data.adCopy.filter((c) => personaNames.has(c.personaName)),
      proposedActions: validated.data.proposedActions.filter(
        (a) => validCampaignIds.has(a.campaignId) && personaNames.has(a.personaName)
      ),
    };

    return { result: sanitized, monthlyInputId: monthlyInput.id };
  }

  return { error: 'AI failed to produce a valid plan after two attempts — try again.' };
}
