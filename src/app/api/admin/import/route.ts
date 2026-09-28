import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ONE-TIME DATA MIGRATION ENDPOINT — not part of the normal app.
//
// Lets scripts/migrate-sqlite-to-postgres.cjs push rows from the old local
// SQLite dev.db into this app's production Postgres database over plain
// HTTPS, since the database itself only accepts connections from this app
// (DigitalOcean "dev database" trusted-source restriction — no external
// client, including a developer's own laptop, can reach it directly).
//
// Protected by SYNC_SECRET (the same secret already used to authorize the
// background scheduler) via the x-sync-secret header — never open, never
// unauthenticated. Remove this route (and this file) once the one-time
// migration is done; it has no reason to exist afterward.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-sync-secret');
  if (!secret || secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { model, rows } = body as { model?: string; rows?: Record<string, unknown>[] };
  if (!model || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'Expected { model, rows }' }, { status: 400 });
  }

  const clientProp = model.charAt(0).toLowerCase() + model.slice(1);
  const delegate = (db as unknown as Record<string, { createMany: (args: unknown) => Promise<{ count: number }> }>)[clientProp];
  if (!delegate || typeof delegate.createMany !== 'function') {
    return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });
  }

  try {
    const result = await delegate.createMany({ data: rows, skipDuplicates: true });
    return NextResponse.json({ model, inserted: result.count, received: rows.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
