import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Auth for the internal agent API (/api/agent/*). Used by the AdPac media
// buyer agent (or any staff-run script). Separate secret from SYNC_SECRET so
// it can be rotated independently. If AGENT_API_SECRET is not set, the whole
// API is disabled (404-style 503) rather than open.
export function checkAgentSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_API_SECRET;
  if (!expected) return NextResponse.json({ error: 'Agent API is not configured' }, { status: 503 });
  const given = req.headers.get('x-agent-secret') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
