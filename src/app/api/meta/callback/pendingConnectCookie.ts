// Shared between /api/meta/callback (writer), /api/meta/connect/finish
// (reader), and the client page's ad-account picker (reader) — kept in one
// place so the name can never drift between them.
export const PENDING_META_CONNECT_COOKIE = 'meta_pending_connect';

export interface PendingMetaConnect {
  clientId: string;
  accessTokenEncrypted: string;
  tokenExpiresAt: string | null;
  accounts: { id: string; name: string; currency: string }[];
}
