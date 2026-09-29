import { randomBytes, createHash } from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import { sendMail } from './mailer';

// ---------------------------------------------------------------------------
// Client Portal auth — magic-link, no password, entirely separate from the
// staff NextAuth session used under /dashboard (different cookie name,
// different session store). A client's only credential is "control of the
// portalContactEmail inbox", same trust model as any consumer magic-link
// login (Slack, Notion, etc.) — appropriate here since AdPac never asks the
// client to remember a password for what's a once-a-month visit.
//
// Tokens (both the login link and the resulting session) are stored hashed
// (sha256) — the raw value only ever exists in the emailed URL / the
// client's browser cookie, never at rest in the DB, same reasoning as a
// password hash.
// ---------------------------------------------------------------------------

const PORTAL_SESSION_COOKIE = 'adpac_portal_session';
const LOGIN_TOKEN_TTL_MINUTES = 30;
const SESSION_TTL_DAYS = 30;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function newRawToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Issues a login link for the given client (if it has a portalContactEmail)
 * and emails it via Zoho SMTP. Silently no-ops if the client has no portal
 * contact configured — callers that want to surface that should check
 * client.portalContactEmail themselves first.
 */
export async function sendPortalLoginLink(clientId: string): Promise<{ sent: boolean }> {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client?.portalContactEmail) return { sent: false };

  const raw = newRawToken();
  await db.clientPortalToken.create({
    data: {
      clientId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MINUTES * 60 * 1000),
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3010';
  const link = `${baseUrl}/api/portal/verify?token=${raw}`;

  await sendMail({
    to: client.portalContactEmail,
    subject: `Sign in to your AdPac portal — ${client.name}`,
    text:
      `Hi${client.portalContactName ? ` ${client.portalContactName.split(' ')[0]}` : ''},\n\n` +
      `Click the link below to sign in to your AdPac client portal. This link expires in ${LOGIN_TOKEN_TTL_MINUTES} minutes and can only be used once:\n\n` +
      `${link}\n\n` +
      `If you didn't request this, you can safely ignore this email.\n\n` +
      `— The AdPac team`,
  });

  return { sent: true };
}

/**
 * Verifies a raw login token from the emailed link, consumes it (single-use),
 * and creates a new portal session — returns the raw session token to set as
 * a cookie, or null if the login token is invalid/expired/already used.
 */
export async function verifyPortalLoginToken(rawToken: string): Promise<{ clientId: string; sessionToken: string } | null> {
  const tokenHash = hashToken(rawToken);
  const record = await db.clientPortalToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;

  await db.clientPortalToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  const sessionRaw = newRawToken();
  await db.clientPortalSession.create({
    data: {
      clientId: record.clientId,
      tokenHash: hashToken(sessionRaw),
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { clientId: record.clientId, sessionToken: sessionRaw };
}

/** Sets the portal session cookie — call right after verifyPortalLoginToken in the route handler. */
export function setPortalSessionCookie(sessionToken: string) {
  cookies().set(PORTAL_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    path: '/',
  });
}

export function clearPortalSessionCookie() {
  cookies().delete(PORTAL_SESSION_COOKIE);
}

export interface PortalClient {
  id: string;
  name: string;
  portalContactName: string | null;
  portalContactEmail: string | null;
}

/**
 * Reads the portal session cookie (if any) and returns the signed-in
 * client, or null. Used by every /portal page and /api/portal/* route the
 * same way getCurrentUser() is used for staff.
 */
export async function getCurrentPortalClient(): Promise<PortalClient | null> {
  const raw = cookies().get(PORTAL_SESSION_COOKIE)?.value;
  if (!raw) return null;

  const session = await db.clientPortalSession.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!session || session.expiresAt < new Date()) return null;

  const client = await db.client.findUnique({ where: { id: session.clientId } });
  if (!client) return null;

  return {
    id: client.id,
    name: client.name,
    portalContactName: client.portalContactName,
    portalContactEmail: client.portalContactEmail,
  };
}

/** "2026-10" in UTC — the monthly cadence key used by MonthlyInput.periodKey, same convention as ClientMonthlyGoal.monthKey. */
export function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
