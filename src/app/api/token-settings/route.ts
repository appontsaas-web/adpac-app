import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/access';
import { getTokensPerDollar, setTokensPerDollar } from '@/lib/tokens';

// GET /api/token-settings — any authenticated user can read the current
// rate (it's shown alongside balances). PUT is admin-only.
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const tokensPerDollar = await getTokensPerDollar();
  return NextResponse.json({ tokensPerDollar });
}

// PUT /api/token-settings
// Body: { tokensPerDollar: number }
// Admin-only: sets the global rate used to convert a paid invoice's amount
// into token credits going forward. Does not retroactively change past
// TokenTransaction rows.
export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (me.role !== 'ADMIN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { tokensPerDollar } = await req.json();
  const rate = Number(tokensPerDollar);
  if (!Number.isFinite(rate) || rate < 0) {
    return NextResponse.json({ error: 'tokensPerDollar must be a non-negative number' }, { status: 400 });
  }

  const setting = await setTokensPerDollar(rate, me.id);
  return NextResponse.json({ tokensPerDollar: setting.tokensPerDollar });
}
