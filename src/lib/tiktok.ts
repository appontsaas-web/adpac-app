import { fxRateToUsd as sharedFxRateToUsd } from './fx';
// ---------------------------------------------------------------------------
// TikTok Business (Marketing) API integration — v1.3
//
// Verified against TikTok's live developer docs (business-api.tiktok.com)
// before writing this. TikTok's hierarchy is Business Center -> Advertiser
// (ad account) -> Campaign -> Ad Group -> Ad, roughly the same depth as
// Snapchat's Organization -> Ad Account -> Campaign -> Ad Squad -> Ad. One
// TikTok login can have access to several advertiser accounts through its
// Business Center, so — same as Meta/Google Business Profile/Snapchat —
// this uses the "discover after authorizing" pattern: no advertiser ID
// entered up front, the callback lists every advertiser the authorizing
// login can access via the token-exchange response itself (TikTok returns
// `advertiser_ids` directly in the access-token response, no separate list
// call needed like Snapchat's /me/organizations).
//
// Like Snapchat, TikTok issues a real refresh_token: the access_token lasts
// 24 hours and the refresh_token lasts about a year, renewing itself with
// use — so, same as lib/snapchat.ts/lib/googleAds.ts, callers just request
// a fresh access token with the stored refresh_token whenever one is
// needed, no Meta-style re-exchange-on-every-sync dance.
//
// You need, from a TikTok for Business developer app
// (business-api.tiktok.com/portal -> My Apps):
//   TIKTOK_APP_ID / TIKTOK_APP_SECRET — the app's own credentials
//   TIKTOK_REDIRECT_URI               — its own registered OAuth redirect URI
// The app needs Advertiser Authorization (the default scope for reading/
// writing campaigns and reporting) approved for your developer app.
// See README.md "TikTok Ads setup" for the step-by-step once written.
// ---------------------------------------------------------------------------

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const TIKTOK_AUTH_BASE = 'https://business-api.tiktok.com/portal/auth';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

/** Step 1 of the connect flow: send the operator here to grant access. */
export function getTikTokAuthUrl(state: string): string {
  const url = new URL(TIKTOK_AUTH_BASE);
  url.searchParams.set('app_id', requireEnv('TIKTOK_APP_ID'));
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', requireEnv('TIKTOK_REDIRECT_URI'));
  return url.toString();
}

export interface TikTokTokenResult {
  accessToken: string; // short-lived (24h) — good for immediately enriching advertiserIds via getAdvertiserInfo below, not stored
  refreshToken: string; // long-lived (~1yr), the only token this app stores
  advertiserIds: string[];
}

/**
 * Step 2: exchange the ?auth_code= TikTok redirects back with for an
 * access + refresh token pair. Unlike Snapchat/Google, TikTok returns the
 * accessible advertiser_ids directly in this same response — no separate
 * "list what this login can see" call needed.
 */
export async function exchangeCodeForTokens(authCode: string): Promise<TikTokTokenResult> {
  const res = await fetch(`${TIKTOK_API_BASE}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: requireEnv('TIKTOK_APP_ID'),
      secret: requireEnv('TIKTOK_APP_SECRET'),
      auth_code: authCode,
      grant_type: 'auth_code',
    }),
  });
  if (!res.ok) throw new Error(`TikTok token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`TikTok token request failed: ${data.code} ${data.message}`);
  return {
    accessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
    advertiserIds: data.data.advertiser_ids ?? [],
  };
}

/**
 * Requests a fresh access token using the stored refresh_token. TikTok's
 * refresh_token itself renews with use (per TikTok's docs, no rotation
 * needed on the caller's side) — same don't-rotate-what-you-store approach
 * as lib/snapchat.ts/lib/googleAds.ts's getAccessToken.
 */
async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${TIKTOK_API_BASE}/oauth2/refresh_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: requireEnv('TIKTOK_APP_ID'),
      secret: requireEnv('TIKTOK_APP_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`TikTok refresh_token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`TikTok refresh_token request failed: ${data.code} ${data.message}`);
  return data.data.access_token;
}

async function apiGet(path: string, accessToken: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TIKTOK_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { 'Access-Token': accessToken } });
  if (!res.ok) throw new Error(`TikTok API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`TikTok API error: ${data.code} ${data.message}`);
  return data.data;
}

async function apiPost(path: string, accessToken: string, body: any): Promise<any> {
  const res = await fetch(`${TIKTOK_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TikTok API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`TikTok API error: ${data.code} ${data.message}`);
  return data.data;
}

// ---------------------------------------------------------------------------
// Advertiser info — GET /advertiser/info/
// ---------------------------------------------------------------------------

export interface TikTokAdvertiserInfo {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

/**
 * Fetches display details (name/currency/timezone) for the advertiser IDs
 * granted in the token-exchange response, so the connect picker can show
 * something more useful than a bare numeric ID — same purpose as Snapchat's
 * listOrgAdAccounts, but here the IDs themselves already came from the
 * token exchange, this just enriches them.
 */
export async function getAdvertiserInfo(advertiserIds: string[], accessToken: string): Promise<TikTokAdvertiserInfo[]> {
  if (advertiserIds.length === 0) return [];
  const data = await apiGet('/advertiser/info/', accessToken, {
    advertiser_ids: JSON.stringify(advertiserIds),
  });
  return (data.list ?? []).map((a: any) => ({
    id: a.advertiser_id,
    name: a.name,
    currency: a.currency,
    timezone: a.timezone,
  }));
}

// Fixed FX rates converting a TikTok advertiser's own billing currency to
// USD — same rationale and same "fixed/pegged rates only, else assume USD
// 1:1 with a console warning" approach as lib/snapchat.ts's FX_RATE_TO_USD
// (kept as its own copy rather than shared, matching how every ad-platform
// integration in this app keeps its own FX table).
function fxRateToUsd(currencyCode: string | null | undefined): number {
  return sharedFxRateToUsd(currencyCode, 'tiktok');
}

// TikTok reports money as plain decimal strings in the advertiser's own
// currency (unlike Snapchat's micro-currency or Google Ads' micros) — just
// parse and apply FX, no unit conversion needed.
function toCents(amount: number | string | undefined, fxRate: number): number {
  return Math.round(Number(amount ?? 0) * 100 * fxRate);
}

// ---------------------------------------------------------------------------
// Campaigns — GET /campaign/get/
// ---------------------------------------------------------------------------

export interface TikTokCampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string; // ACTIVE | PAUSED (normalized from TikTok's operation_status)
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
}

/**
 * Imports existing campaigns on the advertiser account (same "import
 * existing" model as listCampaigns in lib/snapchat.ts / listCampaigns in
 * lib/meta.ts).
 */
export async function listCampaigns(advertiserId: string, accessToken: string, currencyCode?: string | null): Promise<TikTokCampaignRow[]> {
  const fx = fxRateToUsd(currencyCode);
  const campaigns: TikTokCampaignRow[] = [];
  let page = 1;
  // TikTok's campaign/get/ is paginated (default page_size 10, max 1000) —
  // loop until every page is consumed, same paging discipline as the
  // cursor-following used elsewhere in this app for list endpoints that cap
  // page size (e.g. Meta's Graph API cursors in lib/meta.ts).
  while (true) {
    const data = await apiGet('/campaign/get/', accessToken, {
      advertiser_id: advertiserId,
      page: String(page),
      page_size: '100',
    });
    for (const c of data.list ?? []) {
      campaigns.push({
        id: c.campaign_id,
        name: c.campaign_name,
        objective: c.objective_type ?? 'TRAFFIC',
        status: c.operation_status === 'ENABLE' ? 'ACTIVE' : 'PAUSED',
        dailyBudgetCents: c.budget_mode === 'BUDGET_MODE_DAY' ? toCents(c.budget, fx) : null,
        lifetimeBudgetCents: c.budget_mode === 'BUDGET_MODE_TOTAL' ? toCents(c.budget, fx) : null,
      });
    }
    const totalPages = data.page_info?.total_page ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return campaigns;
}

// ---------------------------------------------------------------------------
// Reporting — GET /report/integrated/get/
// data_level=AUCTION_CAMPAIGN, dimensions=[campaign_id, stat_time_day]
// ---------------------------------------------------------------------------

const REPORT_METRICS = ['impressions', 'clicks', 'spend', 'conversion', 'conversion_rate', 'cost_per_conversion', 'total_complete_payment_rate_value'];

export interface TikTokDailyInsightRow {
  date: string; // "2026-09-24"
  campaignId: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/**
 * Pulls per-day performance for every campaign on the advertiser account in
 * one call (TikTok's reporting endpoint is queried across the whole account
 * with campaign_id as a breakdown dimension, unlike Snapchat's
 * per-campaign-only Stats API — see fetchCampaignInsights's doc comment in
 * lib/snapchat.ts for why that one couldn't do the same).
 */
export async function fetchAccountInsights(
  advertiserId: string,
  accessToken: string,
  sinceDate: string, // YYYY-MM-DD
  untilDate: string, // inclusive
  currencyCode?: string | null
): Promise<TikTokDailyInsightRow[]> {
  const fx = fxRateToUsd(currencyCode);
  const rows: TikTokDailyInsightRow[] = [];
  let page = 1;
  while (true) {
    let data: any;
    try {
      data = await apiGet('/report/integrated/get/', accessToken, {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(REPORT_METRICS),
        start_date: sinceDate,
        end_date: untilDate,
        page: String(page),
        page_size: '1000',
      });
    } catch (err: any) {
      // An advertiser with zero reporting history (brand new, or never
      // actually served) can error rather than return an empty series —
      // treat that as "no rows" instead of failing the whole sync, same
      // tolerance as fetchCampaignInsights in lib/snapchat.ts.
      return rows;
    }
    for (const entry of data.list ?? []) {
      const dims = entry.dimensions ?? {};
      const m = entry.metrics ?? {};
      rows.push({
        date: String(dims.stat_time_day).slice(0, 10),
        campaignId: dims.campaign_id,
        impressions: Number(m.impressions ?? 0),
        clicks: Number(m.clicks ?? 0),
        costCents: toCents(m.spend, fx),
        conversions: Number(m.conversion ?? 0),
        conversionValueCents: toCents(m.total_complete_payment_rate_value, fx),
      });
    }
    const totalPages = data.page_info?.total_page ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Write actions — POST /campaign/update/status/ and /campaign/update/
// ---------------------------------------------------------------------------

/** Pauses or resumes a live campaign. */
export async function setCampaignStatus(campaignId: string, advertiserId: string, refreshToken: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  await apiPost('/campaign/update/status/', accessToken, {
    advertiser_id: advertiserId,
    campaign_ids: [campaignId],
    operation_status: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE',
  });
}

/** Updates a campaign's daily budget (only valid for BUDGET_MODE_DAY campaigns). */
export async function updateCampaignDailyBudget(campaignId: string, advertiserId: string, refreshToken: string, newDailyBudgetCents: number): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  await apiPost('/campaign/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    budget: Math.round(newDailyBudgetCents) / 100,
  });
}

export { getAccessToken as getTikTokAccessToken };
