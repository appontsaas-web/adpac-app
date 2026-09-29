import { NextResponse } from 'next/server';
import { clearPortalSessionCookie } from '@/lib/clientPortalAuth';

export async function POST() {
  clearPortalSessionCookie();
  return NextResponse.json({ ok: true });
}
