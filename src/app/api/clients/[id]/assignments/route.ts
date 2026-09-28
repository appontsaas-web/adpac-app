import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/clients/[id]/assignments — admin-only. Lists everyone with
// explicit access to this client and their permission level.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const assignments = await db.clientAssignment.findMany({
    where: { clientId: params.id },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ assignments });
}

// POST /api/clients/[id]/assignments — admin-only. Upserts a user's access
// level for this client. Body: { userId, permission: "VIEW" | "EDIT" }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json();
  const userId = String(body.userId || '');
  const permission = body.permission === 'EDIT' ? 'EDIT' : 'VIEW';
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  const client = await db.client.findUnique({ where: { id: params.id } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  const targetUser = await db.user.findUnique({ where: { id: userId } });
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const assignment = await db.clientAssignment.upsert({
    where: { clientId_userId: { clientId: params.id, userId } },
    update: { permission },
    create: { clientId: params.id, userId, permission },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  return NextResponse.json({ assignment });
}

// DELETE /api/clients/[id]/assignments — admin-only. Body: { userId }
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json();
  const userId = String(body.userId || '');
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  await db.clientAssignment.deleteMany({ where: { clientId: params.id, userId } });
  return NextResponse.json({ ok: true });
}
