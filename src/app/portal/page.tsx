import { getTr } from '@/lib/i18n/server';
import { redirect } from 'next/navigation';
import { getCurrentPortalClient, currentPeriodKey } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { loadPlatformRollup, Sums } from '@/lib/platformSpend';
import { formatMoney } from '@/lib/i18n/format';
import { getLocale } from '@/lib/i18n/server';
import PortalLoginForm from './PortalLoginForm';
import PortalLogoutButton from './PortalLogoutButton';
import { AGENTS, isAgentKey, agentAvatar } from '@/lib/agents';
import AgentContact from './AgentContact';
import LanguageToggle from '@/lib/i18n/LanguageToggle';

// The portal's home. Gated in two layers:
//   1. No session -> show the magic-link login form.
//   2. Signed in -> results first (this month vs last), with a single
//      "needs you" card listing only what is waiting on the customer
//      (monthly form, plan to approve, unpaid invoice). The monthly form is a
//      reminder here, no longer a lock that hides the results.
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
  const prospect = await db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true, displayCurrency: true, agent: true } });
  if (prospect?.isFreeAnalysis) redirect('/portal/analysis');

  const locale = getLocale();
  const periodKey = currentPeriodKey();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // Same-length window last month (day 1..today's day) so the comparison is fair mid-month.
  const prevEnd = new Date(prevStart.getTime() + (now.getTime() - monthStart.getTime()));

  const [thisMonthInput, pendingPlan, latestResolvedPlan, unpaid, cur, prev] = await Promise.all([
    db.monthlyInput.findUnique({ where: { clientId_periodKey: { clientId: client.id, periodKey } }, select: { id: true } }),
    db.marketingPlan.findFirst({ where: { clientId: client.id, status: 'PENDING_CLIENT_APPROVAL' }, orderBy: { createdAt: 'desc' } }),
    db.marketingPlan.findFirst({ where: { clientId: client.id, status: { in: ['CLIENT_APPROVED', 'CLIENT_REJECTED'] } }, orderBy: { respondedAt: 'desc' } }),
    db.invoice.aggregate({ where: { clientId: client.id, status: 'UNPAID' }, _count: { _all: true }, _sum: { amountCents: true } }),
    loadPlatformRollup(client.id, monthStart, now),
    loadPlatformRollup(client.id, prevStart, prevEnd),
  ]);

  const agent = isAgentKey(prospect?.agent) ? { key: prospect!.agent as keyof typeof AGENTS, ...AGENTS[prospect!.agent as keyof typeof AGENTS] } : null;
  const money = (c: number) => formatMoney(c, locale, prospect?.displayCurrency);
  const unpaidCount = unpaid._count._all;
  const needs: { key: string; title: string; text: string; href: string; cta: string }[] = [];
  if (pendingPlan) {
    needs.push({
      key: 'plan',
      title: tr("A plan is ready for your review"),
      text: `${pendingPlan.periodType === 'QUARTERLY' ? tr("Quarterly") : tr("Monthly")} ${tr("plan for")} ${pendingPlan.periodLabel}`,
      href: `/portal/plan/${pendingPlan.id}`,
      cta: tr("Review plan"),
    });
  }
  if (!thisMonthInput) {
    needs.push({
      key: 'form',
      title: tr("Tell us your goals for this month"),
      text: tr("Takes about a minute — we prefill it from last month."),
      href: '/portal/form',
      cta: tr("Update goals"),
    });
  }
  if (unpaidCount > 0) {
    needs.push({
      key: 'invoice',
      title: tr("You have an unpaid invoice"),
      text: `${unpaidCount} · ${money(unpaid._sum.amountCents ?? 0)}`,
      href: '/portal/billing',
      cta: tr("View & pay"),
    });
  }

  const t = cur.totals;
  const p = prev.totals;
  const cpr = (x: Sums) => (x.conversions > 0 ? x.costCents / x.conversions : null);
  const roas = (x: Sums) => (x.costCents > 0 ? x.conversionValueCents / x.costCents : null);
  const hasData = t.costCents > 0 || t.impressions > 0 || p.costCents > 0;

  const kpis: { label: string; value: string; delta: number | null; goodWhenUp: boolean }[] = [
    { label: tr("Spend"), value: money(t.costCents), delta: pct(t.costCents, p.costCents), goodWhenUp: true },
    { label: tr("Results (conversions)"), value: String(Math.round(t.conversions * 10) / 10), delta: pct(t.conversions, p.conversions), goodWhenUp: true },
    { label: tr("Cost per result"), value: cpr(t) != null ? money(Math.round(cpr(t)!)) : '—', delta: cpr(t) != null && cpr(p) != null ? pct(cpr(t)!, cpr(p)!) : null, goodWhenUp: false },
    { label: tr("Return on ad spend"), value: roas(t) != null ? `${roas(t)!.toFixed(2)}x` : '—', delta: roas(t) != null && roas(p) != null ? pct(roas(t)!, roas(p)!) : null, goodWhenUp: true },
    { label: tr("Clicks"), value: t.clicks.toLocaleString('en-US'), delta: pct(t.clicks, p.clicks), goodWhenUp: true },
  ];

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 48, paddingBottom: 60 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {agent && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agentAvatar(agent.key)} alt={agent.name} width={52} height={52} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          )}
          <div>
            <h1 style={{ fontSize: '1.4rem' }}>{tr("Welcome,")}{' '}{client.name}</h1>
            {agent && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                {tr("Your agent")}: <strong style={{ color: 'var(--text)' }}>{agent.name}</strong> · {agent.title}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="/portal/billing" className="btn btn-secondary">{tr("Billing")}</a>
          <LanguageToggle />
          <PortalLogoutButton />
        </div>
      </div>

      {needs.length > 0 ? (
        <div style={{ marginBottom: 20, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {tr("Needs you")} ({needs.length})
          </div>
          {needs.map((n) => (
            <div key={n.key} className="card" style={{ marginBottom: 0, borderColor: '#f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{n.title}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{n.text}</div>
              </div>
              <a href={n.href} className="btn">{n.cta}</a>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20, borderColor: '#22c55e' }}>
          <strong>{tr("You're all caught up")}</strong>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}> — {tr("nothing is waiting on you. Here is how your ads are doing.")}</span>
        </div>
      )}

      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        {tr("This month so far")} · {periodKey}
      </div>
      {hasData ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
            {kpis.map((k) => (
              <div key={k.label} className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{k.value}</div>
                {k.delta != null && (
                  <div style={{ fontSize: '0.75rem', marginTop: 2, color: k.delta === 0 ? 'var(--text-dim)' : (k.delta > 0) === k.goodWhenUp ? '#22c55e' : '#ef4444' }}>
                    {k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '•'} {Math.abs(Math.round(k.delta))}% {tr("vs same days last month")}
                  </div>
                )}
              </div>
            ))}
          </div>
          {cur.platforms.some((x) => x.costCents > 0) && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{tr("Where your budget went")}</div>
              {cur.platforms.filter((x) => x.costCents > 0).sort((a, b) => b.costCents - a.costCents).map((x) => (
                <div key={x.platform} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>{x.label}</span>
                    <span>{money(x.costCents)} · {Math.round((x.costCents / Math.max(t.costCents, 1)) * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--card-border)', borderRadius: 4 }}>
                    <div style={{ height: 6, borderRadius: 4, width: `${(x.costCents / Math.max(t.costCents, 1)) * 100}%`, background: 'var(--accent, #6d5efc)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 20 }}>
          {tr("Your results will appear here as soon as your campaigns start delivering.")}
        </p>
      )}

      {!pendingPlan && latestResolvedPlan && (
        <div className="card" style={{ marginBottom: 12 }}>
          <strong>{tr("Your last plan was")}{' '}{latestResolvedPlan.status === 'CLIENT_APPROVED' ? tr("approved") : tr("sent back for changes")}</strong>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}> · {latestResolvedPlan.periodLabel} </span>
          <a href={`/portal/plan/${latestResolvedPlan.id}`} className="btn btn-secondary" style={{ marginInlineStart: 8 }}>{tr("View")}</a>
        </div>
      )}
      <AgentContact agentName={agent?.name ?? null} />

      {thisMonthInput && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          {tr("This month's goals are submitted.")} <a href="/portal/form">{tr("Update this month's goals")}</a>
        </p>
      )}
    </div>
  );
}

/** Percent change; null when there is no previous value to compare against. */
function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}
