import { NextRequest, NextResponse } from 'next/server';
import { runPortalReminders } from '@/lib/portalReminders';

// POST /api/portal/reminders — called by the scheduler (x-sync-secret). Kept as
// an HTTP route so scheduler.ts (bundled via instrumentation) never imports
// Node-only modules like nodemailer directly.
export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || req.headers.get('x-sync-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const r = await runPortalReminders();
  return NextResponse.json(r);
}
