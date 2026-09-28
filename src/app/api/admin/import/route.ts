import { NextResponse } from 'next/server';

// This one-time data-migration endpoint has been retired now that the
// SQLite -> Postgres migration (scripts/migrate-sqlite-to-postgres.cjs) is
// complete. Left as a 410 stub rather than deleting the route file outright,
// so a stray old request (or anyone probing the URL) gets a clear, inert
// answer instead of a 404 that looks like "maybe try a different path."
export async function POST() {
  return NextResponse.json({ error: 'This migration endpoint has been retired.' }, { status: 410 });
}
