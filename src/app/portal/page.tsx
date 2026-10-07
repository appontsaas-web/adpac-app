import { getTr } from '@/lib/i18n/server';
import { redirect } from 'next/navigation';
import { getCurrentPortalClient, currentPeriodKey } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import PortalLoginForm from './PortalLoginForm';
import PortalLogoutButton from './PortalLogoutButton';
import LanguageToggle from '@/lib/i18n/LanguageToggle';

// The portal's home. Gated in two layers:
//   1. No session -> show the magic-link login form.
//   2. Signed in but hasn't submitted THIS month's input yet -> forced to
//      /portal/form before seeing anything else (the "forced monthly form"
//      the client asked for).
// Once both are satisfied, shows whatever's next: a plan waiting for
// approval, or a "you're all set" state.
export default async function PortalHomePage({ searchParams }: { searchParams: { error?: string } }) {
  const tr = getTr();
  const client = await getCurrentPortalClient();

  if (!client) {
    return (
      <>
        {searchParams.error && (
          <div className="container" style={{ maxWidth: 380, paddingTop: 24, textAlign: 'center' }}>
            <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>
              {searchParams.error === 'invalid-or-expired'
                ? tr("That sign-in link is invalid or has expired — request a new one below.")
                : tr("Something went wrong — request a new sign-in link below.")}
            </p>
          </div>
        )}
        <div className="container" style={{ maxWidth: 380, paddingTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <LanguageToggle />
        </div>
        <PortalLoginForm />
      </>
    );
  }

  // Self-signed-up prospects only get the free analysis — no monthly form / plans.
  const prospect = await db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true } });
  if (prospect?.isFreeAnalysis) redirect('/portal/analysis');

  const periodKey = currentPeriodKey();
  const thisMonthInput = await db.monthlyInput.findUnique({
    where: { clientId_periodKey: { clientId: client.id, periodKey } },
  });

  if (!thisMonthInput) {
    redirect('/portal/form');
  }

  const pendingPlan = await db.marketingPlan.findFirst({
    where: { clientId: client.id, status: 'PENDING_CLIENT_APPROVAL' },
    orderBy: { createdAt: 'desc' },
  });
  const latestResolvedPlan = await db.marketingPlan.findFirst({
    where: { clientId: client.id, status: { in: ['CLIENT_APPROVED', 'CLIENT_REJECTED'] } },
    orderBy: { respondedAt: 'desc' },
  });

  return (
    <div className="container" style={{ maxWidth: 640, paddingTop: 60, paddingBottom: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem' }}>{tr("Welcome,")}{' '}{client.name}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <LanguageToggle />
          <PortalLogoutButton />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.05rem', marginBottom: 6 }}>{tr("This month's input")}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 10 }}>
          {tr("Submitted for")}{' '}{periodKey}{tr(". Want to update it?")}
        </p>
        <a href="/portal/form" className="btn btn-secondary">
          {tr("Update this month's goals")}
        </a>
      </div>

      {pendingPlan && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent, #6d5efc)' }}>
          <h2 style={{ fontSize: '1.05rem', marginBottom: 6 }}>{tr("A plan is ready for your review")}</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 10 }}>
            {pendingPlan.periodType === 'QUARTERLY' ? tr("Quarterly") : tr("Monthly")} {tr("plan for")}{' '}{pendingPlan.periodLabel} {tr("— personas, ad copy, and recommended next steps.")}
          </p>
          <a href={`/portal/plan/${pendingPlan.id}`} className="btn">
            {tr("Review plan")}
          </a>
        </div>
      )}

      {!pendingPlan && latestResolvedPlan && (
        <div className="card">
          <h2 style={{ fontSize: '1.05rem', marginBottom: 6 }}>
            {tr("Your last plan was")}{' '}{latestResolvedPlan.status === 'CLIENT_APPROVED' ? tr("approved") : tr("sent back for changes")}
          </h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 10 }}>
            {latestResolvedPlan.periodType === 'QUARTERLY' ? tr("Quarterly") : tr("Monthly")} {tr("plan for")}{' '}
            {latestResolvedPlan.periodLabel}.
          </p>
          <a href={`/portal/plan/${latestResolvedPlan.id}`} className="btn btn-secondary">
            {tr("View")}
          </a>
        </div>
      )}

      {!pendingPlan && !latestResolvedPlan && (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          {tr("You're all set for now — we'll email you when your next plan is ready for review.")}
        </p>
      )}
    </div>
  );
}
