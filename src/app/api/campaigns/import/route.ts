import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasCapability } from '@/lib/access';
import { db } from '@/lib/db';
import { fetchExistingCampaigns } from '@/lib/googleAds';
import { decryptToken } from '@/lib/crypto';

// POST /api/campaigns/import
// Body: { clientId, googleAdsAccountId }
// Pulls every non-removed campaign that already exists on the connected
// Google Ads account. Two things happen with the result:
//   1. Any campaign AdPac doesn't have a local row for yet (matched by
//      googleCampaignId) gets created — this is for campaigns set up
//      directly in the Google Ads UI. Without a local row, metrics sync has
//      nothing to match performance data against, so reporting shows zero
//      even though the campaign is actually running.
//   2. Any campaign AdPac already tracks gets its status/budget/name
//      reconciled against Google's current values. Status only ever flows
//      AdPac -> Google when changed through the app (approve, AI-insight
//      pause) — a change made directly in the Google Ads UI (e.g. someone
//      pausing a campaign there) would otherwise sit unnoticed in AdPac
//      forever, still showing LIVE. This closes that gap. (The same
//      reconciliation also runs as part of /api/metrics/sync, so "Sync now"
//      catches this too, not just this button.)
// Imported campaigns get an aiBriefJson placeholder marking them as
// imported rather than AI-drafted, since there's no AI rationale/keywords/
// ad copy to show for them.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { clientId, googleAdsAccountId } = await req.json();
  if (!clientId || !googleAdsAccountId) {
    return NextResponse.json({ error: 'clientId and googleAdsAccountId are required' }, { status: 400 });
  }

  if (!(await hasCapability(me, clientId, 'campaigns'))) {
    return NextResponse.json({ error: 'Campaign management access required for this client' }, { status: 403 });
  }

  const account = await db.googleAdsAccount.findUnique({ where: { id: googleAdsAccountId } });
  if (!account) return NextResponse.json({ error: 'Google Ads account not found' }, { status: 404 });

  try {
    const refreshToken = decryptToken(account.refreshTokenEncrypted);
    const existing = await fetchExistingCampaigns(account.googleCustomerId, refreshToken);

    const alreadyTracked = await db.campaign.findMany({
      where: { googleCampaignId: { in: existing.map((c) => c.googleCampaignId) } },
      select: { id: true, googleCampaignId: true, status: true, dailyBudgetCents: true, name: true },
    });
    const trackedByGoogleId = new Map(alreadyTracked.map((c) => [c.googleCampaignId as string, c]));

    const toImport = existing.filter((c) => !trackedByGoogleId.has(c.googleCampaignId));
    const toReconcile = existing.filter((c) => trackedByGoogleId.has(c.googleCampaignId));

    const statusMap: Record<string, string> = { ENABLED: 'LIVE', PAUSED: 'PAUSED' };

    let imported = 0;
    for (const c of toImport) {
      await db.campaign.create({
        data: {
          clientId,
          googleAdsAccountId,
          googleCampaignId: c.googleCampaignId,
          name: c.name,
          type: c.channelType || 'SEARCH',
          status: statusMap[c.status] ?? 'LIVE',
          dailyBudgetCents: c.dailyBudgetCents || 0,
          aiBriefJson: JSON.stringify({
            imported: true,
            keywords: [],
            headlines: [],
            descriptions: [],
            rationale: 'Imported from an existing Google Ads campaign — not AI-generated, so there is no draft copy or targeting rationale to show.',
          }),
        },
      });
      imported++;
    }

    // Reconcile campaigns AdPac already tracks against Google's current
    // status/budget/name — see the block comment above for why this exists.
    let updated = 0;
    for (const c of toReconcile) {
      const local = trackedByGoogleId.get(c.googleCampaignId)!;
      const mappedStatus = statusMap[c.status] ?? local.status;
      // Guard against a zero/unresolved budget (e.g. shared budgets can come
      // back as 0 from the API) clobbering a known-good local value.
      const nextBudget = c.dailyBudgetCents > 0 ? c.dailyBudgetCents : local.dailyBudgetCents;
      const changed = local.status !== mappedStatus || local.dailyBudgetCents !== nextBudget || local.name !== c.name;
      if (changed) {
        await db.campaign.update({
          where: { id: local.id },
          data: { status: mappedStatus, dailyBudgetCents: nextBudget, name: c.name },
        });
        updated++;
      }
    }

    return NextResponse.json({ imported, updated, skipped: toReconcile.length - updated, total: existing.length });
  } catch (err: any) {
    console.error('campaigns/import failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
