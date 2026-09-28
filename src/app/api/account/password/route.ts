import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// POST /api/account/password — any authenticated user (admin or staff)
// changes their OWN password. Body: { currentPassword, newPassword }.
// Unlike the admin-driven reset in PATCH /api/users/[id], this requires
// proving you know the current password before setting a new one.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  if (!currentPassword) return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: me.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.user.update({ where: { id: me.id }, data: { passwordHash } });

  return NextResponse.json({ ok: true });
}
