import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { checkAgentSecret } from '@/lib/agentApi';

// POST /api/agent/clients/[id]/proposals
// The media buyer files optimization proposals here. They are written as
// PENDING_APPROVAL ActionLog rows — exactly like the built-in AI review — so
// a human approves or dismisses them in the dashboard. NOTHING is executed
// on any ad platform from this route.
const Proposal = z.object({
  type: z.enum(['ADJUST_BUDGET', 'PAUSE_CAMPAIGN', 'REWRITE_AD_COPY', 'ANOMALY_ALERT', 'ADD_NEGATIVE_KEYWORDS', 'REALLOCATE_BUDGET', 'ADJUST_BID_MODIFIER']),
  campaignId: z.string(),
  summary: z.string().min(5).max(200),
  rationale: z.string().min(20).max(1500),
  proposedDailyBudgetCents: z.number().int().positive().optional(),
  proposedHeadlines: z.array(z.string().max(30)).min(8).max(15).optional(),
  proposedDescriptions: z.array(z.string().max(90)).min(2).max(4).optional(),
  proposedNegativeKeywords: z.array(z.string().min(1).max(80)).min(1).max(15).optional(),
  reallocateFromCampaignId: z.string().optional(),
  reallocateAmountCents: z.number().int().positive().optional(),
  bidModifierCriterionType: z.enum(['DEVICE', 'HOUR']).optional(),
  bidModifierValue: z.string().optional(),
  proposedBidModifier: z.number().min(0).max(10).optional(),
});
const Body = z.object({ proposals: z.array(Proposal).min(1).max(10) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = checkAgentSecret(req);
  if (denied) return denied;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });

  const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const campaigns = await db.campaign.findMany({
    where: { clientId: params.id },
    select: { id: true, dailyBudgetCents: true },
  });
  const budgetById = new Map(campaigns.map((c) => [c.id, c.dailyBudgetCents]));

  const created: string[] = [];
  const rejected: { index: number; reason: string }[] = [];

  for (const [i, p] of parsed.data.proposals.entries()) {
    const current = budgetById.get(p.campaignId);
    const fail = (reason: string) => rejected.push({ index: i, reason });
    if (current === undefined) { fail("campaignId doesn't belong to this client"); continue; }

    if (p.type === 'ADJUST_BUDGET') {
      if (!p.proposedDailyBudgetCents) { fail('proposedDailyBudgetCents required'); continue; }
      if (p.proposedDailyBudgetCents < current * 0.5 || p.proposedDailyBudgetCents > current * 1.5) {
        fail('budget change must stay within 50%-150% of current'); continue;
      }
    }
    if (p.type === 'REWRITE_AD_COPY' && (!p.proposedHeadlines || !p.proposedDescriptions)) { fail('headlines and descriptions required'); continue; }
    if (p.type === 'ADD_NEGATIVE_KEYWORDS' && !p.proposedNegativeKeywords) { fail('proposedNegativeKeywords required'); continue; }
    if (p.type === 'REALLOCATE_BUDGET') {
      const from = p.reallocateFromCampaignId ? budgetById.get(p.reallocateFromCampaignId) : undefined;
      if (from === undefined || !p.reallocateAmountCents || p.reallocateFromCampaignId === p.campaignId) { fail('valid reallocateFromCampaignId and reallocateAmountCents required'); continue; }
      if (p.reallocateAmountCents >= from) { fail('reallocation would zero out the source campaign'); continue; }
    }
    if (p.type === 'ADJUST_BID_MODIFIER' && (!p.bidModifierCriterionType || !p.bidModifierValue || p.proposedBidModifier === undefined)) { fail('bid modifier fields required'); continue; }

    const row = await db.actionLog.create({
      data: {
        clientId: params.id,
        campaignId: p.campaignId,
        actionType: p.type,
        payloadJson: JSON.stringify({ ...p, source: 'media-buyer' }),
        status: 'PENDING_APPROVAL',
        proposedBy: 'ai',
      },
    });
    created.push(row.id);
  }

  return NextResponse.json({ created, rejected });
}
