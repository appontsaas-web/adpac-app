import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/mailer';
import { AGENTS, isAgentKey } from '@/lib/agents';

// POST /api/portal/message { kind: 'MESSAGE'|'CALL', body, preferredTime? }
export async function POST(req: NextRequest) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const kind = b.kind === 'CALL' ? 'CALL' : 'MESSAGE';
  const body = String(b.body ?? '').trim().slice(0, 2000);
  const preferredTime = String(b.preferredTime ?? '').trim().slice(0, 100) || null;
  if (kind === 'MESSAGE' && !body) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });
  if (kind === 'CALL' && !preferredTime) return NextResponse.json({ error: 'Preferred time required' }, { status: 400 });

  // Rate limit: max 10 per client per day.
  const recent = await db.agentMessage.count({ where: { clientId: client.id, createdAt: { gte: new Date(Date.now() - 86400000) } } });
  if (recent >= 10) return NextResponse.json({ error: 'Too many messages today' }, { status: 429 });

  const full = await db.client.findUnique({ where: { id: client.id }, select: { agent: true } });
  await db.agentMessage.create({ data: { clientId: client.id, kind, body, preferredTime } });

  try {
    const agentTag = isAgentKey(full?.agent) ? ` (agent: ${AGENTS[full!.agent as keyof typeof AGENTS].name})` : '';
    await sendMail({
      to: process.env.ZOHO_SMTP_USER!,
      replyTo: client.portalContactEmail ?? undefined,
      subject: `${kind === 'CALL' ? 'Call request' : 'Portal message'} — ${client.name}${agentTag}`,
      text: `${client.name} (${client.portalContactEmail ?? 'no email'})\n${kind === 'CALL' ? `Preferred time: ${preferredTime}\n` : ''}\n${body}`,
    });
  } catch (err: any) {
    console.error('Agent message email failed:', err.message);
  }
  return NextResponse.json({ ok: true });
}
