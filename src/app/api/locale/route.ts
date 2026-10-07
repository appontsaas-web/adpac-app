import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n/config';

// POST /api/locale — body { locale: "en" | "ar" }. Public (login + portal
// pages need it too): always sets the adpac_locale cookie; additionally
// persists it on the User row when a staff session exists, so emails and
// server-side output (AI text, PDFs) can follow the same language.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isLocale(body.locale)) return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });

  const me = await getCurrentUser().catch(() => null);
  if (me) await db.user.update({ where: { id: me.id }, data: { locale: body.locale } });

  const res = NextResponse.json({ ok: true, locale: body.locale });
  res.cookies.set(LOCALE_COOKIE, body.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
