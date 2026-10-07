import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { findConnectedAccount } from '@/lib/freeAnalysis';
import { PENDING_META_CONNECT_COOKIE } from '../../../meta/callback/pendingConnectCookie';
import { PENDING_SNAPCHAT_CONNECT_COOKIE } from '../../../snapchat/callback/pendingConnectCookie';
import { PENDING_TIKTOK_CONNECT_COOKIE } from '../../../tiktok/callback/pendingConnectCookie';

// POST /api/portal/analysis/finish (form: platform, accountId)
// Completes a portal connect where the login had several ad accounts to
// choose from — same cookie-backed picker as the staff flow, one handler
// for Meta / Snapchat / TikTok (Google Ads has no picker: the customer types
// their Customer ID up front).
export async function POST(req: NextRequest) {
  const client = await getCurrentPortalClient();
  if (!client) return NextResponse.redirect(absoluteUrl('/portal'), { status: 303 });
  if (await findConnectedAccount(client.id)) return NextResponse.redirect(absoluteUrl('/portal/analysis'), { status: 303 });

  const form = await req.formData();
  const platform = String(form.get('platform') ?? '');
  const accountId = String(form.get('accountId') ?? '');
  const cookieName = { meta: PENDING_META_CONNECT_COOKIE, snapchat: PENDING_SNAPCHAT_CONNECT_COOKIE, tiktok: PENDING_TIKTOK_CONNECT_COOKIE }[platform];
  const fail = (msg: string) => NextResponse.redirect(absoluteUrl(`/portal/analysis?${platform}=error&message=${encodeURIComponent(msg)}`), { status: 303 });
  if (!cookieName) return fail('Unknown platform');

  const raw = req.cookies.get(cookieName)?.value;
  if (!raw) return fail('Your selection expired — please connect again.');
  let pending: any;
  try { pending = JSON.parse(raw); } catch { return fail('Invalid selection — please connect again.'); }
  if (pending.clientId !== client.id) return fail('That selection was for a different account.');
  const chosen = pending.accounts?.find((a: any) => a.id === accountId);
  if (!chosen) return fail('That ad account was not one of the accounts offered.');

  if (platform === 'meta') {
    await db.metaAdAccount.create({
      data: {
        clientId: client.id,
        metaAdAccountId: chosen.id,
        accessTokenEncrypted: pending.accessTokenEncrypted,
        tokenExpiresAt: pending.tokenExpiresAt ? new Date(pending.tokenExpiresAt) : null,
        currencyCode: chosen.currency ?? null,
        status: 'connected',
      },
    });
  } else if (platform === 'snapchat') {
    await db.snapAdAccount.create({
      data: {
        clientId: client.id,
        organizationId: chosen.organizationId,
        snapAdAccountId: chosen.id,
        refreshTokenEncrypted: pending.refreshTokenEncrypted,
        currencyCode: chosen.currency ?? null,
        timezone: chosen.timezone ?? null,
        status: 'connected',
      },
    });
  } else {
    await db.tikTokAdAccount.create({
      data: {
        clientId: client.id,
        advertiserId: chosen.id,
        refreshTokenEncrypted: pending.refreshTokenEncrypted,
        currencyCode: chosen.currency ?? null,
        timezone: chosen.timezone ?? null,
        status: 'connected',
      },
    });
  }

  const res = NextResponse.redirect(absoluteUrl(`/portal/analysis?${platform}=connected`), { status: 303 });
  res.cookies.delete(cookieName);
  return res;
}
