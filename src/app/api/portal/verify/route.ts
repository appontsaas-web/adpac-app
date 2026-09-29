import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalLoginToken, setPortalSessionCookie } from '@/lib/clientPortalAuth';

// GET /api/portal/verify?token=...
// The link a client clicks from their sign-in email. Consumes the (single-
// use, 30-minute) login token, sets the portal session cookie, and redirects
// into the portal.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const baseUrl = req.nextUrl.origin;
  if (!token) return NextResponse.redirect(`${baseUrl}/portal?error=missing-token`);

  const result = await verifyPortalLoginToken(token);
  if (!result) return NextResponse.redirect(`${baseUrl}/portal?error=invalid-or-expired`);

  setPortalSessionCookie(result.sessionToken);
  return NextResponse.redirect(`${baseUrl}/portal`);
}
