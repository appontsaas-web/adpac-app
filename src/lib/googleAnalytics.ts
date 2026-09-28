import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Google Analytics (GA4) integration
//
// Talks to the real GA4 Data API and Admin API — nothing here is mocked.
// Read-only (analytics.readonly scope), so this can never modify a client's
// property, only report on it.
//
// Unlike Google Ads, GA4 has no Manager-account hierarchy AdPac can create
// client properties under. The client has to add AdPac's own Google login as
// a Viewer/Analyst on their GA4 property first (Admin > Property Access
// Management > Add users), the same way you'd invite any teammate. Once
// that's done, connecting here works exactly like Google Ads: the operator
// enters the property ID the client gave them, then authorizes with AdPac's
// own login (which now has access to it) — see the connect route for why we
// don't try to auto-discover the property from OAuth instead.
//
// You need, from Google Cloud Console:
//   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET — same OAuth client used
//     for Google Ads (add the analytics.readonly scope to it in the consent
//     screen config; no separate Cloud project needed)
//   GOOGLE_ANALYTICS_REDIRECT_URI — its own registered redirect URI
// Also enable "Google Analytics Data API" and "Google Analytics Admin API"
// in the Cloud project (APIs & Services > Library).
// ---------------------------------------------------------------------------

const DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const ADMIN_API_BASE = 'https://analyticsadmin.googleapis.com/v1beta';

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return val;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_ADS_CLIENT_ID'),
    requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    requireEnv('GOOGLE_ANALYTICS_REDIRECT_URI')
  );
}

/** Step 1 of the connect flow: send the client here to grant access. */
export function getGoogleAnalyticsAuthUrl(state: string): string {
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
  if (!token) throw new Error('Failed to refresh Google Analytics access token');
  return token;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/** Confirms the authorizing login actually has access to this property (and that the ID is real) before we store it. */
export async function verifyPropertyAccess(propertyId: string, refreshToken: string): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${ADMIN_API_BASE}/properties/${propertyId}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(
      `Couldn't access GA4 property ${propertyId}: ${res.status} ${await res.text()}. ` +
        `Make sure the client has added your Google account as a Viewer on this property.`
    );
  }
}

export interface GA4ReportRow {
  date: string;
  sessions: number;
  activeUsers: number;
  engagedSessions: number;
  averageEngagementTimeSeconds: number;
  conversions: number;
  totalRevenue: number;
}

export interface GA4ChannelRow {
  channel: string;
  sessions: number;
  conversions: number;
}

/**
 * Pulls a daily summary (sessions, users, engagement, conversions, revenue)
 * plus a channel-grouping breakdown for a date range, via the GA4 Data API.
 * Queried live on each request rather than synced/cached locally — the Data
 * API handles arbitrary date ranges cheaply, unlike Google Ads' quota model
 * which is why that integration needed a local DailyMetric table.
 */
export async function runGA4Report(
  propertyId: string,
  refreshToken: string,
  sinceDate: string, // YYYY-MM-DD
  untilDate: string
): Promise<{ daily: GA4ReportRow[]; channels: GA4ChannelRow[] }> {
  const accessToken = await getAccessToken(refreshToken);

  const dailyRes = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'engagedSessions' },
        { name: 'averageSessionDuration' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
  });
  if (!dailyRes.ok) throw new Error(`GA4 runReport (daily) failed: ${dailyRes.status} ${await dailyRes.text()}`);
  const dailyData = await dailyRes.json();

  const daily: GA4ReportRow[] = (dailyData.rows ?? []).map((row: any) => {
    const v = row.metricValues;
    const raw = row.dimensionValues[0].value; // YYYYMMDD
    return {
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      sessions: Number(v[0].value ?? 0),
      activeUsers: Number(v[1].value ?? 0),
      engagedSessions: Number(v[2].value ?? 0),
      averageEngagementTimeSeconds: Number(v[3].value ?? 0),
      conversions: Number(v[4].value ?? 0),
      totalRevenue: Number(v[5].value ?? 0),
    };
  });

  const channelRes = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
  });
  if (!channelRes.ok) throw new Error(`GA4 runReport (channels) failed: ${channelRes.status} ${await channelRes.text()}`);
  const channelData = await channelRes.json();

  const channels: GA4ChannelRow[] = (channelData.rows ?? []).map((row: any) => ({
    channel: row.dimensionValues[0].value,
    sessions: Number(row.metricValues[0].value ?? 0),
    conversions: Number(row.metricValues[1].value ?? 0),
  }));

  return { daily, channels };
}

export interface GA4LandingPageRow {
  landingPage: string;
  sessions: number;
  engagedSessions: number;
  bounceRate: number; // 0-1 fraction, as GA4 returns it
  conversions: number;
}

export interface GA4EventRow {
  eventName: string;
  eventCount: number;
}

/**
 * Pulls the "what happened after the click" half of the funnel that
 * runGA4Report's daily/channel summary doesn't cover: which landing pages
 * actually held visitors (sessions, engaged sessions, bounce rate) vs. which
 * ones people bounced off of, and a straight count of every named event
 * (GA4's generic term covering both auto-tracked events and configured
 * conversions/goals) — sorted so the events people actually complete float
 * to the top. Same live-query-per-request approach as runGA4Report, no
 * local table (see that function's doc comment for why).
 */
export async function runGA4FunnelReport(
  propertyId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string
): Promise<{ landingPages: GA4LandingPageRow[]; events: GA4EventRow[] }> {
  const accessToken = await getAccessToken(refreshToken);

  const landingRes = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'bounceRate' },
        { name: 'conversions' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 50,
    }),
  });
  if (!landingRes.ok) {
    throw new Error(`GA4 runReport (landing pages) failed: ${landingRes.status} ${await landingRes.text()}`);
  }
  const landingData = await landingRes.json();
  const landingPages: GA4LandingPageRow[] = (landingData.rows ?? []).map((row: any) => ({
    landingPage: row.dimensionValues[0].value,
    sessions: Number(row.metricValues[0].value ?? 0),
    engagedSessions: Number(row.metricValues[1].value ?? 0),
    bounceRate: Number(row.metricValues[2].value ?? 0),
    conversions: Number(row.metricValues[3].value ?? 0),
  }));

  const eventsRes = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 30,
    }),
  });
  if (!eventsRes.ok) {
    throw new Error(`GA4 runReport (events) failed: ${eventsRes.status} ${await eventsRes.text()}`);
  }
  const eventsData = await eventsRes.json();
  const events: GA4EventRow[] = (eventsData.rows ?? []).map((row: any) => ({
    eventName: row.dimensionValues[0].value,
    eventCount: Number(row.metricValues[0].value ?? 0),
  }));

  return { landingPages, events };
}

export interface GA4EcommerceSummary {
  transactions: number;
  purchaseRevenue: number; // property's own currency, not converted or in cents — same convention as totalRevenue above
  averageOrderValue: number; // derived (purchaseRevenue / transactions) rather than relying on a specific "AOV" metric name
}

export interface GA4SourceMediumRow {
  sourceMedium: string; // e.g. "google / cpc", "(direct) / (none)"
  sessions: number;
  activeUsers: number;
  conversions: number;
}

export interface GA4EngagementSummary {
  engagementRate: number; // 0-1 fraction of sessions that were "engaged" (GA4's own definition)
  averageEngagementTimeSeconds: number; // per session
  totalUsers: number;
  newUsers: number;
  returningUsers: number; // derived: totalUsers - newUsers (GA4 has no single "returning users" metric)
}

/**
 * Growth/quality metrics beyond the core daily summary and funnel report:
 *  - Ecommerce: transactions, purchase revenue, and a derived average order
 *    value. Returns all-zero if the property has no ecommerce events
 *    configured (GA4 just reports 0s rather than erroring in that case, so
 *    this is a data-availability situation, not a fetch failure — the caller
 *    should treat an all-zero result as "no ecommerce tracking set up" and
 *    say so, similar to the Store Visits situation on the Google Ads side).
 *  - Acquisition detail: sessions/users/conversions by source/medium (e.g.
 *    "google / cpc" vs. "google / organic" vs. "(direct) / (none)") — a
 *    finer cut than the channel-grouping breakdown in runGA4Report.
 *  - Engagement & user quality: engagement rate, average engagement time,
 *    and new vs. returning users for the period, as a single summary block
 *    rather than a daily series (the daily series already exists in
 *    runGA4Report if a trend view is needed later).
 */
export async function runGA4GrowthReport(
  propertyId: string,
  refreshToken: string,
  sinceDate: string,
  untilDate: string
): Promise<{ ecommerce: GA4EcommerceSummary; sourceMedium: GA4SourceMediumRow[]; engagement: GA4EngagementSummary }> {
  const accessToken = await getAccessToken(refreshToken);

  const runReport = async (body: object) => {
    const res = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GA4 runReport failed: ${res.status} ${await res.text()}`);
    return res.json();
  };

  const [ecommerceData, sourceMediumData, engagementData] = await Promise.all([
    runReport({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      metrics: [{ name: 'transactions' }, { name: 'purchaseRevenue' }],
    }),
    runReport({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      dimensions: [{ name: 'sessionSourceMedium' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 25,
    }),
    runReport({
      dateRanges: [{ startDate: sinceDate, endDate: untilDate }],
      metrics: [
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
      ],
    }),
  ]);

  const ecommerceRow = ecommerceData.rows?.[0]?.metricValues;
  const transactions = Number(ecommerceRow?.[0]?.value ?? 0);
  const purchaseRevenue = Number(ecommerceRow?.[1]?.value ?? 0);
  const ecommerce: GA4EcommerceSummary = {
    transactions,
    purchaseRevenue,
    averageOrderValue: transactions > 0 ? purchaseRevenue / transactions : 0,
  };

  const sourceMedium: GA4SourceMediumRow[] = (sourceMediumData.rows ?? []).map((row: any) => ({
    sourceMedium: row.dimensionValues[0].value,
    sessions: Number(row.metricValues[0].value ?? 0),
    activeUsers: Number(row.metricValues[1].value ?? 0),
    conversions: Number(row.metricValues[2].value ?? 0),
  }));

  const engagementRow = engagementData.rows?.[0]?.metricValues;
  const totalUsers = Number(engagementRow?.[2]?.value ?? 0);
  const newUsers = Number(engagementRow?.[3]?.value ?? 0);
  const engagement: GA4EngagementSummary = {
    engagementRate: Number(engagementRow?.[0]?.value ?? 0),
    averageEngagementTimeSeconds: Number(engagementRow?.[1]?.value ?? 0),
    totalUsers,
    newUsers,
    returningUsers: Math.max(0, totalUsers - newUsers),
  };

  return { ecommerce, sourceMedium, engagement };
}
