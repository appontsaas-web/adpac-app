import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { findConnectedAccount } from '@/lib/freeAnalysis';
import { getGoogleAdsAuthUrl } from '@/lib/googleAds';
import { getMetaAuthUrl } from '@/lib/meta';
import { getSnapchatAuthUrl } from '@/lib/snapchat';
import { getTikTokAuthUrl } from '@/lib/tiktok';

// GET /api/portal/analysis/connect?platform=google|meta|snapchat|tiktok[&customerId=1234567890]
// Starts the OAuth flow for the Free Analysis: portal session required, and
// only ONE ad account may be connected this way. `state.portal = true` makes
// the shared callbacks return to /portal/analysis instead of the dashboard.
export async function GET(req: NextRequest) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.redirect(absoluteUrl('/portal'));

  const full = await (await import('@/lib/db')).db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true } });
  if (!full?.isFreeAnalysis) return NextResponse.json({ error: 'Not available' }, { status: 403 });
  if (await findConnectedAccount(client.id)) return NextResponse.redirect(absoluteUrl('/portal/analysis'));

  const platform = req.nextUrl.searchParams.get('platform');
  const state = (extra: object = {}) => JSON.stringify({ clientId: client.id, portal: true, ...extra });

  switch (platform) {
    case 'google': {
      const customerId = (req.nextUrl.searchParams.get('customerId') ?? '').replace(/-/g, '').trim();
      if (!/^\d{10}$/.test(customerId)) {
        return NextResponse.redirect(absoluteUrl('/portal/analysis?googleAds=error&message=' + encodeURIComponent('Enter your 10-digit Google Ads Customer ID.')));
      }
      return NextResponse.redirect(getGoogleAdsAuthUrl(state({ customerId })));
    }
    case 'meta':
      return NextResponse.redirect(getMetaAuthUrl(state()));
    case 'snapchat':
      return NextResponse.redirect(getSnapchatAuthUrl(state()));
    case 'tiktok':
      return NextResponse.redirect(getTikTokAuthUrl(state()));
    default:
      return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  }
}
