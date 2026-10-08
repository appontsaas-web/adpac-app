import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkAgentSecret } from '@/lib/agentApi';

// GET /api/agent/clients/[id]/summary?days=30
// Read-only snapshot for the media buyer agent: client context, per-campaign
// totals for the window, pending insights and recent human decisions.
// Money is USD cents (as stored). No tokens or secrets are returned.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = checkAgentSecret(req);
  if (denied) return denied;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 1), 90);
  const since = new Date(Date.now() - days * 86400000);

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, industry: true, agent: true, monthlyBudget: true, primaryGoal: true,
      adLanguage: true, targetLocations: true, displayCurrency: true,
    },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const campaigns = await db.campaign.findMany({
    where: { clientId: params.id, status: { not: 'DRAFT' } },
    select: { id: true, name: true, type: true, status: true, dailyBudgetCents: true },
  });

  const rows = await db.dailyMetric.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: campaigns.map((c) => c.id) }, date: { gte: since } },
    _sum: { impressions: true, clicks: true, costCents: true, conversions: true, conversionValueCents: true },
  });
  const byId = new Map(rows.map((r) => [r.campaignId, r._sum]));

  const campaignOut = campaigns.map((c) => {
    const s = byId.get(c.id);
    const clicks = s?.clicks ?? 0, imp = s?.impressions ?? 0, cost = s?.costCents ?? 0, conv = s?.conversions ?? 0;
    return {
      ...c,
      window: {
        days, impressions: imp, clicks, costCents: cost, conversions: conv,
        conversionValueCents: s?.conversionValueCents ?? 0,
        ctr: imp ? clicks / imp : null,
        cpcCents: clicks ? Math.round(cost / clicks) : null,
        costPerConversionCents: conv ? Math.round(cost / conv) : null,
      },
    };
  });

  const pending = await db.actionLog.findMany({
    where: { clientId: params.id, status: 'PENDING_APPROVAL' },
    orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, actionType: true, campaignId: true, payloadJson: true, createdAt: true },
  });
  const decisions = await db.actionLog.findMany({
    where: { clientId: params.id, status: { in: ['EXECUTED', 'REJECTED', 'FAILED'] }, proposedBy: 'ai' },
    orderBy: { createdAt: 'desc' }, take: 10,
    select: { id: true, actionType: true, campaignId: true, status: true, createdAt: true },
  });

  return NextResponse.json({
    client, windowDays: days, campaigns: campaignOut,
    pendingInsights: pending.map((p) => ({ ...p, payload: safeJson(p.payloadJson), payloadJson: undefined })),
    recentDecisions: decisions,
  });
}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return null; } }
