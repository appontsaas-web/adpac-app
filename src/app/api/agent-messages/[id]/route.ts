import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { inboxScope } from '@/lib/inbox';

// PATCH /api/agent-messages/[id] { handled: boolean } — mark a portal message handled / reopen it.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const found = await db.agentMessage.findFirst({ where: { id: params.id, ...inboxScope(me) }, select: { id: true } });
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await db.agentMessage.update({ where: { id: params.id }, data: { handledAt: body.handled === false ? null : new Date() } });
  return NextResponse.json({ ok: true });
}
