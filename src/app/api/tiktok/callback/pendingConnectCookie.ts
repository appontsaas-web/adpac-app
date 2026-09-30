// Same short-lived httpOnly cookie pattern as
// /api/snapchat/callback/pendingConnectCookie.ts — see that file's usage in
// snapchat/callback/route.ts for the full rationale (multiple advertiser
// accounts on one Business Center login is common, auto-picking one is a
// silent footgun).
export const PENDING_TIKTOK_CONNECT_COOKIE = 'tiktok_pending_connect';

export interface PendingTikTokConnect {
  clientId: string;
  refreshTokenEncrypted: string;
  accounts: { id: string; name: string; currency: string; timezone: string }[];
}
