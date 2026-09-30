/**
 * Builds an absolute URL for the given path using the app's public base URL
 * (NEXTAUTH_URL) instead of the incoming request's own URL.
 *
 * Why: DigitalOcean App Platform's edge proxy forwards requests to the
 * container without a Host header Next.js trusts here, so
 * `new URL(path, req.url)` inside a route handler can silently resolve to
 * the container's internal address (e.g. http://localhost:8080 — the PORT
 * DO sets internally) instead of the public domain. That sends users to a
 * dead link after an OAuth callback instead of back into the dashboard.
 * Same root cause as the earlier portal-magic-link-pointing-at-localhost
 * bug (see lib/clientPortalAuth.ts's sendPortalLoginLink) — this is the
 * general-purpose fix, used by every OAuth connector's callback/disconnect
 * routes (Google Ads, GA4, GTM, Google Business Profile, Meta, Snapchat).
 */
export function absoluteUrl(path: string): URL {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3010';
  return new URL(path, base);
}
