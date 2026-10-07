import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPortalLoginLink } from '@/lib/clientPortalAuth';

// Public sign-up for the Free Analysis & Action Plan (called from the
// marketing site). Creates a prospect Client flagged isFreeAnalysis (portal
// shows ONLY the analysis) and emails a magic sign-in link. Same CORS +
// honeypot approach as /api/public/lead. Re-submitting an existing email
// just re-sends the link — never creates a second analysis.
const ALLOWED_ORIGIN = process.env.PUBLIC_SITE_ORIGIN ?? 'https://adpac.to';
const cors = () => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function POST(req: NextRequest) {
  const headers = cors();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers });
  if (body.company_website) return NextResponse.json({ ok: true }, { headers });

  const businessName = String(body.businessName ?? '').trim();
  const contactName = String(body.contactName ?? '').trim();
  const email = String(body.contactEmail ?? '').trim().toLowerCase();
  if (!businessName || !contactName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'businessName, contactName and a valid contactEmail are required' }, { status: 400, headers });
  }

  let client = await db.client.findFirst({ where: { portalContactEmail: { equals: email, mode: 'insensitive' } } });
  if (!client) {
    const owner = await db.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (!owner) return NextResponse.json({ error: 'Service unavailable' }, { status: 503, headers });
    client = await db.client.create({
      data: {
        name: businessName,
        website: body.website ? String(body.website).slice(0, 200) : null,
        industry: body.industry ? String(body.industry).slice(0, 100) : null,
        ownerUserId: owner.id,
        portalContactName: contactName,
        portalContactEmail: email,
        portalContactLocale: body.locale === 'ar' ? 'ar' : 'en',
        isFreeAnalysis: true,
      },
    });
  }
  try {
    await sendPortalLoginLink(client.id);
  } catch (err: any) {
    console.error('Free analysis sign-in email failed:', err.message);
  }
  return NextResponse.json({ ok: true, message: 'Check your email for your sign-in link.' }, { headers });
}
