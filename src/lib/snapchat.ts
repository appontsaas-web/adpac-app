// ---------------------------------------------------------------------------
// Snapchat Marketing API integration
//
// Verified against Snap's live developer docs (developers.snap.com) before
// writing this. Snapchat's hierarchy is Organization -> Ad Account ->
// Campaign -> Ad Squad -> Ad, one level deeper than Meta's flat
// "ad account -> campaign" — an ad account belongs to an Organization, and
// one login can have access to several Organizations, each with several ad
// accounts. GET /me/organizations?with_ad_accounts=true returns everything
// in one call, which is what the connect flow uses to build the picker.
//
// Unlike Meta, Snapchat's OAuth is a conventional OAuth 2.0 flow with a real
// refresh_token: the access token is short-lived (60 minutes) but the
// refresh_token itself doesn't expire on its own, so there's no Meta-style
// "re-exchange on every sync to keep it alive" dance — just request a fresh
// access token with the stored refresh_token whenever one is needed, the
// same shape as lib/googleAds.ts's getAccessToken.
//
// You need, from a Snap Business Manager OAuth app (Business Details ->
// developer apps, must be an Organization Admin to see it):
//   SNAPCHAT_CLIENT_ID / SNAPCHAT_CLIENT_SECRET — the app's own credentials
//   SNAPCHAT_REDIRECT_URI                        — its own registered OAuth redirect URI
// The app needs the snapchat-marketing-api scope.
// See README.md "Snapchat Ads setup" for the step-by-step once written.
// ---------------------------------------------------------------------------

const SNAP_API_BASE = 'https://adsapi.snapchat.com/v1';
const SNAP_AUTH_BASE = 'https://accounts.snapchat.com/login/oauth2';

const SCOPES = ['snapchat-marketing-api'];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

/** Step 1 of the connect flow: send the operator here to grant access. */
export function getSnapchatAuthUrl(state: string): string {
  const url = new URL(`${SNAP_AUTH_BASE}/authorize`);
  url.searchParams.set('client_id', requireEnv('SNAPCHAT_CLIENT_ID'));
  url.searchParams.set('redirect_uri', requireEnv('SNAPCHAT_REDIRECT_URI'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export interface SnapTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

async function tokenRequest(body: Record<string, string>): Promise<SnapTokenResult> {
  const res = await fetch(`${SNAP_AUTH_BASE}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('SNAPCHAT_CLIENT_ID'),
      client_secret: requireEnv('SNAPCHAT_CLIENT_SECRET'),
      ...body,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Snapchat token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
  };
}

/** Step 2: exchange the ?code= Snapchat redirects back with for an access + refresh token pair. */
export async function exchangeCodeForTokens(code: string): Promise<SnapTokenResult> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: requireEnv('SNAPCHAT_REDIRECT_URI'),
  });
}

/**
 * Requests a fresh access token using the stored (never-expiring)
 * refresh_token. Snapchat's response includes a refresh_token too, but per
 * Snap's docs the original refresh_token remains valid — same
 * don't-rotate-what-you-store approach as lib/googleAds.ts's getAccessToken,
 * so callers only need the returned accessToken, not a new refresh token.
 */
async function getAccessToken(refreshToken: string): Promise<string> {
  const result = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return result.accessToken;
}

function authedUrl(path: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${SNAP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

async function apiGet(url: URL, accessToken: string): Promise<any> {
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Snapchat API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiRequest(path: string, accessToken: string, method: string, body: any): Promise<any> {
  const res = await fetch(`${SNAP_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Snapchat API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Organizations & Ad Accounts — GET /me/organizations?with_ad_accounts=true
// ---------------------------------------------------------------------------

export interface SnapAdAccountInfo {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  currency: string; // AUD | DKK | CAD | EUR | GBP | NOK | SEK | USD
  timezone: string;
}

/** Lists every ad account this refresh token's user can access, across every Organization. */
export async function listOrgAdAccounts(refreshToken: string): Promise<SnapAdAccountInfo[]> {
  const accessToken = await getAccessToken(refreshToken);
  const data = await apiGet(authedUrl('/me/organizations', { with_ad_accounts: 'true' }), accessToken);
  const accounts: SnapAdAccountInfo[] = [];
  for (const orgEntry of data.organizations ?? []) {
    const org = orgEntry.organization;
    for (const a of org.ad_accounts ?? []) {
      accounts.push({
        id: a.id,
        name: a.name,
        organizationId: org.id,
        organizationName: org.name,
        currency: a.currency,
        timezone: a.timezone,
      });
    }
  }
  return accounts;
}

/** Confirms the token can actually access this ad account before we store it, and returns its current details. */
export async function verifyAdAccountAccess(adAccountId: string, refreshToken: string): Promise<SnapAdAccountInfo | null> {
  const accessToken = await getAccessToken(refreshToken);
  const data = await apiGet(authedUrl(`/adaccounts/${adAccountId}`), accessToken);
  const entry = data.adaccounts?.[0]?.adaccount;
  if (!entry) return null;
  return {
    id: entry.id,
    name: entry.name,
    organizationId: entry.organization_id,
    organizationName: '',
    currency: entry.currency,
    timezone: entry.timezone,
  };
}

// Fixed FX rates converting a Snap ad account's own billing currency to
// USD — same rationale and same "fixed/pegged rates only, else assume USD
// 1:1 with a console warning" approach as lib/meta.ts's FX_RATE_TO_USD
// (kept as its own copy rather than shared, matching how every ad-platform
// integration in this app keeps its own FX table).
const FX_RATE_TO_USD: Record<string, number> = {
  USD: 1,
};

function fxRateToUsd(currencyCode: string | null | undefined): number {
  if (!currencyCode) return 1;
  const rate = FX_RATE_TO_USD[currencyCode.toUpperCase()];
  if (rate === undefined) {
    console.warn(
      `snapchat: no FX rate configured for currency "${currencyCode}" — treating as USD 1:1. ` +
        `Add its real rate to FX_RATE_TO_USD in lib/snapchat.ts.`
    );
    return 1;
  }
  return rate;
}

// Snapchat reports money as "micro-currency": 1.00 local currency unit =
// 1,000,000 micro. Same divide-by-10000-then-apply-FX shape as Google Ads'
// cost_micros handling in lib/googleAds.ts (also a micro-currency unit).
function microToCents(micro: number | string | undefined, fxRate: number): number {
  return Math.round((Number(micro ?? 0) / 10000) * fxRate);
}

// ---------------------------------------------------------------------------
// Campaigns — GET /adaccounts/{ad_account_id}/campaigns
// ---------------------------------------------------------------------------

export interface SnapCampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string; // ACTIVE | PAUSED
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
}

/**
 * Imports existing campaigns on the ad account (same "import existing"
 * model as listCampaigns in lib/meta.ts / fetchExistingCampaigns in
 * lib/googleAds.ts).
 */
export async function listCampaigns(adAccountId: string, refreshToken: string, currencyCode?: string | null): Promise<SnapCampaignRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const data = await apiGet(authedUrl(`/adaccounts/${adAccountId}/campaigns`), accessToken);
  const campaigns: SnapCampaignRow[] = [];
  for (const entry of data.campaigns ?? []) {
    const c = entry.campaign;
    if (!c) continue;
    campaigns.push({
      id: c.id,
      name: c.name,
      objective: c.objective ?? 'BRAND_AWARENESS',
      status: c.status,
      dailyBudgetCents: c.daily_budget_micro !== undefined ? microToCents(c.daily_budget_micro, fx) : null,
      lifetimeBudgetCents: c.lifetime_spend_cap_micro !== undefined ? microToCents(c.lifetime_spend_cap_micro, fx) : null,
    });
  }
  return campaigns;
}

// ---------------------------------------------------------------------------
// Stats — GET /campaigns/{campaign_id}/stats
//
// Queried per-campaign rather than via the ad-account-level `breakdown=
// campaign` stats endpoint: Snap's docs fully document the per-entity
// TOTAL/DAY/HOUR response shape used here, but not the exact shape a
// breakdown query returns, so this takes the confirmed-correct path (one
// call per campaign) rather than guess at an unconfirmed one — same
// judgment call as calling Meta's Insights API once per breakdown
// dimension in lib/meta.ts rather than assuming an unverified combined
// shape. Worth revisiting if per-campaign call volume becomes a problem for
// an account with many campaigns.
// ---------------------------------------------------------------------------

// A representative subset of Snapchat's conversion_* stat fields, summed
// together into one "conversions" number — same deliberate simplification
// as lib/meta.ts summing every action_type in Meta's `actions` array,
// documented here rather than hidden. conversion_purchases_value is the
// only paired "_value" field in this set, used for conversion value/ROAS.
const CONVERSION_FIELDS = [
  'conversion_purchases',
  'conversion_sign_ups',
  'conversion_app_opens',
  'conversion_page_views',
  'conversion_add_cart',
  'conversion_view_content',
  'conversion_save',
  'conversion_start_checkout',
];
const CONVERSION_VALUE_FIELD = 'conversion_purchases_value';

const STATS_FIELDS = ['impressions', 'swipes', 'spend', ...CONVERSION_FIELDS, CONVERSION_VALUE_FIELD].join(',');

export interface SnapDailyInsightRow {
  date: string; // "2026-09-24"
  campaignId: string;
  impressions: number;
  clicks: number; // Snapchat's "swipes"
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/** Pulls per-day performance for one campaign via the Stats API (granularity=DAY). */
export async function fetchCampaignInsights(
  campaignId: string,
  refreshToken: string,
  sinceDate: string, // YYYY-MM-DD
  untilDate: string, // inclusive
  currencyCode?: string | null
): Promise<SnapDailyInsightRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);

  // DAY granularity's end_time is exclusive of the final day, so this asks
  // for one day past `untilDate` to include it in full — same half-open
  // interval convention used elsewhere (e.g. Google Ads BETWEEN queries are
  // inclusive on both ends, but Snap's stats window isn't, per its docs).
  const untilExclusive = new Date(untilDate);
  untilExclusive.setDate(untilExclusive.getDate() + 1);

  const url = authedUrl(`/campaigns/${campaignId}/stats`, {
    granularity: 'DAY',
    start_time: `${sinceDate}T00:00:00`,
    end_time: `${untilExclusive.toISOString().slice(0, 10)}T00:00:00`,
    fields: STATS_FIELDS,
  });

  let data: any;
  try {
    data = await apiGet(url, accessToken);
  } catch (err: any) {
    // A campaign with zero stats history (brand new, or never actually
    // served) can 404/error rather than return an empty series — treat
    // that as "no rows" instead of failing the whole sync. Logged (not
    // silently swallowed) so a REAL Stats API error — bad param, revoked
    // scope, etc. — is still visible in production logs instead of just
    // looking like "no data" with no trace of why.
    console.error(`snapchat: stats fetch failed for campaign ${campaignId}:`, err.message);
    return [];
  }

  const rows: SnapDailyInsightRow[] = [];
  for (const entry of data.timeseries_stats ?? []) {
    const series = entry.timeseries_stat?.timeseries ?? [];
    for (const point of series) {
      const stats = point.stats ?? {};
      const conversions = CONVERSION_FIELDS.reduce((sum, f) => sum + Number(stats[f] ?? 0), 0);
      rows.push({
        date: String(point.start_time).slice(0, 10),
        campaignId,
        impressions: Number(stats.impressions ?? 0),
        clicks: Number(stats.swipes ?? 0),
        costCents: microToCents(stats.spend, fx),
        conversions,
        conversionValueCents: microToCents(stats[CONVERSION_VALUE_FIELD], fx),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Write actions — PUT /adaccounts/{ad_account_id}/campaigns
// Snapchat's update endpoints expect the FULL object back (same
// "IMPORTANT! omitted attributes reset to default" behavior documented for
// Ad Accounts) — these two helpers re-fetch the campaign first so nothing
// else on it gets clobbered by a partial update.
// ---------------------------------------------------------------------------

async function getCampaignRaw(campaignId: string, accessToken: string): Promise<any> {
  const data = await apiGet(authedUrl(`/campaigns/${campaignId}`), accessToken);
  return data.campaigns?.[0]?.campaign;
}

/** Pauses or resumes a live campaign. */
export async function setCampaignStatus(campaignId: string, refreshToken: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const current = await getCampaignRaw(campaignId, accessToken);
  if (!current) throw new Error(`Snapchat campaign ${campaignId} not found`);
  await apiRequest(`/campaigns/${campaignId}`, accessToken, 'PUT', {
    campaigns: [{ ...current, status }],
  });
}

/**
 * Updates a campaign's daily budget. newDailyBudgetCents is converted to
 * Snap's micro-currency (cents * 10000) before sending — the inverse of
 * microToCents used everywhere else in this file.
 */
export async function updateCampaignDailyBudget(campaignId: string, refreshToken: string, newDailyBudgetCents: number): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const current = await getCampaignRaw(campaignId, accessToken);
  if (!current) throw new Error(`Snapchat campaign ${campaignId} not found`);
  await apiRequest(`/campaigns/${campaignId}`, accessToken, 'PUT', {
    campaigns: [{ ...current, daily_budget_micro: String(Math.round(newDailyBudgetCents * 10000)) }],
  });
}
