import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';

// GET /api/users — admin-only. Lists staff/admin accounts (no password hashes).
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const users = await db.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, positionId: true, createdAt: true, position: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ users });
}

// POST /api/users — admin-only. Creates a new team member.
// Body: { email, password, name?, role?, positionId? } — role defaults to
// STAFF. positionId only applies to STAFF (ignored/cleared for ADMIN).
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const body = await req.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = body.name ? String(body.name).trim() : null;
  const role = body.role === 'ADMIN' ? 'ADMIN' : 'STAFF';

  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: 'A user with that email already exists' }, { status: 400 });

  let positionId: string | null = null;
  if (role === 'STAFF' && body.positionId) {
    const position = await db.position.findUnique({ where: { id: body.positionId } });
    if (!position) return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    positionId = position.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: { email, passwordHash, name, role, positionId },
    select: { id: true, email: true, name: true, role: true, positionId: true, createdAt: true },
  });
  return NextResponse.json({ user });
}
