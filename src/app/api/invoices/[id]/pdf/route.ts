import { NextRequest } from 'next/server';
import { renderInvoicePdf } from '@/lib/invoicePdf';

// GET /api/invoices/[id]/pdf — staff download (auth + finance access checked inside).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return renderInvoicePdf(params);
}
