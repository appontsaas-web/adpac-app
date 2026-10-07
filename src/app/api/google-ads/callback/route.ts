import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl, connectDest } from '@/lib/baseUrl';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { exchangeCodeForTokens, fetchAccountCurrency } from '@/lib/googleAds';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

// GET /api/google-ads/callback?code=...&state=<JSON: {clientId, customerId}>
// Google redirects here after the operator grants access. `customerId` was
// entered manually on the connect form (see ConnectGoogleAdsButton) — we
// deliberately do NOT call listAccessibleCustomers and guess, since that
// previously linked whichever account happened to come back first for the
// authorizing Google login, which isn't necessarily this client's account.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  let clientId: string | undefined;
  let portal = false;
  let googleCustomerId: string | undefined;
  try {
    if (stateRaw) {
      const parsed = JSON.parse(stateRaw);
      clientId = parsed.clientId;
      portal = parsed.portal === true;
      googleCustomerId = parsed.customerId;
    }
  } catch {
    // fall through to the missing-fields check below
  }

  if (portal) {
    // Free Analysis flow: the connecting browser must hold the portal session of the client in `state`.
    const pc = await getCurrentPortalClient();
    if (!pc || pc.id !== clientId) return NextResponse.redirect(absoluteUrl('/portal?error=invalid-or-expired'));
  }

  if (error) {
    return NextResponse.redirect(connectDest(portal, clientId, `googleAds=denied`));
  }
  if (!code || !clientId || !googleCustomerId) {
    return NextResponse.json({ error: 'Missing code or state (clientId/customerId)' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token!;

    // Look up the account's real billing currency (e.g. "SAR") right away
    // so the very first sync already converts correctly instead of running
    // one round with no currency on record — see fetchAccountCurrency and
    // the FX conversion in fetchCampaignMetrics/fetchAudienceMetrics.
    // Non-fatal: a failed lookup here just leaves currencyCode null, which
    // metrics sync retries on its own next run.
    let currencyCode: string | null = null;
    try {
      currencyCode = await fetchAccountCurrency(googleCustomerId, refreshToken);
    } catch (err: any) {
      console.error('fetchAccountCurrency failed during Google Ads connect:', err.message);
    }

    const account = await db.googleAdsAccount.create({
      data: {
        clientId,
        googleCustomerId,
        refreshTokenEncrypted: encryptToken(refreshToken),
        status: 'connected',
        currencyCode,
      },
    });

    // Self-heal: disconnecting a client's Google Ads account (see
    // /api/google-ads/disconnect) deletes the old GoogleAdsAccount row,
    // and the DB's ON DELETE SET NULL foreign key nulls out
    // Campaign.googleAdsAccountId for every campaign that pointed at it —
    // silently breaking metrics sync (it only pulls performance for
    // campaigns matched to a connected account) until now. Re-link any of
    // this client's campaigns that still have a real googleCampaignId but
    // lost their account link that way, onto this fresh connection.
    await db.campaign.updateMany({
      where: { clientId, googleAdsAccountId: null, googleCampaignId: { not: null } },
      data: { googleAdsAccountId: account.id },
    });

    return NextResponse.redirect(connectDest(portal, clientId, `googleAds=connected`));
  } catch (err: any) {
    console.error('Google Ads OAuth callback failed:', err.message);
    return NextResponse.redirect(
      connectDest(portal, clientId, `googleAds=error&message=${encodeURIComponent(err.message)}`)
    );
  }
}
