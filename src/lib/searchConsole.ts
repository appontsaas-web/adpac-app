import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Google Search Console integration (read-only: webmasters.readonly).
// Organic search performance — clicks, impressions, CTR, average position,
// top queries / pages / countries / devices — to sit next to the paid-media
// numbers. Reuses the Google Ads OAuth client (add the scope to its consent
// screen and enable "Google Search Console API" in the Cloud project) plus
//   GOOGLE_SEARCH_CONSOLE_REDIRECT_URI — its own registered redirect URI.
// ---------------------------------------------------------------------------

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_ADS_CLIENT_ID'),
    requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    requireEnv('GOOGLE_SEARCH_CONSOLE_REDIRECT_URI')
  );
}

export function getSearchConsoleAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

export async function exchangeCodeForTokens(code: string) {
  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.refresh_token) throw new Error('No refresh_token returned — check your OAuth client config.');
  return tokens;
}

function api(refreshToken: string) {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.searchconsole({ version: 'v1', auth });
}

/** Throws unless the authorizing login can see this property (typo / not added as a user). */
export async function verifySiteAccess(siteUrl: string, refreshToken: string): Promise<void> {
  const res = await api(refreshToken).sites.list();
  const found = (res.data.siteEntry ?? []).some((s) => s.siteUrl === siteUrl);
  if (!found) {
    throw new Error(
      `AdPac's Google login cannot see "${siteUrl}" in Search Console. Add it as a user on the property, and enter the property exactly as Search Console shows it ("https://example.com/" or "sc-domain:example.com").`
    );
  }
}

export interface ScRow { key: string; clicks: number; impressions: number; ctr: number; position: number }
export interface ScReport {
  siteUrl: string;
  since: string;
  until: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  queries: ScRow[];
  pages: ScRow[];
  countries: ScRow[];
  devices: ScRow[];
  daily: { date: string; clicks: number; impressions: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchSearchConsoleReport(siteUrl: string, refreshToken: string, days: number): Promise<ScReport> {
  const sc = api(refreshToken);
  // Search Console data lags ~2 days.
  const until = new Date(Date.now() - 2 * 86400000);
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  const base = { startDate: iso(since), endDate: iso(until) };

  const q = async (dimensions: string[] | undefined, rowLimit: number) => {
    const res = await sc.searchanalytics.query({ siteUrl, requestBody: { ...base, dimensions, rowLimit } });
    return res.data.rows ?? [];
  };
  const map = (rows: any[]): ScRow[] =>
    rows.map((r) => ({ key: (r.keys ?? [''])[0], clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 }));

  const [total, queries, pages, countries, devices, daily] = await Promise.all([
    q(undefined, 1),
    q(['query'], 20),
    q(['page'], 20),
    q(['country'], 10),
    q(['device'], 5),
    q(['date'], 90),
  ]);
  const t: any = total[0] ?? {};
  return {
    siteUrl,
    since: base.startDate,
    until: base.endDate,
    totals: { clicks: t.clicks ?? 0, impressions: t.impressions ?? 0, ctr: t.ctr ?? 0, position: t.position ?? 0 },
    queries: map(queries),
    pages: map(pages),
    countries: map(countries),
    devices: map(devices),
    daily: daily.map((r: any) => ({ date: r.keys[0], clicks: r.clicks ?? 0, impressions: r.impressions ?? 0 })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
