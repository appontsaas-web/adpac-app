import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/mailer';

// The marketing site (adpac.to, a separate static-site origin) POSTs here
// directly from the browser — this is a public, unauthenticated endpoint by
// design. Allowed origin is locked down via CORS below rather than left as
// '*', and a hidden honeypot field (`company_website`, never shown or
// filled by a real visitor) quietly no-ops obvious bots without giving them
// an error response to learn from.
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

  // Honeypot: a real visitor never sees or fills this field (hidden via CSS
  // in the wizard). A bot filling every input on the form will. Respond
  // 200 as if it worked so the bot doesn't learn to look elsewhere, but
  // don't save anything or send any email.
  if (body.company_website) {
    return NextResponse.json({ ok: true }, { headers });
  }

  const businessName = String(body.businessName ?? '').trim();
  const contactName = String(body.contactName ?? '').trim();
  const contactEmail = String(body.contactEmail ?? '').trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);

  if (!businessName || !contactName || !emailOk) {
    return NextResponse.json(
      { error: 'businessName, contactName, and a valid contactEmail are required' },
      { status: 400, headers }
    );
  }

  const lead = await db.lead.create({
    data: {
      businessName,
      website: body.website || null,
      industry: body.industry || null,
      monthlyBudget: body.monthlyBudget || null,
      currentPlatforms: Array.isArray(body.currentPlatforms) ? body.currentPlatforms.join(', ') : null,
      primaryGoal: body.primaryGoal || null,
      targetAudience: body.targetAudience || null,
      challenges: Array.isArray(body.challenges) ? body.challenges.join(', ') : null,
      notes: body.notes || null,
      contactName,
      contactEmail,
      phone: body.phone || null,
      role: body.role || null,
    },
  });

  const summaryLines = [
    `Business name: ${lead.businessName}`,
    `Website: ${lead.website ?? '—'}`,
    `Industry: ${lead.industry ?? '—'}`,
    `Monthly ad budget: ${lead.monthlyBudget ?? '—'}`,
    `Current platforms: ${lead.currentPlatforms ?? '—'}`,
    `Primary goal: ${lead.primaryGoal ?? '—'}`,
    `Target audience: ${lead.targetAudience ?? '—'}`,
    `Challenges: ${lead.challenges ?? '—'}`,
    `Additional notes: ${lead.notes ?? '—'}`,
    '',
    `Contact name: ${lead.contactName}`,
    `Contact email: ${lead.contactEmail}`,
    `Phone: ${lead.phone ?? '—'}`,
    `Role: ${lead.role ?? '—'}`,
  ];

  // Best-effort: each email is tried independently, and a failure on either
  // is logged rather than thrown — the lead is already safely saved above,
  // so a Zoho hiccup shouldn't turn into a 500 for the visitor.
  try {
    await sendMail({
      to: process.env.ZOHO_SMTP_USER!,
      subject: `New AdPac lead — ${lead.businessName}`,
      text: summaryLines.join('\n'),
      replyTo: lead.contactEmail,
    });
    await db.lead.update({ where: { id: lead.id }, data: { notifiedAt: new Date() } });
  } catch (err: any) {
    console.error('Lead internal notification email failed:', err.message);
  }

  try {
    await sendMail({
      to: lead.contactEmail,
      subject: 'Thanks for reaching out to AdPac',
      text:
        `Hi ${lead.contactName.split(' ')[0]},\n\n` +
        `Thanks for telling us about ${lead.businessName} — we've got your details and our team will follow up within 1 business day.\n\n` +
        `If anything's urgent in the meantime, just reply to this email.\n\n` +
        `— The AdPac team`,
    });
    await db.lead.update({ where: { id: lead.id }, data: { confirmedAt: new Date() } });
  } catch (err: any) {
    console.error('Lead confirmation email failed:', err.message);
  }

  return NextResponse.json({ ok: true }, { headers });
}
