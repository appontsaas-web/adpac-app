import nodemailer from 'nodemailer';

// ---------------------------------------------------------------------------
// Thin wrapper around Zoho's SMTP (smtppro.zoho.com) for the two automated
// emails the marketing site now sends on submit (see /api/public/lead and
// /api/public/schedule-call): an internal notification to the team, and a
// confirmation to whoever submitted the form. Replaces the old approach of
// opening the VISITOR's own mail client via a mailto: link, which silently
// lost a lead any time they didn't have a desktop mail client configured.
//
// Requires ZOHO_SMTP_USER and ZOHO_SMTP_PASS (a Zoho "app-specific
// password", not the account's real login password — see .env.example) to
// be set. ZOHO_SMTP_HOST/PORT have sensible defaults for Zoho's own SMTP
// relay and shouldn't normally need overriding.
// ---------------------------------------------------------------------------

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_PASS;
  if (!user || !pass) {
    throw new Error('ZOHO_SMTP_USER / ZOHO_SMTP_PASS are not set — see .env.example');
  }

  const host = process.env.ZOHO_SMTP_HOST ?? 'smtppro.zoho.com';
  const port = Number(process.env.ZOHO_SMTP_PORT ?? 465);

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // Zoho: 465 = implicit TLS, 587 = STARTTLS
    auth: { user, pass },
  });
  return cachedTransporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/** Sends one plain-text email via Zoho SMTP. Throws on failure — callers decide whether that should block the request or just get logged (see the two /api/public/* routes: a failed email never blocks saving the underlying Lead/CallRequest record). */
export async function sendMail({ to, subject, text, replyTo }: SendMailInput): Promise<void> {
  const transporter = getTransporter();
  const from = process.env.ZOHO_SMTP_USER!;
  await transporter.sendMail({ from, to, subject, text, replyTo });
}
