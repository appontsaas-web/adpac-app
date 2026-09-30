import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, verifyPropertyAccess } from '@/lib/googleAnalytics';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

// GET /api/google-analytics/callback?code=...&state=<JSON: {clientId, propertyId}>
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  let clientId: string | undefined;
  let propertyId: string | undefined;
  try {
    if (stateRaw) {
      const parsed = JSON.parse(stateRaw);
      clientId = parsed.clientId;
      propertyId = parsed.propertyId;
    }
  } catch {
    // fall through to the missing-fields check below
  }

  if (error) {
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?ga4=denied`));
  }
  if (!code || !clientId || !propertyId) {
    return NextResponse.json({ error: 'Missing code or state (clientId/propertyId)' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token!;

    // Verify the authorizing login can actually see this property before
    // storing it — catches a typo'd property ID or a client who forgot to
    // add AdPac as a user, right at connect time instead of at first report.
    await verifyPropertyAccess(propertyId, refreshToken);

    await db.googleAnalyticsProperty.create({
      data: {
        clientId,
        ga4PropertyId: propertyId,
        refreshTokenEncrypted: encryptToken(refreshToken),
        status: 'connected',
      },
    });

    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?ga4=connected`));
  } catch (err: any) {
    console.error('Google Analytics OAuth callback failed:', err.message);
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?ga4=error&message=${encodeURIComponent(err.message)}`)
    );
  }
}
