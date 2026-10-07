import { google } from 'googleapis';
import { fxRateToUsd as sharedFxRateToUsd } from './fx';

// ---------------------------------------------------------------------------
// Google Ads integration
//
// This talks to the real Google Ads API (v25 REST). It will work as soon as
// you fill in the four GOOGLE_ADS_* env vars — nothing here is mocked. Until
// then, calls will fail with a clear error telling you which credential is
// missing, rather than silently returning fake data.
//
// You need, from Google Cloud Console + Google Ads API Center:
//   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET  — OAuth client (Cloud Console)
//   GOOGLE_ADS_DEVELOPER_TOKEN                        — from your Manager (MCC) account
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID                       — your MCC's customer ID (digits only)
// See README.md "Google Ads setup" for the step-by-step.
// ---------------------------------------------------------------------------

const ADS_API_VERSION = 'v25';
const ADS_API_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

const SCOPES = ['https://www.googleapis.com/auth/adwords'];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_ADS_CLIENT_ID'),
    requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    requireEnv('GOOGLE_ADS_REDIRECT_URI')
  );
}

/** Step 1 of the connect flow: send the client here to grant access. */
export function getGoogleAdsAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token back
    prompt: 'consent', // forces a refresh_token even on repeat connects
    scope: SCOPES,
    state,
  });
}

/** Step 2: exchange the ?code= Google redirects back with for tokens. */
export async function exchangeCodeForTokens(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. This usually means the client already granted ' +
        'access before — Google only issues a refresh_token on the first consent, ' +
        'or when prompt=consent is forced (which we do), so check your OAuth client config.'
    );
  }
  return tokens; // { access_token, refresh_token, expiry_date, ... }
}

/** Turns a stored refresh token back into a short-lived access token. */
async function getAccessToken(refreshToken: string): Promise<string> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to refresh Google Ads access token');
  return token;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
    'login-customer-id': requireEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/-/g, ''),
    'Content-Type': 'application/json',
  };
}

/** Lists the Google Ads accounts (customer IDs) this refresh token can access. */
export async function listAccessibleCustomers(refreshToken: string): Promise<string[]> {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${ADS_API_BASE}/customers:listAccessibleCustomers`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`listAccessibleCustomers failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // resourceNames look like "customers/1234567890"
  return (data.resourceNames ?? []).map((r: string) => r.split('/')[1]);
}

// Fixed FX rates converting a Google Ads account's own billing currency to
// USD, applied to every cost/conversion-value figure as soon as it's
// pulled from the API — so DailyMetric, AudienceMetric, token spend, and
// the AI impact card are all in USD from the start, matching how AdPac's
// prepaid tokens and invoices are priced. Google Ads reports cost_micros
// and conversions_value in the ACCOUNT's currency (see
// fetchAccountCurrency below), not USD — an account billing in SAR returns
// SAR amounts, and treating those as USD cents directly (which this file
// used to do) silently overstates every dollar figure downstream by
// whatever the real exchange rate is.
//
// Only fixed/pegged rates belong in this table — SAR and AED have been
// hard-pegged to USD for decades, so these are exact figures, not
// approximations that go stale like a floating rate would. A currency not
// listed here falls back to 1 (treated as already-USD) with a console
// warning rather than silently mis-converting — add its real rate here if
// that warning ever shows up for a client.
function fxRateToUsd(currencyCode: string | null | undefined): number {
  return sharedFxRateToUsd(currencyCode, 'googleAds');
}

/** Looks up the account's real billing currency (e.g. "SAR", "USD"). */
export async function fetchAccountCurrency(customerId: string, refreshToken: string): Promise<string | null> {
  const accessToken = await getAccessToken(refreshToken);
  const rows = await runSearch(customerId, accessToken, `SELECT customer.currency_code FROM customer LIMIT 1`);
  return rows[0]?.customer?.currencyCode ?? null;
}

export interface DailyMetricRow {
  date: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
  // Search auction-visibility + bid strategy — see the DailyMetric schema
  // comment. searchImpressionSharePct/searchBudgetLostSharePct/
  // searchRankLostSharePct are 0-100 (Google returns 0-1 fractions; this
  // file converts). Only meaningfully populated for Search campaigns —
  // other channel types typically report 0, which is stored as-is rather
  // than guessed at.
  searchImpressionSharePct: number | null;
  searchBudgetLostSharePct: number | null;
  searchRankLostSharePct: number | null;
  // Closest available substitute for competitor-named Auction Insights —
  // see the DailyMetric schema comment for why the real thing isn't
  // reachable via API.
  searchTopImpressionSharePct: number | null;
  searchAbsoluteTopImpressionSharePct: number | null;
  biddingStrategyType: string | null;
}

/**
 * Pulls campaign-level performance for a date range via GAQL. `currencyCode`
 * is the account's own billing currency (see fetchAccountCurrency) — cost
 * and conversion-value figures are converted to USD cents before being
 * returned, using the fixed FX table above. Pass null/omit for an account
 * known to already bill in USD (or not yet looked up — falls back to 1:1).
 */
export async function fetchCampaignMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string, // YYYY-MM-DD
  untilDate: string,
  currencyCode?: string | null
): Promise<DailyMetricRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.bidding_strategy_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share,
      metrics.search_top_impression_share,
      metrics.search_absolute_top_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'
    ORDER BY segments.date DESC
  `;

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`fetchCampaignMetrics failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  // Google returns impression-share metrics as a 0-1 fraction, or omits the
  // field entirely for a channel type that doesn't report it (e.g.
  // Performance Max) — pctOrNull tells "not reported" (undefined) apart
  // from "reported as exactly 0%" (a real, meaningful value).
  const pctOrNull = (v: unknown): number | null => (v === undefined ? null : Number(v) * 100);

  return (data.results ?? []).map((row: any) => ({
    date: row.segments.date,
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    // cost_micros is cost in millionths of the account currency — divide
    // to cents in that currency, then apply the FX rate to get USD cents.
    costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
    conversions: Number(row.metrics.conversions ?? 0),
    conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
    searchImpressionSharePct: pctOrNull(row.metrics.searchImpressionShare),
    searchBudgetLostSharePct: pctOrNull(row.metrics.searchBudgetLostImpressionShare),
    searchRankLostSharePct: pctOrNull(row.metrics.searchRankLostImpressionShare),
    searchTopImpressionSharePct: pctOrNull(row.metrics.searchTopImpressionShare),
    searchAbsoluteTopImpressionSharePct: pctOrNull(row.metrics.searchAbsoluteTopImpressionShare),
    biddingStrategyType: row.campaign.biddingStrategyType ?? null,
  }));
}

/** Runs a raw GAQL search query against a customer account. Shared by the audience-breakdown fetchers below. */
async function runSearch(customerId: string, accessToken: string, query: string): Promise<any[]> {
  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GAQL search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.results ?? [];
}

export interface AudienceMetricRow {
  date: string;
  campaignId: string;
  dimension:
    | 'device'
    | 'age_range'
    | 'gender'
    | 'location'
    | 'region'
    | 'conversion_category'
    | 'click_type'
    | 'conversion_action'
    | 'day_of_week'
    | 'hour';
  dimensionValue: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

function toAudienceRow(
  row: any,
  dimension: AudienceMetricRow['dimension'],
  dimensionValue: string,
  campaignId: string,
  fx: number
): AudienceMetricRow {
  return {
    date: row.segments.date,
    campaignId,
    dimension,
    dimensionValue,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
    conversions: Number(row.metrics.conversions ?? 0),
    conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
  };
}

/**
 * Pulls device, age range, gender, and geographic (by where clicks actually
 * came from, not campaign targeting) performance breakdowns for a date
 * range. Each dimension is a separate GAQL resource in the Google Ads API,
 * queried independently — one dimension failing (e.g. an account with
 * demographic reporting restricted) doesn't block the others; the error is
 * collected and returned alongside whatever rows did come back.
 *
 * `currencyCode` is the account's own billing currency (see
 * fetchAccountCurrency) — same FX conversion as fetchCampaignMetrics.
 */
export async function fetchAudienceMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<{ rows: AudienceMetricRow[]; errors: string[] }> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const rows: AudienceMetricRow[] = [];
  const errors: string[] = [];
  const dateFilter = `segments.date BETWEEN '${sinceDate}' AND '${untilDate}'`;

  // Device — a segment directly on the campaign resource, same pattern as fetchCampaignMetrics.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.device, campaign.id, metrics.impressions, metrics.clicks,
              metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM campaign WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'device', row.segments.device, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`device: ${err.message}`);
  }

  // Conversion category — e.g. PURCHASE, LEAD, SIGN_UP — also a segment
  // directly on the campaign resource. Powers "number of purchases" and
  // similar category-specific counts, since the plain `metrics.conversions`
  // total blends every conversion action type together.
  try {
    // Deliberately NOT selecting impressions/clicks/cost here — Google Ads
    // API restricts which metrics can be combined with which segments, and
    // conversion-category rows only meaningfully need conversion metrics
    // anyway. (costCents/impressions/clicks default to 0 for these rows.)
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.conversion_action_category, campaign.id,
              metrics.conversions, metrics.conversions_value
       FROM campaign WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'conversion_category', row.segments.conversionActionCategory, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`conversion_category: ${err.message}`);
  }

  // Conversion action — the exact named action (e.g. "Local actions -
  // Directions", "Business profile - Directions"), finer-grained than the
  // category breakdown above. Category groups many named actions together;
  // this lets a specific one be pulled out by its exact name.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.conversion_action_name, campaign.id,
              metrics.conversions, metrics.conversions_value
       FROM campaign WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'conversion_action', row.segments.conversionActionName, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`conversion_action: ${err.message}`);
  }

  // Click type — includes location-extension interactions like
  // "LOCATION_FORMAT_MAP" (map clicks) and "LOCATION_FORMAT_DIRECTIONS"
  // (get-directions clicks), alongside the usual headline/URL/call clicks.
  // "Store visits" itself is NOT here — it's tracked as a conversion
  // action (category STORE_VISIT), already captured by the
  // conversion_category block above.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.click_type, campaign.id, metrics.clicks, metrics.cost_micros
       FROM campaign WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'click_type', row.segments.clickType, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`click_type: ${err.message}`);
  }

  // Age range — its own resource view.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, ad_group_criterion.age_range.type, campaign.id, metrics.impressions,
              metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM age_range_view WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'age_range', row.adGroupCriterion.ageRange.type, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`age_range: ${err.message}`);
  }

  // Gender — its own resource view.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, ad_group_criterion.gender.type, campaign.id, metrics.impressions,
              metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM gender_view WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'gender', row.adGroupCriterion.gender.type, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`gender: ${err.message}`);
  }

  // Geographic — performance by the location clicks actually came from (not
  // targeting). Returns numeric criterion IDs, which we resolve to readable
  // names in a second batched lookup rather than one call per row.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, geographic_view.country_criterion_id, campaign.id, metrics.impressions,
              metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM geographic_view WHERE ${dateFilter}`
    );
    const criterionIds = Array.from(
      new Set(results.map((r: any) => r.geographicView.countryCriterionId).filter(Boolean))
    );
    const nameById = new Map<string, string>();
    if (criterionIds.length > 0) {
      const geoResults = await runSearch(
        customerId,
        accessToken,
        `SELECT geo_target_constant.id, geo_target_constant.name
         FROM geo_target_constant WHERE geo_target_constant.id IN (${criterionIds.join(',')})`
      );
      for (const g of geoResults) {
        nameById.set(String(g.geoTargetConstant.id), g.geoTargetConstant.name);
      }
    }
    for (const row of results) {
      const id = String(row.geographicView.countryCriterionId);
      rows.push(toAudienceRow(row, 'location', nameById.get(id) ?? `Location ${id}`, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`location: ${err.message}`);
  }

  // Region (state/province) — one level more granular than the
  // country-only 'location' breakdown above, via segments.geo_target_region
  // on the same geographic_view resource. Returns geo target constant
  // resource names (e.g. "geoTargetConstants/21167"), resolved to readable
  // names the same batched way as country_criterion_id.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.geo_target_region, campaign.id, metrics.impressions,
              metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM geographic_view WHERE ${dateFilter}`
    );
    const regionIds = Array.from(
      new Set(
        results
          .map((r: any) => r.segments.geoTargetRegion?.split('/')?.[1])
          .filter(Boolean)
      )
    );
    const nameById = new Map<string, string>();
    if (regionIds.length > 0) {
      const geoResults = await runSearch(
        customerId,
        accessToken,
        `SELECT geo_target_constant.id, geo_target_constant.name
         FROM geo_target_constant WHERE geo_target_constant.id IN (${regionIds.join(',')})`
      );
      for (const g of geoResults) {
        nameById.set(String(g.geoTargetConstant.id), g.geoTargetConstant.name);
      }
    }
    for (const row of results) {
      const id = row.segments.geoTargetRegion?.split('/')?.[1];
      if (!id) continue; // no region resolved for this row (e.g. traffic with no identifiable region)
      rows.push(toAudienceRow(row, 'region', nameById.get(id) ?? `Region ${id}`, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`region: ${err.message}`);
  }

  // Day of week — when during the week spend/conversions actually happen,
  // e.g. for deciding whether an ad schedule (dayparting) makes sense.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.day_of_week, campaign.id, metrics.impressions, metrics.clicks,
              metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM campaign WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'day_of_week', row.segments.dayOfWeek, row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`day_of_week: ${err.message}`);
  }

  // Hour of day (0-23, account timezone) — same use case as day_of_week,
  // finer-grained.
  try {
    const results = await runSearch(
      customerId,
      accessToken,
      `SELECT segments.date, segments.hour, campaign.id, metrics.impressions, metrics.clicks,
              metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM campaign WHERE ${dateFilter}`
    );
    for (const row of results) {
      rows.push(toAudienceRow(row, 'hour', String(row.segments.hour), row.campaign.id, fx));
    }
  } catch (err: any) {
    errors.push(`hour: ${err.message}`);
  }

  return { rows, errors };
}

export interface KeywordMetricRow {
  date: string;
  campaignId: string;
  adGroupId: string;
  adGroupName: string;
  keywordText: string;
  matchType: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
  avgCpcCents: number;
  qualityScore: number | null;
}

/**
 * Pulls keyword-level performance (Google Ads' keyword_view resource) for a
 * date range — cost/conversion-value converted to USD cents same as
 * fetchCampaignMetrics. Excludes removed criteria so this doesn't fill up
 * with dead keywords from months ago.
 */
export async function fetchKeywordMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<KeywordMetricRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const results = await runSearch(
    customerId,
    accessToken,
    `SELECT segments.date, campaign.id, ad_group.id, ad_group.name,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
            metrics.conversions_value, metrics.average_cpc
     FROM keyword_view
     WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}' AND ad_group_criterion.status != 'REMOVED'`
  );
  return results.map((row: any) => ({
    date: row.segments.date,
    campaignId: row.campaign.id,
    adGroupId: row.adGroup.id,
    adGroupName: row.adGroup.name,
    keywordText: row.adGroupCriterion.keyword.text,
    matchType: row.adGroupCriterion.keyword.matchType,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
    conversions: Number(row.metrics.conversions ?? 0),
    conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
    avgCpcCents: Math.round((Number(row.metrics.averageCpc ?? 0) / 10000) * fx),
    qualityScore: row.adGroupCriterion.qualityInfo?.qualityScore ?? null,
  }));
}

export interface SearchTermMetricRow {
  date: string;
  campaignId: string;
  searchTerm: string;
  matchedKeywordText: string | null;
  matchType: string | null;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/**
 * Pulls the actual search queries that triggered an ad (Google Ads'
 * search_term_view resource) — what real people typed, as opposed to
 * KeywordMetric's "what you bid on". The gap between the two is exactly
 * what a negative-keyword pass is for.
 *
 * Deliberately does NOT select any keyword-related segment
 * (segments.keyword.info.text / ad_group_criterion.keyword.text) here —
 * Google Ads silently drops every row that has no matching explicit
 * criterion (which includes all Dynamic Search Ads traffic) as soon as a
 * keyword segment is present in a search_term_view query, which is exactly
 * why an earlier version of this function came back empty. matchedKeywordText
 * is left null for now rather than risk losing rows to chase it.
 */
export async function fetchSearchTermMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<SearchTermMetricRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const results = await runSearch(
    customerId,
    accessToken,
    `SELECT segments.date, campaign.id, search_term_view.search_term, segments.search_term_match_type,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM search_term_view
     WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'`
  );
  return results.map((row: any) => ({
    date: row.segments.date,
    campaignId: row.campaign.id,
    searchTerm: row.searchTermView.searchTerm,
    matchedKeywordText: null,
    matchType: row.segments.searchTermMatchType ?? null,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
    conversions: Number(row.metrics.conversions ?? 0),
    conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
  }));
}

export interface AdGroupMetricRow {
  date: string;
  campaignId: string;
  adGroupId: string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/** Pulls ad-group-level performance (Google Ads' ad_group resource) for a date range. */
export async function fetchAdGroupMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<AdGroupMetricRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const results = await runSearch(
    customerId,
    accessToken,
    `SELECT segments.date, campaign.id, ad_group.id, ad_group.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM ad_group
     WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}' AND ad_group.status != 'REMOVED'`
  );
  return results.map((row: any) => ({
    date: row.segments.date,
    campaignId: row.campaign.id,
    adGroupId: row.adGroup.id,
    adGroupName: row.adGroup.name,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
    conversions: Number(row.metrics.conversions ?? 0),
    conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
  }));
}

export interface AdMetricRow {
  date: string;
  campaignId: string;
  adGroupId: string;
  adId: string;
  headline: string;
  status: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/**
 * Pulls individual ad (creative) performance (Google Ads' ad_group_ad
 * resource) for a date range. `headline` is derived from the first
 * responsive-search-ad headline, since that's the vast majority of ad types
 * created here (see createSearchCampaign) — falls back to "(no headline)"
 * for any other ad type so this never throws on an ad shape it doesn't
 * specifically know about.
 */
export async function fetchAdMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<AdMetricRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const results = await runSearch(
    customerId,
    accessToken,
    `SELECT segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id,
            ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM ad_group_ad
     WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}' AND ad_group_ad.status != 'REMOVED'`
  );
  return results.map((row: any) => {
    const headlines = row.adGroupAd?.ad?.responsiveSearchAd?.headlines;
    const headline = headlines?.[0]?.text ?? '(no headline)';
    return {
      date: row.segments.date,
      campaignId: row.campaign.id,
      adGroupId: row.adGroup.id,
      adId: row.adGroupAd.ad.id,
      headline,
      status: row.adGroupAd.status,
      impressions: Number(row.metrics.impressions ?? 0),
      clicks: Number(row.metrics.clicks ?? 0),
      costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
      conversions: Number(row.metrics.conversions ?? 0),
      conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
    };
  });
}

export interface AssetGroupMetricRow {
  date: string;
  campaignId: string;
  assetGroupId: string;
  assetGroupName: string;
  status: string;
  impressions: number;
  clicks: number;
  costCents: number;
  conversions: number;
  conversionValueCents: number;
}

/**
 * Pulls Performance Max asset-group-level performance (Google Ads'
 * asset_group resource) for a date range — the PMax equivalent of
 * fetchAdGroupMetrics, since PMax campaigns have no traditional ad groups.
 * Returns rows for every campaign's asset groups; campaigns that aren't
 * PMax simply have none, so this is safe to call unconditionally alongside
 * the other fetchers rather than needing the caller to check channel type
 * first.
 */
export async function fetchAssetGroupMetrics(
  customerId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string,
  currencyCode?: string | null
): Promise<AssetGroupMetricRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const fx = fxRateToUsd(currencyCode);
  const results = await runSearch(
    customerId,
    accessToken,
    `SELECT segments.date, campaign.id, asset_group.id, asset_group.name, asset_group.status,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM asset_group
     WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'`
  );
  return results.map((row: any) => ({
    date: row.segments.date,
    campaignId: row.campaign.id,
    assetGroupId: row.assetGroup.id,
    assetGroupName: row.assetGroup.name,
    status: row.assetGroup.status,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    costCents: Math.round((Number(row.metrics.costMicros ?? 0) / 10000) * fx),
    conversions: Number(row.metrics.conversions ?? 0),
    conversionValueCents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100 * fx),
  }));
}

export interface AssetGroupAssetPerformanceRow {
  campaignId: string;
  assetGroupId: string;
  assetGroupName: string;
  fieldType: string; // e.g. HEADLINE, DESCRIPTION, MARKETING_IMAGE, LOGO, YOUTUBE_VIDEO
  primaryStatus: string; // ELIGIBLE | LIMITED | NOT_ELIGIBLE | PAUSED | PENDING | REMOVED | UNKNOWN
  preview: string; // the asset's text, or a placeholder for non-text assets (images/video)
}

/**
 * Pulls Google's own per-asset serving status for every asset in every
 * Performance Max asset group — this is a current-state signal Google
 * (re)computes continuously, not a daily time-series metric, so unlike
 * everything else in this file it's fetched live on demand (see GET
 * /api/metrics/asset-groups) rather than synced into a local table. No date
 * range: there's no historical version of "is this asset serving right now"
 * to ask for.
 *
 * Uses asset_group_asset.primary_status (ELIGIBLE/LIMITED/NOT_ELIGIBLE/
 * PAUSED/PENDING/REMOVED), NOT the old asset_group_asset.performance_label
 * (BEST/GOOD/LOW/PENDING/LEARNING) — Google removed performance_label from
 * this resource (confirmed against the live v25 field reference; querying
 * it now returns a GAQL UNRECOGNIZED_FIELD error). primary_status is a
 * different concept — serving eligibility rather than a quality ranking —
 * but it's what's actually available: whether an asset is eligible to
 * serve, serving in a limited capacity, or blocked (paused/not eligible/
 * removed) is still real, useful signal for spotting an asset that needs
 * attention.
 */
export async function fetchAssetGroupAssetPerformance(
  customerId: string,
  refreshToken: string
): Promise<AssetGroupAssetPerformanceRow[]> {
  const accessToken = await getAccessToken(refreshToken);
  const results = await runSearch(
    customerId,
    accessToken,
    `SELECT campaign.id, asset_group.id, asset_group.name, asset_group_asset.field_type,
            asset_group_asset.primary_status, asset.text_asset.text, asset.type
     FROM asset_group_asset
     WHERE asset_group_asset.status != 'REMOVED'`
  );
  return results.map((row: any) => {
    const textAsset = row.asset?.textAsset?.text;
    const assetType = row.asset?.type;
    return {
      campaignId: row.campaign.id,
      assetGroupId: row.assetGroup.id,
      assetGroupName: row.assetGroup.name,
      fieldType: row.assetGroupAsset.fieldType,
      primaryStatus: row.assetGroupAsset.primaryStatus ?? 'UNKNOWN',
      preview: textAsset ?? (assetType ? `(${assetType.toLowerCase()} asset)` : '(asset)'),
    };
  });
}

export interface ExistingCampaign {
  googleCampaignId: string;
  name: string;
  status: string; // Google's raw status: ENABLED | PAUSED | REMOVED
  channelType: string; // Google's raw channel type: SEARCH | PERFORMANCE_MAX | DISPLAY | SHOPPING | VIDEO | ...
  dailyBudgetCents: number;
}

/**
 * Lists campaigns that already exist on a Google Ads account — i.e. ones
 * created directly in the Google Ads UI (or elsewhere), not through AdPac.
 * Used to import them into our own Campaign table so metrics sync and
 * reporting can actually match and track them (sync only works for
 * campaigns with a local row whose googleCampaignId matches).
 */
export async function fetchExistingCampaigns(customerId: string, refreshToken: string): Promise<ExistingCampaign[]> {
  const accessToken = await getAccessToken(refreshToken);
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `;

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`fetchExistingCampaigns failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  return (data.results ?? []).map((row: any) => ({
    googleCampaignId: row.campaign.id,
    name: row.campaign.name,
    status: row.campaign.status,
    channelType: row.campaign.advertisingChannelType,
    // amount_micros is in millionths of the account currency; cents = micros / 10000
    dailyBudgetCents: Math.round(Number(row.campaignBudget?.amountMicros ?? 0) / 10000),
  }));
}

export interface GoogleRecommendation {
  resourceName: string;
  type: string;
  campaignId?: string;
  summary: string;
}

/**
 * Pulls Google's own AI-generated optimization suggestions for an account.
 * This is the fastest, most defensible way to ship "AI optimization" in
 * phase 1 — you're surfacing and (with approval) applying Google's own
 * recommendation engine rather than trying to out-guess it from scratch.
 */
export async function fetchRecommendations(
  customerId: string,
  refreshToken: string
): Promise<GoogleRecommendation[]> {
  const accessToken = await getAccessToken(refreshToken);
  const query = `
    SELECT
      recommendation.resource_name,
      recommendation.type,
      recommendation.campaign
    FROM recommendation
    LIMIT 50
  `;
  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`fetchRecommendations failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  return (data.results ?? []).map((row: any) => ({
    resourceName: row.recommendation.resourceName,
    type: row.recommendation.type,
    campaignId: row.recommendation.campaign?.split('/')?.[3],
    summary: row.recommendation.type.replaceAll('_', ' ').toLowerCase(),
  }));
}

/** Applies a single Google-generated recommendation. Requires human approval upstream. */
export async function applyRecommendation(customerId: string, refreshToken: string, resourceName: string) {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/recommendations:apply`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ operations: [{ resourceName }] }),
  });
  if (!res.ok) throw new Error(`applyRecommendation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export interface CampaignDraft {
  name: string;
  dailyBudgetCents: number;
  finalUrl: string;
  keywords: string[]; // broad/phrase seed keywords
  headlines: string[]; // up to 15, responsive search ad
  descriptions: string[]; // up to 4
  locations?: string[]; // e.g. ["Lebanon", "United Arab Emirates"] — resolved to real geo targets below
}

/**
 * Resolves free-text location names (e.g. "Lebanon", "Beirut") to Google's
 * GeoTargetConstant resource names (e.g. "geoTargetConstants/2422") via
 * GeoTargetConstantService.SuggestGeoTargetConstants. Takes the top
 * suggestion for each name. Names that don't resolve to anything are
 * skipped (logged, not thrown) rather than failing the whole campaign
 * creation over one bad location string.
 */
export async function suggestGeoTargetConstants(locationNames: string[], refreshToken: string): Promise<string[]> {
  if (locationNames.length === 0) return [];
  const accessToken = await getAccessToken(refreshToken);

  const res = await fetch(`${ADS_API_BASE}/geoTargetConstants:suggest`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ locationNames: { names: locationNames }, locale: 'en' }),
  });
  if (!res.ok) throw new Error(`suggestGeoTargetConstants failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const suggestions = (data.geoTargetConstantSuggestions ?? []) as any[];
  const resourceNames: string[] = [];
  for (const name of locationNames) {
    const match = suggestions.find(
      (s) => s.geoTargetConstant?.name?.toLowerCase() === name.trim().toLowerCase()
    );
    const best = match ?? suggestions.find((s) => s.geoTargetConstant?.resourceName && !resourceNames.includes(s.geoTargetConstant.resourceName));
    if (best?.geoTargetConstant?.resourceName) {
      resourceNames.push(best.geoTargetConstant.resourceName);
    } else {
      console.warn(`suggestGeoTargetConstants: no match found for location "${name}" — skipped`);
    }
  }
  return resourceNames;
}

/**
 * Creates a live Search campaign from an approved AI draft: budget, campaign,
 * ad group, keywords, a responsive search ad, and (if locations are given)
 * geo-targeting criteria — as one atomic mutate request using temporary
 * (negative) resource IDs to link them together. This is the standard
 * Google Ads API pattern for creating a full campaign tree in a single call.
 */
export async function createSearchCampaign(customerId: string, refreshToken: string, draft: CampaignDraft) {
  const accessToken = await getAccessToken(refreshToken);

  const budgetTemp = '-1';
  const campaignTemp = '-2';
  const adGroupTemp = '-3';
  const adGroupAdTemp = '-4';

  // Resolved before building the mutate request since it's a separate API call.
  const geoTargetResourceNames = draft.locations?.length
    ? await suggestGeoTargetConstants(draft.locations, refreshToken)
    : [];

  const operations = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: `customers/${customerId}/campaignBudgets/${budgetTemp}`,
          name: `${draft.name} Budget`,
          amountMicros: String(draft.dailyBudgetCents * 10000),
          deliveryMethod: 'STANDARD',
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: `customers/${customerId}/campaigns/${campaignTemp}`,
          name: draft.name,
          advertisingChannelType: 'SEARCH',
          status: 'PAUSED', // always create paused — human turns it on
          campaignBudget: `customers/${customerId}/campaignBudgets/${budgetTemp}`,
          maximizeConversions: {}, // Smart Bidding: let Google's own optimizer set bids
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: false,
            targetContentNetwork: false,
          },
        },
      },
    },
    {
      adGroupOperation: {
        create: {
          resourceName: `customers/${customerId}/adGroups/${adGroupTemp}`,
          name: `${draft.name} Ad Group`,
          campaign: `customers/${customerId}/campaigns/${campaignTemp}`,
          status: 'ENABLED',
          type: 'SEARCH_STANDARD',
        },
      },
    },
    ...draft.keywords.map((kw) => ({
      adGroupCriterionOperation: {
        create: {
          adGroup: `customers/${customerId}/adGroups/${adGroupTemp}`,
          status: 'ENABLED',
          keyword: { text: kw, matchType: 'PHRASE' },
        },
      },
    })),
    {
      adGroupAdOperation: {
        create: {
          resourceName: `customers/${customerId}/adGroupAds/${adGroupAdTemp}`,
          adGroup: `customers/${customerId}/adGroups/${adGroupTemp}`,
          status: 'ENABLED',
          ad: {
            finalUrls: [draft.finalUrl],
            responsiveSearchAd: {
              headlines: draft.headlines.map((text) => ({ text })),
              descriptions: draft.descriptions.map((text) => ({ text })),
            },
          },
        },
      },
    },
    // Geo targeting — without these, Google Ads defaults to targeting
    // everywhere, which is almost never what a client actually wants.
    ...geoTargetResourceNames.map((geoTargetConstant) => ({
      campaignCriterionOperation: {
        create: {
          campaign: `customers/${customerId}/campaigns/${campaignTemp}`,
          location: { geoTargetConstant },
        },
      },
    })),
  ];

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/googleAds:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ mutateOperations: operations }),
  });
  if (!res.ok) throw new Error(`createSearchCampaign failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// AI-insight execution — the three write actions an approved AI recommendation
// (see lib/aiInsights.ts) can actually carry out on Google Ads. Every one of
// these is only ever called from /api/ai-insights/[id]/approve, after a human
// has reviewed and clicked Approve — nothing here runs automatically.
// ---------------------------------------------------------------------------

/** Pauses (or re-enables) a campaign that's already live on Google Ads. */
export async function setCampaignStatus(
  customerId: string,
  refreshToken: string,
  googleCampaignId: string,
  status: 'PAUSED' | 'ENABLED'
) {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/campaigns:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      operations: [
        {
          update: { resourceName: `customers/${customerId}/campaigns/${googleCampaignId}`, status },
          updateMask: 'status',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`setCampaignStatus failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Updates a live campaign's daily budget. The budget lives in a separate
 * CampaignBudget resource, whose resource name isn't stored locally (only
 * dailyBudgetCents is, at creation time) — so this looks it up via GAQL
 * first, same pattern as the other read helpers above.
 */
export async function updateCampaignBudget(
  customerId: string,
  refreshToken: string,
  googleCampaignId: string,
  newDailyBudgetCents: number
) {
  const accessToken = await getAccessToken(refreshToken);

  const rows = await runSearch(
    customerId,
    accessToken,
    `SELECT campaign_budget.resource_name FROM campaign WHERE campaign.id = ${googleCampaignId}`
  );
  const budgetResourceName = rows[0]?.campaignBudget?.resourceName;
  if (!budgetResourceName) {
    throw new Error(`Couldn't find the campaign budget resource for campaign ${googleCampaignId}`);
  }

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/campaignBudgets:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      operations: [
        {
          update: { resourceName: budgetResourceName, amountMicros: String(newDailyBudgetCents * 10000) },
          updateMask: 'amount_micros',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`updateCampaignBudget failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Replaces the headlines/descriptions on a live campaign's responsive search
 * ad. Like the budget update above, the ad's resource name isn't stored
 * locally, so this looks up the campaign's (first) ad_group_ad via GAQL
 * first. Phase 1 campaigns only ever have one ad group / one ad (see
 * createSearchCampaign), so "the campaign's ad" is unambiguous.
 */
export async function updateResponsiveSearchAd(
  customerId: string,
  refreshToken: string,
  googleCampaignId: string,
  headlines: string[],
  descriptions: string[]
) {
  const accessToken = await getAccessToken(refreshToken);

  const rows = await runSearch(
    customerId,
    accessToken,
    `SELECT ad_group_ad.resource_name FROM ad_group_ad
     WHERE campaign.id = ${googleCampaignId} AND ad_group_ad.status != 'REMOVED'`
  );
  const adResourceName = rows[0]?.adGroupAd?.resourceName;
  if (!adResourceName) {
    throw new Error(`Couldn't find a live ad for campaign ${googleCampaignId}`);
  }

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/adGroupAds:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      operations: [
        {
          update: {
            resourceName: adResourceName,
            ad: {
              responsiveSearchAd: {
                headlines: headlines.map((text) => ({ text })),
                descriptions: descriptions.map((text) => ({ text })),
              },
            },
          },
          updateMask: 'ad.responsive_search_ad.headlines,ad.responsive_search_ad.descriptions',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`updateResponsiveSearchAd failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Pauses (or re-enables) a single ad within an ad group — the execution
 * side of a Creative A/B Test's losing variant (see lib/creativeTests.ts).
 * Builds the ad_group_ad resource name directly from adGroupId + adId
 * (Google's own `customers/{cid}/adGroupAds/{ad_group_id}~{ad_id}` format)
 * rather than looking it up first, since both ids are already known from
 * AdMetric/CreativeTestVariant.
 */
export async function setAdStatus(
  customerId: string,
  refreshToken: string,
  adGroupId: string,
  adId: string,
  status: 'ENABLED' | 'PAUSED'
) {
  const accessToken = await getAccessToken(refreshToken);
  const resourceName = `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`;

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/adGroupAds:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      operations: [{ update: { resourceName, status }, updateMask: 'status' }],
    }),
  });
  if (!res.ok) throw new Error(`setAdStatus failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Adds campaign-level negative keywords (PHRASE match) — the execution side
 * of the ADD_NEGATIVE_KEYWORDS AI insight (see lib/aiInsights.ts). PHRASE
 * match on the exact wasted search term, same match-type convention as the
 * positive keywords in createSearchCampaign, so a negative here reliably
 * blocks the term (and close variants) without being so broad it risks
 * blocking unrelated, currently-converting traffic the way a BROAD-match
 * negative could.
 */
export async function addNegativeKeywords(
  customerId: string,
  refreshToken: string,
  googleCampaignId: string,
  keywords: string[]
) {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/campaignCriteria:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      operations: keywords.map((text) => ({
        create: {
          campaign: `customers/${customerId}/campaigns/${googleCampaignId}`,
          negative: true,
          keyword: { text, matchType: 'PHRASE' },
        },
      })),
    }),
  });
  if (!res.ok) throw new Error(`addNegativeKeywords failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Sets a device bid modifier (the execution side of the ADJUST_BID_MODIFIER
 * AI insight, DEVICE variant — see lib/aiInsights.ts). Google Ads Search
 * campaigns normally already have one campaign_criterion per device type
 * (MOBILE/DESKTOP/TABLET) at the default 1.0 modifier as soon as they're
 * created, so this looks for an existing one to UPDATE first and only
 * CREATEs if none is found (e.g. an imported campaign that never had one
 * explicitly set). bidModifier follows Google's own scale: 1.0 = no change,
 * 0 = opt out of this device entirely, range 0.1-10.0 otherwise.
 */
export async function setDeviceBidModifier(
  customerId: string,
  refreshToken: string,
  googleCampaignId: string,
  deviceType: string,
  bidModifier: number
) {
  const accessToken = await getAccessToken(refreshToken);
  const rows = await runSearch(
    customerId,
    accessToken,
    `SELECT campaign_criterion.resource_name FROM campaign_criterion
     WHERE campaign.id = ${googleCampaignId} AND campaign_criterion.type = 'DEVICE'
       AND campaign_criterion.device.type = '${deviceType}'`
  );
  const existingResourceName = rows[0]?.campaignCriterion?.resourceName;

  const operation = existingResourceName
    ? { update: { resourceName: existingResourceName, bidModifier }, updateMask: 'bid_modifier' }
    : {
        create: {
          campaign: `customers/${customerId}/campaigns/${googleCampaignId}`,
          device: { type: deviceType },
          bidModifier,
        },
      };

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/campaignCriteria:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ operations: [operation] }),
  });
  if (!res.ok) throw new Error(`setDeviceBidModifier failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Sets an hour-of-day (dayparting) bid modifier — the ADJUST_BID_MODIFIER
 * AI insight's HOUR variant. Unlike device criteria, Google Ads does not
 * auto-create ad_schedule criteria for a campaign, and ad_schedule fields
 * are immutable after creation (the API prohibits them on UPDATE) — so this
 * always CREATEs new criteria, one per day of the week, all covering the
 * same [hour, hour+1) slot with the same bidModifier, in a single mutate
 * call. If an identical schedule criterion already exists for a day, that
 * one operation fails and the whole approve request surfaces as FAILED with
 * Google's own error — same handling as every other insight type, not
 * papered over here.
 */
export async function setHourBidModifier(
  customerId: string,
  refreshToken: string,
  googleCampaignId: string,
  hour: number,
  bidModifier: number
) {
  const accessToken = await getAccessToken(refreshToken);
  const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const endHour = hour === 23 ? 24 : hour + 1;

  const operations = days.map((dayOfWeek) => ({
    create: {
      campaign: `customers/${customerId}/campaigns/${googleCampaignId}`,
      adSchedule: {
        dayOfWeek,
        startHour: hour,
        startMinute: 'ZERO',
        endHour,
        endMinute: 'ZERO',
      },
      bidModifier,
    },
  }));

  const res = await fetch(`${ADS_API_BASE}/customers/${customerId}/campaignCriteria:mutate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ operations }),
  });
  if (!res.ok) throw new Error(`setHourBidModifier failed: ${res.status} ${await res.text()}`);
  return res.json();
}
