// ---------------------------------------------------------------------------
// Meta (Facebook + Instagram) Marketing API integration
//
// Facebook and Instagram deliberately share ONE connection here — the
// Marketing API has no separate "Instagram ad account" concept; Instagram is
// just a placement inside a normal Meta ad account's campaigns. Verified
// against Meta's live developer docs before writing this (API version
// v26.0, current as of July 2026 — v25.0 also still supported).
//
// Token lifecycle is fundamentally different from every other integration in
// this app (Google Ads/GA4/GTM/GBP all use a real, never-expiring OAuth
// refresh_token). Meta only ever issues a long-lived USER access token
// (~60 days) — there is no refresh_token equivalent. This file re-exchanges
// the stored token for a fresh 60-day token on every sync (fb_exchange_token
// grant), so the connection stays alive indefinitely as long as syncs keep
// happening at least every ~60 days. If a client's Meta connection goes
// untouched longer than that (app paused, sync disabled, etc.) the token
// will have genuinely expired and reconnecting is the only fix — that's a
// real Meta limitation, not a bug here.
//
// You need, from a Meta developer app (business.facebook.com/developers —
// this is a SEPARATE app from anything Google-related, not reused):
//   META_APP_ID / META_APP_SECRET — the app's own credentials
//   META_REDIRECT_URI            — its own registered OAuth redirect URI
// The app needs the ads_management, ads_read, and business_management
// permissions. Every app starts on the Marketing API Access Tier's "Limited
// access" level — works against ad accounts the app's own developers/admins
// are already added to (fine for AdPac staff testing) but is heavily
// rate-limited and not meant for real client accounts in production.
// "Full access" requires Meta App Review, plus meeting a bootstrapping bar
// first: 500+ Marketing API calls in the last 15 days with <15% error rate
// (Meta lowered this from the older 1500-calls/30-days, <10%-error
// requirement — see developers.facebook.com/docs/marketing-api/overview/
// authorization for the current numbers if this ever needs rechecking).
// See README.md "Meta Ads setup" for the step-by-step once written.
// ---------------------------------------------------------------------------

const META_API_VERSION = 'v26.0';
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const SCOPES = ['ads_management', 'ads_read', 'business_management'];

// Every fetch() to Meta's Graph API goes through this — plain fetch() has no
// default timeout, so a slow/hung Meta response (rate-limiting backoff, a
// flaky network path, Meta's API just being slow) would otherwise leave the
// whole /api/meta/sync request hanging indefinitely with nothing in the
// logs, which is exactly what a "stuck" sync looks like from the outside.
// 25s is generous for a single Graph API call but still short enough that a
// hung request surfaces as a normal, per-section non-fatal error (the sync
// route already try/catches each section) instead of a silent hang.
const META_FETCH_TIMEOUT_MS = 25_000;

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Meta API request timed out after ${META_FETCH_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

/** Step 1 of the connect flow: send the operator here to grant access. */
export function getMetaAuthUrl(state: string): string {
  const url = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', requireEnv('META_APP_ID'));
  url.searchParams.set('redirect_uri', requireEnv('META_REDIRECT_URI'));
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface MetaTokenResult {
  accessToken: string;
  expiresAt: Date | null; // null if Meta didn't return an expiry (treat as short-lived — re-exchange ASAP)
}

/** Step 2: exchange the ?code= Meta redirects back with for a (short-lived) user access token. */
export async function exchangeCodeForToken(code: string): Promise<MetaTokenResult> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', requireEnv('META_APP_ID'));
  url.searchParams.set('client_secret', requireEnv('META_APP_SECRET'));
  url.searchParams.set('redirect_uri', requireEnv('META_REDIRECT_URI'));
  url.searchParams.set('code', code);

  const res = await timedFetch(url.toString());
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  // Meta's initial code exchange returns a short-lived token (~1-2 hours) —
  // immediately upgrade it to a long-lived one so the very first connect
  // stores something usable for more than a couple hours.
  return exchangeForLongLivedToken(data.access_token);
}

/**
 * Re-exchanges any valid (short- or long-lived) user access token for a
 * fresh ~60-day long-lived token. Called both right after the initial code
 * exchange above, and again on every sync (see MetaAdAccount.tokenExpiresAt
 * comment in schema.prisma) to keep the connection alive indefinitely.
 */
export async function exchangeForLongLivedToken(currentAccessToken: string): Promise<MetaTokenResult> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', requireEnv('META_APP_ID'));
  url.searchParams.set('client_secret', requireEnv('META_APP_SECRET'));
  url.searchParams.set('fb_exchange_token', currentAccessToken);

  const res = await timedFetch(url.toString());
  if (!res.ok) throw new Error(`Meta long-lived token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const expiresAt = typeof data.expires_in === 'number' ? new Date(Date.now() + data.expires_in * 1000) : null;
  return { accessToken: data.access_token, expiresAt };
}

function authedUrl(path: string, accessToken: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

async function apiGet(url: URL): Promise<any> {
  const res = await timedFetch(url.toString());
  if (!res.ok) throw new Error(`Meta API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path: string, accessToken: string, body: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  const params = new URLSearchParams({ ...body, access_token: accessToken });
  const res = await timedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Meta API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Ad accounts — GET /me/adaccounts
// ---------------------------------------------------------------------------

export interface MetaAdAccountInfo {
  id: string; // "act_1234567890"
  name: string;
  currency: string; // e.g. "USD", "SAR"
  accountStatus: number; // 1 = ACTIVE
}

/** Lists the ad accounts this access token's user can manage. */
export async function listAdAccounts(accessToken: string): Promise<MetaAdAccountInfo[]> {
  const accounts: MetaAdAccountInfo[] = [];
  let url: URL | null = authedUrl('me/adaccounts', accessToken, {
    fields: 'id,name,currency,account_status',
    limit: '200',
  });
  while (url) {
    const data = await apiGet(url);
    for (const a of data.data ?? []) {
      accounts.push({ id: a.id, name: a.name, currency: a.currency, accountStatus: a.account_status });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return accounts;
}

/** Confirms the token can actually access this ad account before we store it, and returns its currency. */
export async function verifyAdAccountAccess(metaAdAccountId: string, accessToken: string): Promise<string | null> {
  const data = await apiGet(authedUrl(metaAdAccountId, accessToken, { fields: 'id,currency' }));
  return data.currency ?? null;
}

// Fixed FX rates converting a Meta ad account's own billing currency to
// USD — same rationale and same table as lib/googleAds.ts's FX_RATE_TO_USD
// (kept as a separate copy rather than a shared import, matching how the
// GBP integration also doesn't share code with Google Ads: these are
// independent integrations, and a shared FX table would be the one
// coupling point between otherwise-unrelated files). Only fixed/pegged
// rates belong here — a currency not listed falls back to 1 (assumed USD)
// with a console warning rather than silently mis-converting.
const FX_RATE_TO_USD: Record<string, number> = {
  USD: 1,
  SAR: 1 / 3.75, // Saudi Riyal — pegged to USD since 1986
  AED: 1 / 3.6725, // UAE Dirham — pegged to USD since 1997
};

function fxRateToUsd(currencyCode: string | null | undefined): number {
  if (!currencyCode) return 1;
  const rate = FX_RATE_TO_USD[currencyCode.toUpperCase()];
  if (rate === undefined) {
    console.warn(
      `meta: no FX rate configured for currency "${currencyCode}" — treating as USD 1:1. ` +
        `Add its real rate to FX_RATE_TO_USD in lib/meta.ts.`
    );
    return 1;
  }
  return rate;
}

// ---------------------------------------------------------------------------
// Campaigns — GET /act_{id}/campaigns ("Ad Campaign Group" in Meta's docs)
// ---------------------------------------------------------------------------

export interface MetaCampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string; // ACTIVE | PAUSED | DELETED | ARCHIVED
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
}

/**
 * Imports existing campaigns on the ad account (same "import existing" model
 * as fetchExistingCampaigns in lib/googleAds.ts — this integration manages
 * campaigns already built in Meta Ads Manager, it doesn't draft new ones).
 * Budget fields come back from Meta already in the account's currency's
 * smallest subunit (cents for USD/SAR/AED), matching this app's convention —
 * no conversion needed for the budget figures themselves, only for spend/
 * conversion-value in fetchCampaignInsights below.
 */
export async function listCampaigns(metaAdAccountId: string, accessToken: string): Promise<MetaCampaignRow[]> {
  const campaigns: MetaCampaignRow[] = [];
  let url: URL | null = authedUrl(`${metaAdAccountId}/campaigns`, accessToken, {
    fields: 'id,name,objective,status,daily_budget,lifetime_budget,effective_status',
    limit: '200',
  });
  while (url) {
    const data = await apiGet(url);
    for (const c of data.data ?? []) {
      campaigns.push({
        id: c.id,
        name: c.name,
        objective: c.objective,
        status: c.effective_status ?? c.status,
        dailyBudgetCents: c.daily_budget !== undefined ? Number(c.daily_budget) : null,
        lifetimeBudgetCents: c.lifetime_budget !== undefined ? Number(c.lifetime_budget) : null,
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return campaigns;
}

export interface MetaDailyInsightRow {
  date: string; // "2026-09-24"
  campaignId: string;
  impressions: number;
  clicks: number;
  costCents: number; // converted to USD cents
  conversions: number;
  conversionValueCents: number; // converted to USD cents
  reach: number; // unique people reached THAT DAY — see MetaDailyMetric.reach schema comment before summing this across days
}

// Meta's "actions"/"action_values" arrays are NOT a clean list of "the
// conversions" — two separate problems, both of which inflate a naive sum:
//
// 1. The same underlying event is reported under MULTIPLE overlapping
//    action_types at once (e.g. one purchase can appear as "omni_purchase",
//    "offsite_conversion.fb_pixel_purchase", AND "onsite_web_purchase"
//    simultaneously — Meta reports it once per tracking source plus a
//    deduplicated rollup type). Summing every entry multiplies the same
//    conversion several times over.
// 2. "actions" in particular is NOT limited to conversion-like events —
//    it also includes pure engagement noise (link_click, post_engagement,
//    page_engagement, landing_page_view, video_view, etc.) that has no
//    business being counted as "conversions" at all, regardless of
//    double-counting. A campaign optimized for engagement can have
//    thousands of these, dwarfing any real conversions.
//
// The first pass at this only fixed problem #1 (prefer "omni_purchase",
// else sum everything) — that cut the numbers down but they were STILL
// wrong, because the sum-everything fallback still hit problem #2 whenever
// "omni_purchase" wasn't present in the response (which depends on the
// account's attribution/Conversions API setup, not on whether real
// purchases happened).
//
// This version fixes both: walk a fixed priority list of known
// conversion-like action_types and take the value from the FIRST one
// present — never sum across the list, and never fall back to summing the
// raw array. If none of these known types are present, the true answer is
// "we don't have a reliable conversion number for this row" — returning 0
// with that documented rather than dumping an unrelated engagement-metrics
// sum is the safer wrong answer. A future pass could map each campaign's
// actual `objective` to the one specific action_type it optimizes for, the
// way Meta's own Ads Manager UI does — this priority list is a reasonable
// approximation of that without needing the objective wired through here.
const CONVERSION_ACTION_TYPES_BY_PRIORITY = [
  'omni_purchase', // deduplicated, cross-source purchase total — Ads Manager's default
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
  'onsite_web_app_purchase',
  'app_custom_event.fb_mobile_purchase',
  'omni_app_purchase',
  'omni_lead',
  'lead',
  'onsite_conversion.lead_grouped',
  'omni_complete_registration',
  'complete_registration',
];

function sumMetaActionField(entries: { action_type?: string; value?: string | number }[] | undefined): number {
  if (!entries || entries.length === 0) return 0;
  for (const type of CONVERSION_ACTION_TYPES_BY_PRIORITY) {
    const match = entries.find((e) => e.action_type === type);
    if (match) return Number(match.value ?? 0);
  }
  return 0;
}

/**
 * Pulls per-day, per-campaign performance via the Insights API
 * (GET /{ad-account}/insights, level=campaign, time_increment=1). `currency`
 * is the account's own billing currency (see verifyAdAccountAccess) — spend
 * and conversion-value figures are converted to USD cents using the fixed
 * FX table above, same as lib/googleAds.ts.
 *
 * "conversions"/"conversionValueCents" use sumMetaActionField above — see
 * its doc comment for why this isn't a plain sum of every action_type.
 */
export async function fetchCampaignInsights(
  metaAdAccountId: string,
  accessToken: string,
  sinceDate: string, // YYYY-MM-DD
  untilDate: string,
  currencyCode?: string | null
): Promise<MetaDailyInsightRow[]> {
  const rate = fxRateToUsd(currencyCode);
  const rows: MetaDailyInsightRow[] = [];

  let url: URL | null = authedUrl(`${metaAdAccountId}/insights`, accessToken, {
    level: 'campaign',
    time_increment: '1',
    fields: 'campaign_id,impressions,clicks,spend,action_values,actions,reach,date_start',
    time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
    limit: '500',
  });
  while (url) {
    const data = await apiGet(url);
    for (const row of data.data ?? []) {
      const conversions = sumMetaActionField(row.actions);
      const conversionValue = sumMetaActionField(row.action_values);
      rows.push({
        date: row.date_start,
        campaignId: row.campaign_id,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        costCents: Math.round(Number(row.spend ?? 0) * 100 * rate),
        conversions,
        conversionValueCents: Math.round(conversionValue * 100 * rate),
        reach: Number(row.reach ?? 0),
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Audience/placement/time breakdowns — same GET /{ad-account}/insights
// endpoint as fetchCampaignInsights, but with the `breakdowns` parameter.
// Meta only allows specific breakdown combinations per request (verified
// against the live Breakdowns doc) — each dimension below is its own call,
// not one combined query, mirroring how lib/googleBusinessProfile.ts and
// lib/googleAds.ts each make one call per report shape rather than
// bending a single query to cover everything.
// ---------------------------------------------------------------------------

export type MetaAudienceDimension = 'age' | 'gender' | 'country' | 'region' | 'platform' | 'hour';

export interface MetaAudienceRow {
  date: string;
  campaignId: string;
  dimensionValue: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
}

// Maps our dimension name to the Meta `breakdowns` param value(s) and how to
// read the resulting row's dimension value back out — `platform` combines
// publisher_platform + platform_position into one "facebook/feed"-style
// value, matching how Google Ads' AudienceMetric only stores one dimension
// value per row too.
function breakdownParam(dimension: MetaAudienceDimension): string {
  switch (dimension) {
    case 'age':
      return 'age';
    case 'gender':
      return 'gender';
    case 'country':
      return 'country';
    case 'region':
      return 'region';
    case 'platform':
      return 'publisher_platform,platform_position';
    case 'hour':
      return 'hourly_stats_aggregated_by_advertiser_time_zone';
  }
}

function dimensionValueFromRow(dimension: MetaAudienceDimension, row: any): string {
  switch (dimension) {
    case 'age':
      return row.age ?? 'unknown';
    case 'gender':
      return row.gender ?? 'unknown';
    case 'country':
      return row.country ?? 'unknown';
    case 'region':
      return row.region ?? 'unknown';
    case 'platform':
      return `${row.publisher_platform ?? 'unknown'}/${row.platform_position ?? 'unknown'}`;
    case 'hour': {
      // Meta returns this as a "HH:MM:SS - HH:MM:SS" range string — keep
      // just the starting hour (0-23) so it sorts/displays the same way
      // Google Ads' hour-of-day dimension does.
      const raw: string = row.hourly_stats_aggregated_by_advertiser_time_zone ?? '';
      const match = raw.match(/^(\d{2}):/);
      return match ? String(Number(match[1])) : raw || 'unknown';
    }
  }
}

/**
 * Pulls one audience/placement/time breakdown, per day, for every campaign
 * on the account over [sinceDate, untilDate]. Reach is deliberately not
 * requested here — Meta doesn't return meaningful unique reach split by
 * every one of these breakdowns reliably, and this table is about
 * cost/conversion allocation across segments, not audience size.
 */
export async function fetchCampaignAudienceBreakdown(
  metaAdAccountId: string,
  accessToken: string,
  dimension: MetaAudienceDimension,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<MetaAudienceRow[]> {
  const rate = fxRateToUsd(currencyCode);
  const rows: MetaAudienceRow[] = [];

  let url: URL | null = authedUrl(`${metaAdAccountId}/insights`, accessToken, {
    level: 'campaign',
    time_increment: '1',
    breakdowns: breakdownParam(dimension),
    fields: 'campaign_id,impressions,clicks,spend,actions,date_start',
    time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
    limit: '500',
  });
  while (url) {
    const data = await apiGet(url);
    for (const row of data.data ?? []) {
      const conversions = sumMetaActionField(row.actions);
      rows.push({
        date: row.date_start,
        campaignId: row.campaign_id,
        dimensionValue: dimensionValueFromRow(dimension, row),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        costCents: Math.round(Number(row.spend ?? 0) * 100 * rate),
        conversions,
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ad sets — GET /act_{id}/adsets ("Ad Set" — where targeting/budget/schedule
// actually live in Meta's hierarchy, one level under campaign) — and
// individual ads (creatives) one level under that. Mirrors the
// listCampaigns + fetchCampaignInsights split above: one lightweight call
// for current state (name/status/budget/targeting), one Insights call per
// account for the daily metrics time series — same as Google Ads'
// fetchAdGroupMetrics/fetchAdMetrics pair in lib/googleAds.ts.
// ---------------------------------------------------------------------------

export interface MetaAdSetRow {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  dailyBudgetCents: number | null;
  targetingSummary: string | null;
}

/** Builds a compact, human-readable summary from a /adsets `targeting` object. */
function summarizeTargeting(targeting: any): string | null {
  if (!targeting) return null;
  const parts: string[] = [];
  if (targeting.age_min || targeting.age_max) {
    parts.push(`Ages ${targeting.age_min ?? 18}-${targeting.age_max ?? 65}`);
  }
  if (Array.isArray(targeting.genders) && targeting.genders.length > 0) {
    // Meta: 1 = male, 2 = female; absent/empty = all genders
    const labels = targeting.genders.map((g: number) => (g === 1 ? 'Men' : g === 2 ? 'Women' : 'All'));
    parts.push(labels.join('/'));
  } else {
    parts.push('All genders');
  }
  const countries = targeting.geo_locations?.countries;
  if (Array.isArray(countries) && countries.length > 0) {
    parts.push(countries.slice(0, 4).join(', ') + (countries.length > 4 ? ` +${countries.length - 4}` : ''));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Imports existing ad sets on the account — current name/status/budget/targeting, not a time series. */
export async function listAdSets(metaAdAccountId: string, accessToken: string): Promise<MetaAdSetRow[]> {
  const adSets: MetaAdSetRow[] = [];
  let url: URL | null = authedUrl(`${metaAdAccountId}/adsets`, accessToken, {
    fields: 'id,campaign_id,name,effective_status,daily_budget,targeting',
    limit: '200',
  });
  while (url) {
    const data = await apiGet(url);
    for (const a of data.data ?? []) {
      adSets.push({
        id: a.id,
        campaignId: a.campaign_id,
        name: a.name,
        status: a.effective_status ?? 'UNKNOWN',
        dailyBudgetCents: a.daily_budget !== undefined ? Number(a.daily_budget) : null,
        targetingSummary: summarizeTargeting(a.targeting),
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return adSets;
}

export interface MetaAdSetInsightRow {
  date: string;
  campaignId: string;
  adSetId: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/** Pulls per-day, per-ad-set performance via the Insights API (level=adset). */
export async function fetchAdSetInsights(
  metaAdAccountId: string,
  accessToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<MetaAdSetInsightRow[]> {
  const rate = fxRateToUsd(currencyCode);
  const rows: MetaAdSetInsightRow[] = [];
  let url: URL | null = authedUrl(`${metaAdAccountId}/insights`, accessToken, {
    level: 'adset',
    time_increment: '1',
    fields: 'adset_id,campaign_id,impressions,clicks,spend,action_values,actions,date_start',
    time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
    limit: '500',
  });
  while (url) {
    const data = await apiGet(url);
    for (const row of data.data ?? []) {
      const conversions = sumMetaActionField(row.actions);
      const conversionValue = sumMetaActionField(row.action_values);
      rows.push({
        date: row.date_start,
        campaignId: row.campaign_id,
        adSetId: row.adset_id,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        costCents: Math.round(Number(row.spend ?? 0) * 100 * rate),
        conversions,
        conversionValueCents: Math.round(conversionValue * 100 * rate),
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return rows;
}

export interface MetaAdRow {
  id: string;
  campaignId: string;
  adSetId: string;
  name: string;
  status: string;
}

/** Imports existing ads (creatives) on the account — current name/status, not a time series. */
export async function listAds(metaAdAccountId: string, accessToken: string): Promise<MetaAdRow[]> {
  const ads: MetaAdRow[] = [];
  let url: URL | null = authedUrl(`${metaAdAccountId}/ads`, accessToken, {
    fields: 'id,campaign_id,adset_id,name,effective_status',
    limit: '200',
  });
  while (url) {
    const data = await apiGet(url);
    for (const a of data.data ?? []) {
      ads.push({
        id: a.id,
        campaignId: a.campaign_id,
        adSetId: a.adset_id,
        name: a.name,
        status: a.effective_status ?? 'UNKNOWN',
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return ads;
}

export interface MetaAdInsightRow {
  date: string;
  campaignId: string;
  adSetId: string;
  adId: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/** Pulls per-day, per-ad performance via the Insights API (level=ad). */
export async function fetchAdInsights(
  metaAdAccountId: string,
  accessToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<MetaAdInsightRow[]> {
  const rate = fxRateToUsd(currencyCode);
  const rows: MetaAdInsightRow[] = [];
  let url: URL | null = authedUrl(`${metaAdAccountId}/insights`, accessToken, {
    level: 'ad',
    time_increment: '1',
    fields: 'ad_id,adset_id,campaign_id,impressions,clicks,spend,action_values,actions,date_start',
    time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
    limit: '500',
  });
  while (url) {
    const data = await apiGet(url);
    for (const row of data.data ?? []) {
      const conversions = sumMetaActionField(row.actions);
      const conversionValue = sumMetaActionField(row.action_values);
      rows.push({
        date: row.date_start,
        campaignId: row.campaign_id,
        adSetId: row.adset_id,
        adId: row.ad_id,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        costCents: Math.round(Number(row.spend ?? 0) * 100 * rate),
        conversions,
        conversionValueCents: Math.round(conversionValue * 100 * rate),
      });
    }
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Write actions — POST /{campaign-id}
// ---------------------------------------------------------------------------

/** Pauses or resumes a live campaign. */
export async function setCampaignStatus(
  metaCampaignId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<void> {
  await apiPost(metaCampaignId, accessToken, { status });
}

/**
 * Updates a campaign's daily budget. newDailyBudgetCents is already in the
 * account's currency's smallest subunit — matches what Meta itself returns
 * from listCampaigns, so no conversion happens here (same "store what the
 * account bills in" approach as Google Ads' updateCampaignBudget).
 */
export async function updateCampaignDailyBudget(
  metaCampaignId: string,
  accessToken: string,
  newDailyBudgetCents: number
): Promise<void> {
  await apiPost(metaCampaignId, accessToken, { daily_budget: String(Math.round(newDailyBudgetCents)) });
}

/**
 * Pauses (or re-enables) a single ad — the Meta execution side of a
 * Creative A/B Test's losing variant (see lib/creativeTests.ts). Same
 * apiPost(<object-id>, ...) pattern as setCampaignStatus above, just aimed
 * at the ad id instead of the campaign id.
 */
export async function setAdStatus(adId: string, accessToken: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  await apiPost(adId, accessToken, { status });
}
