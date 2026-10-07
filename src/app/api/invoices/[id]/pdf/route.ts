import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, canViewFinance } from '@/lib/access';
import { db } from '@/lib/db';
import PDFDocument from 'pdfkit';
import path from 'path';

const LOGO_PATH = path.join(process.cwd(), 'public', 'adpac-logo.png');

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// GET /api/invoices/[id]/pdf
// Renders a single invoice as a downloadable PDF, generated on the fly with
// pdfkit — no stored file, always reflects current DB state. Layout is a
// simple Stripe-style invoice: header, from/bill-to, amount-due banner, a
// single line-item row (phase 1 invoices are one flat amount), and totals.
//
// NOTE: the "from" business details below are placeholders — edit them with
// AdPac's real address/contact info before sending invoices to clients.
// `opts.skipAuth` is only ever passed by the portal wrapper route, which has already verified ownership.
// (Next.js only treats the first two args as the route signature, so HTTP callers can never set it.)
export async function GET(req: NextRequest, { params }: { params: { id: string } }, opts?: { skipAuth?: boolean }) {
  const me = opts?.skipAuth ? null : await getCurrentUser();
  if (!opts?.skipAuth && !me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const invoice = await db.invoice.findUnique({
    where: { id: params.id },
    include: { client: true },
  });
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  if (!opts?.skipAuth && !(await canViewFinance(me!, invoice.clientId))) {
    return NextResponse.json({ error: 'Invoice access required for this client' }, { status: 403 });
  }

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // Header
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#111').text('Invoice', 50, 50);
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#555')
    .text(`Invoice number  ${invoice.invoiceNumber}`, 50, 78)
    .text(`Date of issue  ${formatDate(invoice.issuedAt)}`, 50, 92);

  try {
    doc.image(LOGO_PATH, 480, 45, { width: 65 });
  } catch {
    // Fall back to a text wordmark if the logo file is missing.
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#111').text('AdPac', 350, 50, { width: 200, align: 'right' });
  }

  // From / Bill to
  const colY = 140;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#111').text('From', 50, colY);
  doc
    .font('Helvetica')
    .fillColor('#333')
    .text('AdPac', 50, colY + 14)
    .text('30 North Gould Street', 50, colY + 28)
    .text('Sheridan, WY 82801', 50, colY + 42)
    .text('US', 50, colY + 56)
    .text('Tax ID: 99-2400387', 50, colY + 70)
    .text('hello@adpac.to', 50, colY + 84);

  doc.font('Helvetica-Bold').fillColor('#111').text('Bill to', 320, colY);
  doc.font('Helvetica').fillColor('#333').text(invoice.client.name, 320, colY + 14);
  if (invoice.client.website) doc.text(invoice.client.website, 320, colY + 28);

  // Amount due / paid banner
  const bannerY = colY + 110; // From block now has 6 lines (address/tax id/email) — needs clearance
  const statusLine =
    invoice.status === 'PAID'
      ? `Paid — ${money(invoice.amountCents)} USD on ${formatDate(invoice.paidAt as Date)}${
          invoice.paymentMethod ? ` via ${invoice.paymentMethod}` : ''
        }`
      : `${money(invoice.amountCents)} USD due — issued ${formatDate(invoice.issuedAt)}`;
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#111').text(statusLine, 50, bannerY, { width: 500 });

  // "Pay online" link — only shown while unpaid and a payment link has been
  // set on the invoice (pasted in manually; no Stripe API integration yet).
  const showPayLink = invoice.status === 'UNPAID' && !!invoice.paymentLink;
  if (showPayLink) {
    const linkY = bannerY + 22;
    const linkText = 'Pay online →';
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0066cc').text(linkText, 50, linkY, { underline: true });
    const linkWidth = doc.widthOfString(linkText);
    doc.link(50, linkY, linkWidth, 14, invoice.paymentLink as string);
  }

  // Line item table
  const tableY = bannerY + (showPayLink ? 72 : 50);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#555');
  doc.text('Description', 50, tableY);
  doc.text('Qty', 350, tableY, { width: 40, align: 'right' });
  doc.text('Unit price', 400, tableY, { width: 70, align: 'right' });
  doc.text('Amount', 480, tableY, { width: 70, align: 'right' });
  doc
    .moveTo(50, tableY + 14)
    .lineTo(550, tableY + 14)
    .strokeColor('#ccc')
    .stroke();

  const rowY = tableY + 22;
  const desc = invoice.description || 'AdPac services';
  doc.font('Helvetica').fillColor('#111');
  doc.text(desc, 50, rowY, { width: 280 });
  doc.text('1', 350, rowY, { width: 40, align: 'right' });
  doc.text(money(invoice.amountCents), 400, rowY, { width: 70, align: 'right' });
  doc.text(money(invoice.amountCents), 480, rowY, { width: 70, align: 'right' });

  // Totals
  const totalsY = rowY + 40;
  doc
    .moveTo(350, totalsY)
    .lineTo(550, totalsY)
    .strokeColor('#ccc')
    .stroke();

  doc.font('Helvetica').fillColor('#555').text('Subtotal', 350, totalsY + 8, { width: 130, align: 'right' });
  doc.fillColor('#111').text(money(invoice.amountCents), 480, totalsY + 8, { width: 70, align: 'right' });

  doc.font('Helvetica').fillColor('#555').text('Total', 350, totalsY + 22, { width: 130, align: 'right' });
  doc.fillColor('#111').text(money(invoice.amountCents), 480, totalsY + 22, { width: 70, align: 'right' });

  doc
    .moveTo(350, totalsY + 38)
    .lineTo(550, totalsY + 38)
    .strokeColor('#333')
    .stroke();
  doc.font('Helvetica-Bold').fillColor('#111').text('Amount due', 350, totalsY + 44, { width: 130, align: 'right' });
  doc.text(
    invoice.status === 'PAID' ? `${money(0)} USD` : `${money(invoice.amountCents)} USD`,
    480,
    totalsY + 44,
    { width: 70, align: 'right' }
  );

  // Footer
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#888')
    .text(
      'This is a manually issued invoice — phase 1 has no payment processor. Please pay using the method AdPac has arranged with you directly.',
      50,
      760,
      { width: 500 }
    );

  doc.end();
  const buffer = await done;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  });
}
