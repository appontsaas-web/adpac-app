import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// PATCH /api/users/[id] — admin-only. Body may include:
//   role: "ADMIN" | "STAFF"
//   positionId: string | null   — assign/unassign a Position (STAFF only; ignored for ADMIN)
//   password: string            — reset this user's password (8+ chars). No current-password
//                                  check here since the admin is trusted; for a user resetting
//                                  their OWN password with current-password verification, see
//                                  POST /api/account/password instead.
// Blocked from demoting yourself or the last remaining admin, so you can
// never lock yourself out of admin access.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.password !== undefined) {
    const password = String(body.password);
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  if (body.role !== undefined) {
    const role = body.role === 'ADMIN' ? 'ADMIN' : 'STAFF';
    if (target.role === 'ADMIN' && role === 'STAFF') {
      const adminCount = await db.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        return NextResponse.json({ error: 'Cannot demote the last admin account' }, { status: 400 });
      }
      if (params.id === me.id) {
        return NextResponse.json({ error: "You can't demote your own account" }, { status: 400 });
      }
    }
    data.role = role;
    if (role === 'ADMIN') data.positionId = null; // positions only apply to STAFF
  }

  if (body.positionId !== undefined) {
    if (body.positionId === null) {
      data.positionId = null;
    } else {
      const position = await db.position.findUnique({ where: { id: body.positionId } });
      if (!position) return NextResponse.json({ error: 'Position not found' }, { status: 404 });
      data.positionId = body.positionId;
    }
  }

  const updated = await db.user.update({
    where: { id: params.id },
    data,
    select: { id: true, email: true, name: true, role: true, positionId: true, createdAt: true },
  });
  return NextResponse.json({ user: updated });
}

// DELETE /api/users/[id] — admin-only. Removes a team member (and their
// client assignments, cascade below). Blocked from deleting yourself or the
// last remaining admin, so you can never lock yourself out.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  if (params.id === me.id) {
    return NextResponse.json({ error: "You can't remove your own account" }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (target.role === 'ADMIN') {
    const adminCount = await db.user.count({ where: { role: 'ADMIN' } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last admin account' }, { status: 400 });
    }
  }

  await db.clientAssignment.deleteMany({ where: { userId: params.id } });
  await db.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
