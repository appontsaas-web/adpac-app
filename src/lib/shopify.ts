import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Shopify store analytics (read-only): revenue, orders, AOV, refunds, top
// products, daily revenue — straight from the Admin GraphQL API.
//   SHOPIFY_API_KEY / SHOPIFY_API_SECRET / SHOPIFY_REDIRECT_URI / SHOPIFY_API_VERSION
// Scopes: read_orders (Shopify limits this to the last 60 days unless the app
// is also granted read_all_orders — we only ever look back <= 60 days).
// ---------------------------------------------------------------------------

const SCOPES = 'read_orders,read_products';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}
const apiVersion = () => process.env.SHOPIFY_API_VERSION ?? '2026-07';

/** "My-Store", "https://my-store.myshopify.com/" -> "my-store.myshopify.com"; null if not a valid shop domain. */
export function normalizeShop(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const full = s.includes('.') ? s : `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(full) ? full : null;
}

/** Signed state so the callback can trust clientId/shop weren't tampered with. */
export function signState(clientId: string, shop: string): string {
  const sig = createHmac('sha256', env('SHOPIFY_API_SECRET')).update(`${clientId}|${shop}`).digest('hex');
  return JSON.stringify({ clientId, shop, sig });
}
export function verifyState(raw: string | null): { clientId: string; shop: string } | null {
  try {
    const p = JSON.parse(raw ?? '');
    const expect = createHmac('sha256', env('SHOPIFY_API_SECRET')).update(`${p.clientId}|${p.shop}`).digest('hex');
    const a = Buffer.from(expect), b = Buffer.from(String(p.sig));
    if (a.length === b.length && timingSafeEqual(a, b)) return { clientId: p.clientId, shop: p.shop };
  } catch {}
  return null;
}

export function getShopifyAuthUrl(shop: string, state: string): string {
  const q = new URLSearchParams({ client_id: env('SHOPIFY_API_KEY'), scope: SCOPES, redirect_uri: env('SHOPIFY_REDIRECT_URI'), state });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}

/** Verifies Shopify's HMAC over the callback query string. */
export function verifyCallbackHmac(params: URLSearchParams): boolean {
  const hmac = params.get('hmac');
  if (!hmac) return false;
  const msg = [...params.entries()].filter(([k]) => k !== 'hmac').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const expect = createHmac('sha256', env('SHOPIFY_API_SECRET')).update(msg).digest('hex');
  const a = Buffer.from(expect), b = Buffer.from(hmac);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env('SHOPIFY_API_KEY'), client_secret: env('SHOPIFY_API_SECRET'), code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body.error_description ?? body.error ?? `Shopify token exchange failed (${res.status})`);
  return { accessToken: body.access_token, scope: body.scope ?? '' };
}

async function gql(shop: string, token: string, query: string, variables: object = {}) {
  const res = await fetch(`https://${shop}/admin/api/${apiVersion()}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  if (body.errors) throw new Error(typeof body.errors === 'string' ? body.errors : body.errors.map((e: any) => e.message).join('; '));
  return body.data;
}

export async function verifyShopAccess(shop: string, token: string): Promise<string> {
  const d = await gql(shop, token, '{ shop { name currencyCode } }');
  return d.shop.currencyCode as string;
}

export interface ShopifyReport {
  shop: string;
  currency: string;
  since: string;
  until: string;
  orders: number;
  revenue: number;
  refunds: number;
  aov: number;
  topProducts: { title: string; quantity: number; revenue: number }[];
  daily: { date: string; revenue: number; orders: number }[];
  truncated: boolean;
}

const ORDERS_QUERY = `
query($q: String!, $after: String) {
  shop { currencyCode }
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      currentTotalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 50) { nodes { title quantity originalTotalSet { shopMoney { amount } } } }
    }
  }
}`;

export async function fetchShopifyReport(shop: string, token: string, days: number): Promise<ShopifyReport> {
  const d = Math.min(days, 60);
  const until = new Date();
  const since = new Date(Date.now() - d * 86400000);
  const q = `created_at:>=${since.toISOString()} AND test:false`;

  let after: string | undefined;
  let currency = 'USD';
  let orders = 0, revenue = 0, refunds = 0, truncated = false;
  const products = new Map<string, { title: string; quantity: number; revenue: number }>();
  const daily = new Map<string, { revenue: number; orders: number }>();

  for (let page = 0; page < 30; page++) {
    const data = await gql(shop, token, ORDERS_QUERY, { q, after });
    currency = data.shop.currencyCode;
    for (const o of data.orders.nodes) {
      orders++;
      const amt = Number(o.currentTotalPriceSet.shopMoney.amount);
      revenue += amt;
      refunds += Number(o.totalRefundedSet.shopMoney.amount);
      const day = String(o.createdAt).slice(0, 10);
      const dd = daily.get(day) ?? { revenue: 0, orders: 0 };
      dd.revenue += amt;
      dd.orders++;
      daily.set(day, dd);
      for (const li of o.lineItems.nodes) {
        const p = products.get(li.title) ?? { title: li.title, quantity: 0, revenue: 0 };
        p.quantity += li.quantity;
        p.revenue += Number(li.originalTotalSet.shopMoney.amount);
        products.set(li.title, p);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
    if (page === 29) truncated = true;
  }

  return {
    shop,
    currency,
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    orders,
    revenue,
    refunds,
    aov: orders ? revenue / orders : 0,
    topProducts: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    truncated,
  };
}
