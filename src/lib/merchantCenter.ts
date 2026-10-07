import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Google Merchant Center via the Merchant API (v1). We only READ: product
// approval status + issues, and shopping performance. Note Google's only
// OAuth scope for this API is the read/write "content" scope — AdPac never
// calls a write endpoint. Reuses the Google Ads OAuth client, plus
//   GOOGLE_MERCHANT_CENTER_REDIRECT_URI.
// ---------------------------------------------------------------------------

const SCOPES = ['https://www.googleapis.com/auth/content'];
const BASE = 'https://merchantapi.googleapis.com';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_ADS_CLIENT_ID'),
    requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    requireEnv('GOOGLE_MERCHANT_CENTER_REDIRECT_URI')
  );
}

export function getMerchantCenterAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

export async function exchangeCodeForTokens(code: string) {
  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.refresh_token) throw new Error('No refresh_token returned — check your OAuth client config.');
  return tokens;
}

async function accessToken(refreshToken: string): Promise<string> {
  const c = oauthClient();
  c.setCredentials({ refresh_token: refreshToken });
  const { token } = await c.getAccessToken();
  if (!token) throw new Error('Could not obtain a Google access token');
  return token;
}

async function call(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Merchant API HTTP ${res.status}`);
  return body;
}

/** Throws unless the login can read this Merchant Center account. */
export async function verifyMerchantAccess(merchantId: string, refreshToken: string): Promise<void> {
  const token = await accessToken(refreshToken);
  await call(token, `${BASE}/products/v1/accounts/${merchantId}/products?pageSize=1`);
}

export interface MerchantIssue { code: string; description: string; severity: string; count: number }
export interface MerchantReport {
  merchantId: string;
  products: { total: number; approved: number; pending: number; disapproved: number; sampled: boolean };
  issues: MerchantIssue[];
  performance: { clicks: number; impressions: number; ctr: number; conversions: number; conversionValue: number } | null;
  performanceError: string | null;
}

export async function fetchMerchantReport(merchantId: string, refreshToken: string, days: number): Promise<MerchantReport> {
  const token = await accessToken(refreshToken);

  // Product statuses: page through (cap at 2000 products to keep the request fast).
  const MAX_PAGES = 8;
  let pageToken: string | undefined;
  let total = 0, approved = 0, pending = 0, disapproved = 0;
  const issueMap = new Map<string, MerchantIssue>();
  let sampled = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const body = await call(token, `${BASE}/products/v1/accounts/${merchantId}/products?pageSize=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    for (const p of body.products ?? []) {
      total++;
      const ds: any[] = p.productStatus?.destinationStatuses ?? [];
      const anyApproved = ds.some((d) => (d.approvedCountries ?? []).length > 0);
      const anyPending = ds.some((d) => (d.pendingCountries ?? []).length > 0);
      const anyDisapproved = ds.some((d) => (d.disapprovedCountries ?? []).length > 0);
      if (anyDisapproved && !anyApproved) disapproved++;
      else if (anyApproved) approved++;
      else if (anyPending) pending++;
      for (const it of p.productStatus?.itemLevelIssues ?? []) {
        const key = it.code ?? it.description ?? 'unknown';
        const cur = issueMap.get(key) ?? { code: it.code ?? '', description: it.description ?? it.code ?? '', severity: it.severity ?? '', count: 0 };
        cur.count++;
        issueMap.set(key, cur);
      }
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
    if (i === MAX_PAGES - 1) sampled = true;
  }

  // Shopping performance (best-effort: not every account has product_performance_view access).
  let performance: MerchantReport['performance'] = null;
  let performanceError: string | null = null;
  try {
    const until = new Date();
    const since = new Date(Date.now() - days * 86400000);
    const d = (x: Date) => ({ year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() });
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const q = `SELECT clicks, impressions, click_through_rate, conversions, conversion_value FROM product_performance_view WHERE date BETWEEN '${iso(since)}' AND '${iso(until)}'`;
    void d;
    let tokenNext: string | undefined;
    let clicks = 0, impressions = 0, conversions = 0, conversionValue = 0;
    for (let i = 0; i < 20; i++) {
      const body = await call(token, `${BASE}/reports/v1/accounts/${merchantId}/reports:search`, {
        method: 'POST',
        body: JSON.stringify({ query: q, pageSize: 1000, ...(tokenNext ? { pageToken: tokenNext } : {}) }),
      });
      for (const r of body.results ?? []) {
        const m = r.productPerformanceView ?? {};
        clicks += Number(m.clicks ?? 0);
        impressions += Number(m.impressions ?? 0);
        conversions += Number(m.conversions ?? 0);
        conversionValue += Number(m.conversionValue?.amountMicros ?? m.conversionValue ?? 0) / (m.conversionValue?.amountMicros ? 1e6 : 1);
      }
      tokenNext = body.nextPageToken;
      if (!tokenNext) break;
    }
    performance = { clicks, impressions, ctr: impressions ? clicks / impressions : 0, conversions, conversionValue };
  } catch (e: any) {
    performanceError = e.message;
  }

  return {
    merchantId,
    products: { total, approved, pending, disapproved, sampled },
    issues: [...issueMap.values()].sort((a, b) => b.count - a.count).slice(0, 15),
    performance,
    performanceError,
  };
}
