import { NextRequest, NextResponse } from 'next/server';
import { absoluteUrl } from '@/lib/baseUrl';
import { exchangeCodeForTokens, verifyContainerAccess } from '@/lib/googleTagManager';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';

// GET /api/google-tag-manager/callback?code=...&state=<JSON: {clientId, accountId, containerId}>
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  let clientId: string | undefined;
  let accountId: string | undefined;
  let containerId: string | undefined;
  try {
    if (stateRaw) {
      const parsed = JSON.parse(stateRaw);
      clientId = parsed.clientId;
      accountId = parsed.accountId;
      containerId = parsed.containerId;
    }
  } catch {
    // fall through to the missing-fields check below
  }

  if (error) {
    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?gtm=denied`));
  }
  if (!code || !clientId || !accountId || !containerId) {
    return NextResponse.json({ error: 'Missing code or state (clientId/accountId/containerId)' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token!;

    // Verify access + resolve the default workspace up front, same reason
    // as the GA4 callback: catch a bad ID or missing container permission
    // right at connect time. workspaceId is stored so later deployments
    // don't need to re-resolve it on every request.
    const { workspaceId } = await verifyContainerAccess(accountId, containerId, refreshToken);

    await db.googleTagManagerContainer.create({
      data: {
        clientId,
        gtmAccountId: accountId,
        gtmContainerId: containerId,
        workspaceId,
        refreshTokenEncrypted: encryptToken(refreshToken),
        status: 'connected',
      },
    });

    return NextResponse.redirect(absoluteUrl(`/dashboard/clients/${clientId}?gtm=connected`));
  } catch (err: any) {
    console.error('Google Tag Manager OAuth callback failed:', err.message);
    return NextResponse.redirect(
      absoluteUrl(`/dashboard/clients/${clientId}?gtm=error&message=${encodeURIComponent(err.message)}`)
    );
  }
}
