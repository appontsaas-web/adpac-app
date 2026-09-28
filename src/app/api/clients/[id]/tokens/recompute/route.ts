import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import { recomputeClientTokens } from '@/lib/tokens';

// POST /api/clients/[id]/tokens/recompute — admin-only.
//
// Re-derives this client's entire token ledger from whatever's on file
// right now — see recomputeClientTokens in lib/tokens.ts for exactly what
// that means. This exists because several ledger inputs are deliberately
// NOT retroactive when you edit them: the global tokens-per-$ rate only
// prices invoices marked paid after the change, and an AI-impact override
// only affects days not yet synced. Editing an invoice, the rate, or an
// override on its own leaves already-recorded TOPUP/SPEND rows alone by
// design — this is the explicit "catch everything up to match" action, meant
// to be clicked after making one of those edits.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  try {
    const result = await recomputeClientTokens(params.id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('POST /api/clients/[id]/tokens/recompute failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
