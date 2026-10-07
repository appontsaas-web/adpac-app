import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { findConnectedAccount, getAnalysis } from '@/lib/freeAnalysis';
import { getTr } from '@/lib/i18n/server';
import LanguageToggle from '@/lib/i18n/LanguageToggle';
import PortalLogoutButton from '../PortalLogoutButton';
import ConnectAccount from './ConnectAccount';
import GenerateAnalysis from './GenerateAnalysis';
import ProtectedReport from './ProtectedReport';

export const dynamic = 'force-dynamic';

const PICKERS = [
  { platform: 'meta', cookie: 'meta_pending_connect', label: 'Meta Ads' },
  { platform: 'snapchat', cookie: 'snapchat_pending_connect', label: 'Snapchat Ads' },
  { platform: 'tiktok', cookie: 'tiktok_pending_connect', label: 'TikTok Ads' },
];

// The prospect's whole portal: connect ONE ad account -> instant AI analysis
// + action plan, visible for 48h after it is generated, then locked.
export default async function FreeAnalysisPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const tr = getTr();
  const client = await getCurrentPortalClient();
  if (!client) redirect('/portal');
  const full = await db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true } });
  if (!full?.isFreeAnalysis) redirect('/portal');

  const analysis = await getAnalysis(client.id);
  const account = await findConnectedAccount(client.id);
  const errorMsg = searchParams.message;

  // Multi-account picker (cookie set by the shared OAuth callbacks).
  let picker: { platform: string; label: string; accounts: { id: string; name: string }[] } | null = null;
  if (!account) {
    for (const p of PICKERS) {
      if (searchParams[p.platform] !== 'choose') continue;
      try {
        const raw = cookies().get(p.cookie)?.value;
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.clientId === client.id) picker = { platform: p.platform, label: p.label, accounts: parsed.accounts.map((a: any) => ({ id: a.id, name: a.name || a.id })) };
      } catch {}
    }
  }

  return (
    <div className="container" style={{ maxWidth: 780, paddingTop: 48, paddingBottom: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.4rem' }}>{tr('Your free analysis & action plan')}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <LanguageToggle />
          <PortalLogoutButton />
        </div>
      </div>

      {errorMsg && <p style={{ color: '#ef4444', fontSize: '0.9rem', marginBottom: 14 }}>{errorMsg}</p>}

      {analysis?.status === 'READY' && analysis.content && analysis.expiresAt ? (
        <ProtectedReport
          data={JSON.parse(analysis.content)}
          expiresAt={analysis.expiresAt.toISOString()}
          watermark={client.portalContactEmail ?? client.name}
        />
      ) : analysis?.status === 'EXPIRED' ? (
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>{tr('Your free analysis has expired')}</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 12 }}>
            {tr('Free analyses are available for 48 hours. Want us to put the plan into action and manage your ads? Get in touch and we will pick up where the analysis left off.')}
          </p>
          <a className="btn" href="https://adpac.to/#pricing">{tr('See our agents & pricing')}</a>
        </div>
      ) : account ? (
        <GenerateAnalysis failed={analysis?.status === 'FAILED'} lastError={analysis?.error ?? null} />
      ) : picker ? (
        <div className="card">
          <h2 style={{ fontSize: '1.05rem', marginBottom: 8 }}>{tr('Choose the ad account to analyse')}</h2>
          <form method="POST" action="/api/portal/analysis/finish" style={{ display: 'grid', gap: 10 }}>
            <input type="hidden" name="platform" value={picker.platform} />
            <select name="accountId" required>
              {picker.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button className="btn" type="submit">{tr('Analyse this account')}</button>
          </form>
        </div>
      ) : (
        <ConnectAccount />
      )}
    </div>
  );
}
