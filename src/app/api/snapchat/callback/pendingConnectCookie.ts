// Same short-lived httpOnly cookie pattern as
// /api/meta/callback/pendingConnectCookie.ts — see that file's usage in
// meta/callback/route.ts for the full rationale (multiple ad accounts on
// one login is common, auto-picking one is a silent-footgun).
export const PENDING_SNAPCHAT_CONNECT_COOKIE = 'snapchat_pending_connect';

export interface PendingSnapchatConnect {
  clientId: string;
  refreshTokenEncrypted: string;
  accounts: { id: string; name: string; organizationId: string; organizationName: string; currency: string; timezone: string }[];
}
