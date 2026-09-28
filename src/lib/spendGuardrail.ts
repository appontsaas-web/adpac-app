import { db } from './db';
import { decryptToken } from './crypto';
import { setCampaignStatus } from './googleAds';

// ---------------------------------------------------------------------------
// Spend ceiling guardrail — a hard safety net independent of the AI-insight
// review pipeline. That pipeline can propose pausing a campaign, but nothing
// forces a human to be watching when spend runs away between reviews; this
// is the automatic backstop that doesn't wait for anyone to click Approve.
//
// Deterministic, not AI-judged: projects a client's month-end spend from
// month-to-date DailyMetric rows (same math as PacingSignal in
// lib/aiInsights.ts) and, if it's projected to land meaningfully over the
// client's monthlyBudget, pauses every LIVE campaign on their connected
// Google Ads account and logs an auditable ActionLog entry — never silent.
//
// Triggers at most once per calendar month per client (see the
// already-triggered check below), so a human deliberately resuming a
// campaign afterward — accepting the overage — isn't immediately fought by
// the next scheduler cycle. Nothing here executes without spendGuardrailEnabled
// being true on the client (admin-controlled toggle).
// ---------------------------------------------------------------------------

const HARD_CAP_MULTIPLIER = 1.15; // 15% over monthly budget, projected, triggers an auto-pause
const ACTION_TYPE = 'SPEND_GUARDRAIL_PAUSE';

export interface GuardrailResult {
  clientId: string;
  clientName: string;
  triggered: boolean;
  skippedReason?: string;
  pausedCampaignIds: string[];
  projectedSpendCents: number;
  monthlyBudgetCents: number;
}

/** Checks and, if warranted, enforces the spend guardrail for a single client. Safe to call repeatedly — no-ops once already triggered this month or nothing to do. */
export async function checkSpendGuardrail(clientId: string): Promise<GuardrailResult | null> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: { googleAdsAccounts: true },
  });
  if (!client || !client.monthlyBudget || !client.spendGuardrailEnabled) return null;

  const account = client.googleAdsAccounts.find((a) => a.status === 'connected');
  if (!account) return null;

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();

  const liveCampaigns = await db.campaign.findMany({
    where: { clientId, status: 'LIVE', googleCampaignId: { not: null } },
  });
  if (liveCampaigns.length === 0) return null;

  const campaignIds = liveCampaigns.map((c) => c.id);
  const monthMetrics = await db.dailyMetric.findMany({
    where: { campaignId: { in: campaignIds }, date: { gte: firstOfMonth } },
  });
  const spendSoFarCents = monthMetrics.reduce((a, m) => a + m.costCents, 0);
  // Straight-line projection from the daily average so far — same
  // conservative approach as PacingSignal, not a fancier trend model.
  const projectedSpendCents = daysElapsed > 0 ? Math.round((spendSoFarCents / daysElapsed) * daysInMonth) : spendSoFarCents;
  const capCents = Math.round(client.monthlyBudget * HARD_CAP_MULTIPLIER);

  const base: Omit<GuardrailResult, 'triggered' | 'pausedCampaignIds' | 'skippedReason'> = {
    clientId,
    clientName: client.name,
    projectedSpendCents,
    monthlyBudgetCents: client.monthlyBudget,
  };

  if (projectedSpendCents < capCents) {
    return { ...base, triggered: false, pausedCampaignIds: [] };
  }

  const alreadyTriggered = await db.actionLog.findFirst({
    where: { clientId, actionType: ACTION_TYPE, createdAt: { gte: firstOfMonth } },
  });
  if (alreadyTriggered) {
    return { ...base, triggered: false, pausedCampaignIds: [], skippedReason: 'already triggered this month' };
  }

  const refreshToken = decryptToken(account.refreshTokenEncrypted);
  const pausedCampaignIds: string[] = [];
  const pauseErrors: string[] = [];
  for (const c of liveCampaigns) {
    if (!c.googleCampaignId) continue;
    try {
      await setCampaignStatus(account.googleCustomerId, refreshToken, c.googleCampaignId, 'PAUSED');
      await db.campaign.update({ where: { id: c.id }, data: { status: 'PAUSED' } });
      pausedCampaignIds.push(c.id);
    } catch (err: any) {
      pauseErrors.push(`${c.name}: ${err.message}`);
    }
  }

  const summary =
    `Spend guardrail triggered: projected month-end spend $${(projectedSpendCents / 100).toFixed(2)} ` +
    `exceeds ${Math.round(HARD_CAP_MULTIPLIER * 100)}% of the $${(client.monthlyBudget / 100).toFixed(2)} monthly budget ` +
    `(spent $${(spendSoFarCents / 100).toFixed(2)} through day ${daysElapsed} of ${daysInMonth}) — ` +
    `auto-paused ${pausedCampaignIds.length} of ${liveCampaigns.length} live campaign(s).`;

  await db.actionLog.create({
    data: {
      clientId,
      campaignId: null,
      actionType: ACTION_TYPE,
      payloadJson: JSON.stringify({
        summary,
        projectedSpendCents,
        monthlyBudgetCents: client.monthlyBudget,
        spendSoFarCents,
        daysElapsed,
        daysInMonth,
        pausedCampaignIds,
        pauseErrors,
      }),
      status: 'EXECUTED',
      proposedBy: 'system',
      executedAt: new Date(),
      errorMessage: pauseErrors.length ? pauseErrors.join('; ') : null,
    },
  });

  return { ...base, triggered: true, pausedCampaignIds };
}

/** Runs the guardrail check across every client with a monthly budget and the guardrail enabled. Called by the scheduler; also usable from an on-demand admin route. */
export async function runSpendGuardrailForAllClients(): Promise<GuardrailResult[]> {
  const clients = await db.client.findMany({
    where: { monthlyBudget: { not: null }, spendGuardrailEnabled: true },
    select: { id: true },
  });
  const results: GuardrailResult[] = [];
  for (const c of clients) {
    try {
      const r = await checkSpendGuardrail(c.id);
      if (r) results.push(r);
    } catch (err: any) {
      console.error(`[spendGuardrail] check failed for client ${c.id}:`, err.message);
    }
  }
  return results;
}
