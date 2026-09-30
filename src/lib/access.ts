import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { db } from './db';

export type AccessLevel = 'ADMIN' | 'EDIT' | 'VIEW' | null;

export interface PositionCapabilities {
  id: string;
  name: string;
  canManageCampaigns: boolean;
  canManageGoogleAds: boolean;
  canManageTargeting: boolean;
  canViewInvoices: boolean;
  canViewReporting: boolean;
  canManageTagManager: boolean;
  canManageBusinessProfile: boolean;
  canManageMeta: boolean;
  canManageSnapchat: boolean;
  canManageTikTok: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: string; // ADMIN | STAFF
  position: PositionCapabilities | null;
}

// Looks up the signed-in user's role/position fresh from the DB on every
// call (rather than trusting the JWT) so changes take effect immediately
// without requiring the user to log out/in again.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  const uid = (session?.user as { id?: string } | undefined)?.id;
  if (!uid) return null;

  const user = await db.user.findUnique({ where: { id: uid }, include: { position: true } });
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    position: user.position
      ? {
          id: user.position.id,
          name: user.position.name,
          canManageCampaigns: user.position.canManageCampaigns,
          canManageGoogleAds: user.position.canManageGoogleAds,
          canManageTargeting: user.position.canManageTargeting,
          canViewInvoices: user.position.canViewInvoices,
          canViewReporting: user.position.canViewReporting,
          canManageTagManager: user.position.canManageTagManager,
          canManageBusinessProfile: user.position.canManageBusinessProfile,
          canManageMeta: user.position.canManageMeta,
          canManageSnapchat: user.position.canManageSnapchat,
          canManageTikTok: user.position.canManageTikTok,
        }
      : null,
  };
}

// ADMIN implicitly has EDIT-level access (and Finance access) to every
// client. STAFF only has whatever a ClientAssignment row grants them.
export async function getClientAccess(user: CurrentUser, clientId: string): Promise<AccessLevel> {
  if (user.role === 'ADMIN') return 'ADMIN';
  const assignment = await db.clientAssignment.findUnique({
    where: { clientId_userId: { clientId, userId: user.id } },
  });
  if (!assignment) return null;
  return assignment.permission === 'EDIT' ? 'EDIT' : 'VIEW';
}

export function canEdit(level: AccessLevel): boolean {
  return level === 'ADMIN' || level === 'EDIT';
}

export function canView(level: AccessLevel): boolean {
  return level === 'ADMIN' || level === 'EDIT' || level === 'VIEW';
}

export type Capability = 'campaigns' | 'googleAds' | 'targeting' | 'tagManager' | 'businessProfile' | 'meta' | 'snapchat' | 'tiktok';

// Combines client-level access (VIEW/EDIT/ADMIN) with the user's Position to
// answer "can this person actually do X on this client". ADMIN always true.
// A STAFF user needs BOTH EDIT access to the client AND their assigned
// Position to have the matching capability enabled — EDIT access alone
// (no position, or a position without this toggle) grants nothing.
export async function hasCapability(user: CurrentUser, clientId: string, capability: Capability): Promise<boolean> {
  const access = await getClientAccess(user, clientId);
  if (access === 'ADMIN') return true;
  if (access !== 'EDIT') return false;
  if (!user.position) return false;
  switch (capability) {
    case 'campaigns':
      return user.position.canManageCampaigns;
    case 'googleAds':
      return user.position.canManageGoogleAds;
    case 'targeting':
      return user.position.canManageTargeting;
    case 'tagManager':
      return user.position.canManageTagManager;
    case 'businessProfile':
      return user.position.canManageBusinessProfile;
    case 'meta':
      return user.position.canManageMeta;
    case 'snapchat':
      return user.position.canManageSnapchat;
    case 'tiktok':
      return user.position.canManageTikTok;
    default:
      return false;
  }
}

// Whether this user can view/download/pay invoices for this client. Unlike
// the campaigns/googleAds/targeting capabilities above, this doesn't require
// EDIT-level client access — viewing invoices isn't an edit action, so VIEW
// access is enough as long as the Position also has canViewInvoices set.
// ADMIN always true. Creating/editing/deleting/marking paid an invoice is
// never covered by this — that stays admin-only everywhere in the API.
export async function canViewFinance(user: CurrentUser, clientId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  const access = await getClientAccess(user, clientId);
  if (!access) return false;
  return !!user.position?.canViewInvoices;
}

// Whether this user can see the performance/reporting dashboard (metrics,
// charts, audience breakdowns) for this client, and trigger a manual sync.
// Same shape as canViewFinance — VIEW client access is enough as long as the
// Position also has canViewReporting set; EDIT is not required, since this
// is read-only. ADMIN always true.
//
// This used to not exist as a real gate at all: the reporting dashboard (and
// the campaigns list) rendered for anyone with any client access, regardless
// of Position. That meant a Position with only canViewInvoices enabled (e.g.
// a finance-only role) could still see campaigns and performance data on the
// client page — neither of those were actually capability-gated. Both are
// now gated: campaigns behind canManageCampaigns (see hasCapability), and
// reporting/performance behind this function.
export async function canViewReporting(user: CurrentUser, clientId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  const access = await getClientAccess(user, clientId);
  if (!access) return false;
  return !!user.position?.canViewReporting;
}
