import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPortalLoginLink } from '@/lib/clientPortalAuth';

// POST /api/portal/request-link  { email }
// Public — a client types their email on /portal's login screen. Always
// returns the same generic response whether or not that email matches a
// client's portalContactEmail, so this can't be used to enumerate which
// email addresses are registered clients.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

  const client = await db.client.findFirst({
    where: { portalContactEmail: { equals: email, mode: 'insensitive' } },
  });
  if (client) {
    try {
      await sendPortalLoginLink(client.id);
    } catch (err: any) {
      console.error('Portal login link email failed:', err.message);
      // Still return the generic success response — don't leak whether the
      // email send failed vs. the address just not matching a client.
    }
  }

  return NextResponse.json({ ok: true, message: 'If that email is registered, a sign-in link is on its way.' });
}
