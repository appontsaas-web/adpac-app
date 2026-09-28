import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/mailer';

// Same public, CORS-locked, honeypot-guarded shape as /api/public/lead —
// see that route's comments for the reasoning.
const ALLOWED_ORIGIN = process.env.PUBLIC_SITE_ORIGIN ?? 'https://adpac.to';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers });

  if (body.company_website) {
    return NextResponse.json({ ok: true }, { headers });
  }

  const requestedDate = String(body.requestedDate ?? '').trim();
  const requestedTime = String(body.requestedTime ?? '').trim();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!requestedDate || !requestedTime || !name || !emailOk) {
    return NextResponse.json(
      { error: 'requestedDate, requestedTime, name, and a valid email are required' },
      { status: 400, headers }
    );
  }

  const callRequest = await db.callRequest.create({
    data: {
      requestedDate,
      requestedTime,
      name,
      email,
      company: body.company || null,
      topic: body.topic || null,
    },
  });

  try {
    await sendMail({
      to: process.env.ZOHO_SMTP_USER!,
      subject: `Call request — ${callRequest.name} — ${callRequest.requestedDate} ${callRequest.requestedTime}`,
      text: [
        `Requested date: ${callRequest.requestedDate}`,
        `Requested time: ${callRequest.requestedTime} ET`,
        '',
        `Name: ${callRequest.name}`,
        `Email: ${callRequest.email}`,
        `Company: ${callRequest.company ?? '—'}`,
        `Topic: ${callRequest.topic ?? '—'}`,
      ].join('\n'),
      replyTo: callRequest.email,
    });
    await db.callRequest.update({ where: { id: callRequest.id }, data: { notifiedAt: new Date() } });
  } catch (err: any) {
    console.error('Call request internal notification email failed:', err.message);
  }

  try {
    await sendMail({
      to: callRequest.email,
      subject: 'Your AdPac call request',
      text:
        `Hi ${callRequest.name.split(' ')[0]},\n\n` +
        `We've received your request for a call on ${callRequest.requestedDate} at ${callRequest.requestedTime} ET. ` +
        `Our team will confirm shortly — if that time doesn't end up working, we'll reach out to find one that does.\n\n` +
        `— The AdPac team`,
    });
    await db.callRequest.update({ where: { id: callRequest.id }, data: { confirmedAt: new Date() } });
  } catch (err: any) {
    console.error('Call request confirmation email failed:', err.message);
  }

  return NextResponse.json({ ok: true }, { headers });
}
