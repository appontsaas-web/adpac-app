// ---------------------------------------------------------------------------
// Background sync/AI-review scheduler — the fix for "the dashboard is only
// as fresh as the last time someone clicked Sync now / Run AI review."
//
// /api/metrics/sync and /api/ai-insights/generate were already designed for
// an unattended caller (see their own doc comments: "A scheduler (cron) with
// no session — protect it with SYNC_SECRET"). This is that caller — running
// in-process inside the same Next.js server via src/instrumentation.ts,
// instead of requiring a separately-hosted cron job to hit the same URL.
// That's the right tradeoff for a single local/self-hosted deployment; if
// this ever moves to a multi-instance production deploy, switch to an
// external cron (Vercel Cron, GitHub Actions, etc.) hitting these same two
// routes instead, so the interval doesn't multiply per running instance.
//
// Deliberately calls the HTTP routes rather than the underlying lib
// functions directly: that keeps this one, obviously-correct code path (the
// routes' own auth/validation/error-handling logic) instead of a second
// parallel one that could drift from what a manual "Sync now" click does.
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MINUTES = 240; // every 4 hours

function intervalMs(): number {
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_INTERVAL_MINUTES) * 60 * 1000;
}

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? `http://localhost:${process.env.PORT ?? 3010}`;
}

async function runCycle() {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    console.warn(
      '[scheduler] SYNC_SECRET is not set — skipping this cycle. Set SYNC_SECRET in .env to enable automatic ' +
        'sync/AI review (see .env.example). Manual "Sync now" / "Run AI review" clicks still work without it.'
    );
    return;
  }

  const url = baseUrl();

  try {
    const res = await fetch(`${url}/api/metrics/sync`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] metrics sync failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] metrics sync: ${data.synced ?? 0} performance rows, ${data.audienceSynced ?? 0} audience rows` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] metrics sync request failed:', err.message);
  }

  // Hard spend-ceiling check runs right after metrics sync (needs this
  // cycle's fresh DailyMetric rows) and before the AI review — a runaway
  // account gets paused immediately rather than waiting on a human to
  // approve an AI-proposed pause first.
  try {
    const res = await fetch(`${url}/api/spend-guardrail/run`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] spend guardrail check failed (${res.status}):`, data.error ?? data);
    } else {
      const triggered = (data.results ?? []).filter((r: any) => r.triggered);
      if (triggered.length > 0) {
        console.warn(
          `[scheduler] spend guardrail: paused campaigns for ${triggered.length} client(s) — ` +
            triggered.map((r: any) => r.clientName).join(', ')
        );
      }
    }
  } catch (err: any) {
    console.error('[scheduler] spend guardrail request failed:', err.message);
  }

  try {
    const res = await fetch(`${url}/api/ai-insights/generate`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // no clientId — reviews every client with a LIVE campaign
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] AI review failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] AI review: ${data.created ?? 0} new insight(s)` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] AI review request failed:', err.message);
  }

  // Google Business Profile — separate from the Google Ads sync/review
  // above (different API family, different quota, often not yet approved
  // for a given account — see lib/googleBusinessProfile.ts). Failures here
  // are logged the same non-fatal way and never block the Ads-side cycle
  // above, which already ran first.
  try {
    const res = await fetch(`${url}/api/google-business/sync`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] Business Profile sync failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] Business Profile sync: ${data.locationsSynced ?? 0} branch(es), ${data.metricsSynced ?? 0} metric row(s), ${data.reviewsSynced ?? 0} review(s)` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] Business Profile sync request failed:', err.message);
  }

  try {
    const res = await fetch(`${url}/api/business-insights/generate`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // no clientId — reviews every client with a connected GBP account
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] Business Profile AI review failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] Business Profile AI review: ${data.created ?? 0} new insight(s)` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] Business Profile AI review request failed:', err.message);
  }

  // Meta (Facebook/Instagram) — separate from both the Google Ads and
  // Business Profile cycles above (different API entirely, different token
  // lifecycle — see lib/meta.ts). Failures here are logged the same
  // non-fatal way and never block the cycles above, which already ran first.
  try {
    const res = await fetch(`${url}/api/meta/sync`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] Meta sync failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] Meta sync: ${data.campaignsSynced ?? 0} campaign(s), ${data.metricsSynced ?? 0} metric row(s)` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] Meta sync request failed:', err.message);
  }

  try {
    const res = await fetch(`${url}/api/meta-insights/generate`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // no clientId — reviews every client with a connected Meta ad account
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] Meta AI review failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] Meta AI review: ${data.created ?? 0} new insight(s)` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] Meta AI review request failed:', err.message);
  }

  // Snapchat — same non-fatal, never-blocks-earlier-cycles treatment as
  // Meta above. No AI-review cycle yet (lib/snapInsights.ts not built —
  // see SnapCampaign.actionLogs/ActionLog.snapCampaignId reserved for it).
  try {
    const res = await fetch(`${url}/api/snapchat/sync`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[scheduler] Snapchat sync failed (${res.status}):`, data.error ?? data);
    } else {
      console.log(
        `[scheduler] Snapchat sync: ${data.campaignsSynced ?? 0} campaign(s), ${data.metricsSynced ?? 0} metric row(s)` +
          (data.errors?.length ? ` — ${data.errors.length} non-fatal error(s)` : '')
      );
    }
  } catch (err: any) {
    console.error('[scheduler] Snapchat sync request failed:', err.message);
  }
}

export function startScheduler() {
  const ms = intervalMs();
  console.log(`[scheduler] starting — sync + AI review every ${Math.round(ms / 60000)} minute(s)`);
  // Wait a bit before the first run so the server has finished booting and
  // compiling routes (matters most in `next dev`), then run on the interval.
  setTimeout(runCycle, 15_000);
  setInterval(runCycle, ms);
}
