import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Turns a client's plain-language brief (business, goal, budget, audience)
// into a structured Google Search campaign draft: keywords, responsive
// search ad copy, and a daily budget. This never touches the Google Ads API
// directly — it only produces a draft row in the database that a human
// approves before anything goes live (see /api/campaigns/[id]/approve).

const CampaignDraftSchema = z.object({
  name: z.string(),
  campaignType: z.literal('SEARCH'), // Phase 1 only supports Search — see createSearchCampaign in lib/googleAds.ts
  dailyBudgetCents: z.number().int().positive(),
  targetLanguage: z.string(), // e.g. "English", "Arabic" — echoes what was requested/inferred, shown in the UI
  targetLocations: z.array(z.string()).min(1), // e.g. ["Lebanon", "United Arab Emirates"]
  keywords: z.array(z.string()).min(5).max(20),
  headlines: z.array(z.string().max(30)).min(8).max(15),
  descriptions: z.array(z.string().max(90)).min(2).max(4),
  rationale: z.string(),
});

export type CampaignDraftOutput = z.infer<typeof CampaignDraftSchema>;

export interface CampaignBriefInput {
  businessName: string;
  website?: string;
  industry?: string;
  monthlyBudgetCents: number;
  goal: string; // e.g. "Generate leads"
  targetAudience?: string;
  adLanguage?: string; // e.g. "English", "Arabic" — if unset, defaults to English rather than letting the AI guess
  targetLocations?: string; // free text, e.g. "Lebanon, UAE, Saudi Arabia"
}

const SYSTEM_PROMPT =
  'You are a senior Google Ads strategist. Given a business brief, produce a single ' +
  'Search campaign draft as strict JSON matching the requested schema. Headlines must ' +
  'be <=30 characters, descriptions <=90 characters (Google Ads limits) — these are hard ' +
  'limits, not targets; count characters carefully before responding. Keywords should ' +
  'be realistic phrase-match terms a real advertiser would bid on — not generic filler. ' +
  'Write ALL ad copy (headlines, descriptions) and keywords in the exact language given by ' +
  '`ad_language` in the input — do not switch languages based on the business name or ' +
  'industry. Set targetLocations to the exact locations given by `target_locations` in the ' +
  "input if provided; if not provided, infer reasonable locations from the business's " +
  'website/industry and state them explicitly — never leave targeting implicit. ' +
  'Respond with ONLY the JSON object, no prose, no markdown fences.';

const MAX_ATTEMPTS = 3;

/** Trims a string to `max` chars without cutting a word in half, when possible. */
function truncateToLimit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only trim to the last word boundary if that doesn't throw away too much
  // (e.g. one very long word) — otherwise a hard cut is the safer fallback.
  if (lastSpace > max * 0.6) return cut.slice(0, lastSpace).trimEnd();
  return cut.trimEnd();
}

/** Last-resort repair: force any oversized headline/description to fit rather than failing outright. */
function repairLengths(data: any): unknown {
  return {
    ...data,
    headlines: Array.isArray(data.headlines) ? data.headlines.map((h: unknown) => truncateToLimit(String(h), 30)) : data.headlines,
    descriptions: Array.isArray(data.descriptions)
      ? data.descriptions.map((d: unknown) => truncateToLimit(String(d), 90))
      : data.descriptions,
  };
}

export async function generateCampaignDraft(input: CampaignBriefInput): Promise<CampaignDraftOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY — see .env.example');
  }

  const anthropic = new Anthropic({ apiKey });
  const dailyBudgetCents = Math.round(input.monthlyBudgetCents / 30.4);

  const initialUserMessage = JSON.stringify({
    business_name: input.businessName,
    website: input.website ?? null,
    industry: input.industry ?? null,
    monthly_budget_cents: input.monthlyBudgetCents,
    suggested_daily_budget_cents: dailyBudgetCents,
    goal: input.goal,
    target_audience: input.targetAudience ?? null,
    ad_language: input.adLanguage ?? 'English',
    target_locations: input.targetLocations ?? null,
    schema: {
      name: 'string — campaign name',
      campaignType: 'literal "SEARCH" — only campaign type supported right now',
      dailyBudgetCents: 'integer — daily budget in cents, at or below suggested_daily_budget_cents',
      targetLanguage: 'string — the language used for the ad copy (must match ad_language above)',
      targetLocations: 'string[] — 1+ specific locations this campaign should target',
      keywords: 'string[] — 8 to 15 phrase-match seed keywords',
      headlines: 'string[] — 10 to 15 headlines, each <=30 characters',
      descriptions: 'string[] — 2 to 4 descriptions, each <=90 characters',
      rationale: 'string — 2-3 sentences explaining the targeting strategy',
    },
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initialUserMessage }];
  let lastRawText = '';
  let lastError: z.ZodError | Error | null = null;

  // Retry loop: if Claude's output fails schema validation (most commonly a
  // length overflow on a headline/description), send the validation errors
  // back and ask it to correct just those fields, rather than failing the
  // whole request on the first miss.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      lastError = new Error('AI response contained no text content');
      continue;
    }
    lastRawText = textBlock.text;

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      lastError = new Error(`AI response was not valid JSON: ${textBlock.text.slice(0, 300)}`);
      messages.push(
        { role: 'assistant', content: textBlock.text },
        { role: 'user', content: 'That was not valid JSON. Respond again with ONLY a valid JSON object matching the schema.' }
      );
      continue;
    }

    const result = CampaignDraftSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    lastError = result.error;
    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: textBlock.text },
        {
          role: 'user',
          content:
            'That response failed validation with these errors: ' +
            JSON.stringify(result.error.issues) +
            '. Fix ONLY the flagged fields (e.g. shorten any string that exceeds its character limit) ' +
            'while keeping everything else. Respond again with the complete corrected JSON object, no prose.',
        }
      );
    }
  }

  // All retries exhausted. If the only remaining problem is length overflow
  // on headlines/descriptions, repair it deterministically rather than
  // failing the user's request outright — everything else about the draft
  // (keywords, targeting rationale) is still usable.
  try {
    const parsed = JSON.parse(lastRawText);
    const repaired = repairLengths(parsed);
    const result = CampaignDraftSchema.safeParse(repaired);
    if (result.success) return result.data;
  } catch {
    // fall through to throwing below
  }

  const detail = lastError instanceof z.ZodError ? lastError.message : lastError?.message ?? 'unknown error';
  throw new Error(`AI response failed schema validation after ${MAX_ATTEMPTS} attempts: ${detail}`);
}
