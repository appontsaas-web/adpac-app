import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Google Business Profile integration
//
// A separate Google product family from Google Ads/GA4/GTM — the "branches"
// data: business locations, their search/maps performance, and customer
// reviews. Talks to four distinct API hosts (verified against Google's live,
// 2026-dated documentation before writing any of this):
//   - mybusinessaccountmanagement.googleapis.com  (accounts)
//   - mybusinessbusinessinformation.googleapis.com (locations/branches)
//   - businessprofileperformance.googleapis.com    (daily performance metrics)
//   - mybusiness.googleapis.com/v4                 (reviews + replies — the
//     legacy "My Business API" host, but still the only place reviews live;
//     confirmed still active, doc dated 2026-04-07)
//
// OAuth scope is business.manage — Google classifies this "Sensitive", and
// real production access additionally requires a Google-side approval
// process (60+ day verified Business Profile + a business website) before
// quota is granted above 0. Until approved, calls will fail with a quota
// error — that's expected, not a bug in this code.
//
// You need, from Google Cloud Console:
//   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET — same OAuth client used
//     for Google Ads/GA4/GTM (add the business.manage scope to it in the
//     consent screen config; no separate Cloud project needed)
//   GOOGLE_BUSINESS_REDIRECT_URI — its own registered redirect URI
// Also enable "My Business Account Management API", "My Business Business
// Information API", "Business Profile Performance API", and "My Business
// API" in the Cloud project (APIs & Services > Library) — Business Profile
// APIs are only enabled for projects that have gone through Google's access
// request process (see: https://developers.google.com/my-business/content/prereqs).
// ---------------------------------------------------------------------------

const ACCOUNT_MGMT_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const PERFORMANCE_BASE = 'https://businessprofileperformance.googleapis.com/v1';
const REVIEWS_BASE = 'https://mybusiness.googleapis.com/v4';

const SCOPES = ['https://www.googleapis.com/auth/business.manage'];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_ADS_CLIENT_ID'),
    requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    requireEnv('GOOGLE_BUSINESS_REDIRECT_URI')
  );
}

/** Step 1 of the connect flow: send the operator here to grant access. */
export function getGoogleBusinessAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
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
      'No refresh_token returned. Google only issues one on first consent, or when ' +
        'prompt=consent is forced (which we do) — check your OAuth client config.'
    );
  }
  return tokens;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to refresh Google Business Profile access token');
  return token;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function apiGet(url: string, accessToken: string): Promise<any> {
  const res = await fetch(url, { headers: authHeaders(accessToken) });
  if (!res.ok) {
    throw new Error(`Google Business Profile API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Account Management API — GET /v1/accounts
// ---------------------------------------------------------------------------

export interface GbpAccount {
  name: string; // "accounts/1234567890"
  accountName: string;
  type: string; // PERSONAL | LOCATION_GROUP | USER_GROUP | ORGANIZATION
}

/** Lists the Business Profile accounts the authorizing login has access to. */
export async function listAccounts(refreshToken: string): Promise<GbpAccount[]> {
  const accessToken = await getAccessToken(refreshToken);
  const accounts: GbpAccount[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${ACCOUNT_MGMT_BASE}/accounts`);
    url.searchParams.set('pageSize', '20');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await apiGet(url.toString(), accessToken);
    for (const a of data.accounts ?? []) {
      accounts.push({ name: a.name, accountName: a.accountName, type: a.type });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return accounts;
}

// ---------------------------------------------------------------------------
// Business Information API — GET /v1/{parent=accounts/*}/locations
// ---------------------------------------------------------------------------

export interface GbpLocation {
  name: string; // "locations/1234567890"
  title: string;
  address: string | null; // flattened single-line, best-effort
  primaryPhone: string | null;
  openInfo: string; // OPEN | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY | UNSPECIFIED
  websiteUri: string | null;
}

function flattenAddress(storefrontAddress: any): string | null {
  if (!storefrontAddress) return null;
  const parts: string[] = [
    ...(storefrontAddress.addressLines ?? []),
    storefrontAddress.locality,
    storefrontAddress.administrativeArea,
    storefrontAddress.postalCode,
    storefrontAddress.regionCode,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

const LOCATION_READ_MASK = 'name,title,storefrontAddress,phoneNumbers,openInfo,websiteUri';

/** Lists every branch/location under a Business Profile account. */
export async function listLocations(gbpAccountName: string, refreshToken: string): Promise<GbpLocation[]> {
  const accessToken = await getAccessToken(refreshToken);
  const locations: GbpLocation[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${BUSINESS_INFO_BASE}/${gbpAccountName}/locations`);
    url.searchParams.set('readMask', LOCATION_READ_MASK);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await apiGet(url.toString(), accessToken);
    for (const l of data.locations ?? []) {
      locations.push({
        name: l.name,
        title: l.title,
        address: flattenAddress(l.storefrontAddress),
        primaryPhone: l.phoneNumbers?.primaryPhone ?? null,
        openInfo: l.openInfo?.status ?? 'UNSPECIFIED',
        websiteUri: l.websiteUri ?? null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return locations;
}

/** Confirms the authorizing login actually has access to this account before we store it. */
export async function verifyAccountAccess(gbpAccountName: string, refreshToken: string): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${ACCOUNT_MGMT_BASE}/${gbpAccountName}`, { headers: authHeaders(accessToken) });
  if (!res.ok) {
    throw new Error(
      `Couldn't access Business Profile account ${gbpAccountName}: ${res.status} ${await res.text()}. ` +
        `Make sure the client has added your Google account as a Manager/Owner on this Business Profile.`
    );
  }
}

// ---------------------------------------------------------------------------
// Performance API — GET /v1/{location=locations/*}:fetchMultiDailyMetricsTimeSeries
// ---------------------------------------------------------------------------

export interface GbpDailyPerformance {
  date: string; // "2026-09-24"
  searchImpressions: number;
  mapsImpressions: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  bookings: number;
}

const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
];

function dateParam(prefix: string, d: Date): string {
  return (
    `${prefix}.year=${d.getUTCFullYear()}` +
    `&${prefix}.month=${d.getUTCMonth() + 1}` +
    `&${prefix}.day=${d.getUTCDate()}`
  );
}

/**
 * Pulls per-day performance for one location over [startDate, endDate]
 * (inclusive, UTC), merging all requested dailyMetrics into one row per day.
 */
export async function fetchLocationPerformance(
  gbpLocationName: string,
  refreshToken: string,
  startDate: Date,
  endDate: Date
): Promise<GbpDailyPerformance[]> {
  const accessToken = await getAccessToken(refreshToken);
  const metricsParam = DAILY_METRICS.map((m) => `dailyMetrics=${m}`).join('&');
  const url =
    `${PERFORMANCE_BASE}/${gbpLocationName}:fetchMultiDailyMetricsTimeSeries?` +
    `${metricsParam}` +
    `&${dateParam('dailyRange.start_date', startDate)}` +
    `&${dateParam('dailyRange.end_date', endDate)}`;

  const data = await apiGet(url, accessToken);

  const byDate = new Map<string, GbpDailyPerformance>();
  const ensure = (dateKey: string) => {
    let row = byDate.get(dateKey);
    if (!row) {
      row = {
        date: dateKey,
        searchImpressions: 0,
        mapsImpressions: 0,
        callClicks: 0,
        websiteClicks: 0,
        directionRequests: 0,
        conversations: 0,
        bookings: 0,
      };
      byDate.set(dateKey, row);
    }
    return row;
  };

  for (const series of data.multiDailyMetricTimeSeries ?? []) {
    for (const entry of series.dailyMetricTimeSeries ?? []) {
      const metric: string = entry.dailyMetric;
      for (const dv of entry.timeSeries?.datedValues ?? []) {
        const y = dv.date.year;
        const m = String(dv.date.month).padStart(2, '0');
        const d = String(dv.date.day).padStart(2, '0');
        const dateKey = `${y}-${m}-${d}`;
        const value = Number(dv.value ?? 0);
        const row = ensure(dateKey);
        if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH' || metric === 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH') {
          row.searchImpressions += value;
        } else if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS' || metric === 'BUSINESS_IMPRESSIONS_MOBILE_MAPS') {
          row.mapsImpressions += value;
        } else if (metric === 'CALL_CLICKS') {
          row.callClicks += value;
        } else if (metric === 'WEBSITE_CLICKS') {
          row.websiteClicks += value;
        } else if (metric === 'BUSINESS_DIRECTION_REQUESTS') {
          row.directionRequests += value;
        } else if (metric === 'BUSINESS_CONVERSATIONS') {
          row.conversations += value;
        } else if (metric === 'BUSINESS_BOOKINGS') {
          row.bookings += value;
        }
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Reviews API (v4, legacy host but confirmed still active) —
// GET /v4/{parent=accounts/*/locations/*}/reviews
// PUT /v4/{name=accounts/*/locations/*/reviews/*}/reply
// ---------------------------------------------------------------------------

export interface GbpReview {
  name: string; // full "accounts/*/locations/*/reviews/*"
  reviewerName: string | null;
  starRating: number; // 1-5
  comment: string | null;
  createTime: string;
  updateTime: string;
  hasReply: boolean;
}

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

// Lists all reviews for one location (accounts/{account}/locations/{location} resource path).
export async function listReviews(accountAndLocationPath: string, refreshToken: string): Promise<GbpReview[]> {
  const accessToken = await getAccessToken(refreshToken);
  const reviews: GbpReview[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${REVIEWS_BASE}/${accountAndLocationPath}/reviews`);
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('orderBy', 'updateTime desc');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await apiGet(url.toString(), accessToken);
    for (const r of data.reviews ?? []) {
      reviews.push({
        name: r.name,
        reviewerName: r.reviewer?.isAnonymous ? null : r.reviewer?.displayName ?? null,
        starRating: STAR_RATING_MAP[r.starRating] ?? 0,
        comment: r.comment ?? null,
        createTime: r.createTime,
        updateTime: r.updateTime,
        hasReply: !!r.reviewReply,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return reviews;
}

/** Posts (or replaces) AdPac's reply to a review. Max 4096 bytes per Google's limit. */
export async function postReviewReply(gbpReviewName: string, refreshToken: string, comment: string): Promise<void> {
  if (Buffer.byteLength(comment, 'utf8') > 4096) {
    throw new Error('Review reply exceeds Google\'s 4096-byte limit');
  }
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${REVIEWS_BASE}/${gbpReviewName}/reply`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    throw new Error(`Failed to post review reply: ${res.status} ${await res.text()}`);
  }
}
