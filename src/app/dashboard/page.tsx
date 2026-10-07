import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/access';
import DashboardNav from './DashboardNav';
import NewClientForm from './NewClientForm';
import ClientList, { type ClientRow } from './ClientList';
import { getT, getTr, getLocale } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/i18n/format';

const AI_PENDING = 'PENDING_APPROVAL';

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  const t = getT();
  const tr = getTr();
  const locale = getLocale();

  // Lightweight list query: counts and statuses only (no full campaign /
  // invoice rows), then everything else is fetched in parallel by client id.
  const clients = await db.client.findMany({
    where: me.role === 'ADMIN' ? undefined : { assignments: { some: { userId: me.id } } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      industry: true,
      displayCurrency: true,
      validUntil: true,
      googleAdsAccounts: { select: { status: true } },
      metaAdAccounts: { select: { status: true } },
      snapAdAccounts: { select: { status: true } },
      tiktokAdAccounts: { select: { status: true } },
      _count: { select: { campaigns: true } },
    },
  });
  const ids = clients.map((c) => c.id);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const range = { gte: monthStart };

  const [pendingByClient, rechargeByClient, google, meta, snap, tiktok] = ids.length
    ? await Promise.all([
        db.actionLog.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: AI_PENDING }, _count: { _all: true } }),
        me.role === 'ADMIN'
          ? db.invoice.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, status: 'UNPAID', source: 'RECHARGE_REQUEST' }, _count: { _all: true } })
          : Promise.resolve([] as { clientId: string; _count: { _all: number } }[]),
        db.dailyMetric.findMany({ where: { date: range, campaign: { clientId: { in: ids } } }, select: { costCents: true, campaign: { select: { clientId: true } } } }),
        db.metaDailyMetric.findMany({ where: { date: range, campaign: { adAccount: { clientId: { in: ids } } } }, select: { costCents: true, campaign: { select: { adAccount: { select: { clientId: true } } } } } }),
        db.snapDailyMetric.findMany({ where: { date: range, campaign: { adAccount: { clientId: { in: ids } } } }, select: { costCents: true, campaign: { select: { adAccount: { select: { clientId: true } } } } } }),
        db.tikTokDailyMetric.findMany({ where: { date: range, campaign: { adAccount: { clientId: { in: ids } } } }, select: { costCents: true, campaign: { select: { adAccount: { select: { clientId: true } } } } } }),
      ])
    : [[], [], [], [], [], []];

  const pending = new Map((pendingByClient as any[]).map((r) => [r.clientId, r._count._all as number]));
  const recharge = new Map((rechargeByClient as any[]).map((r) => [r.clientId, r._count._all as number]));
  const spend = new Map<string, number>();
  const add = (id: string | undefined, cents: number) => {
    if (id) spend.set(id, (spend.get(id) ?? 0) + cents);
  };
  for (const m of google as any[]) add(m.campaign.clientId, m.costCents);
  for (const m of meta as any[]) add(m.campaign.adAccount.clientId, m.costCents);
  for (const m of snap as any[]) add(m.campaign.adAccount.clientId, m.costCents);
  for (const m of tiktok as any[]) add(m.campaign.adAccount.clientId, m.costCents);

  const now = Date.now();
  const rows: ClientRow[] = clients.map((c) => {
    const accounts = [...c.googleAdsAccounts, ...c.metaAdAccounts, ...c.snapAdAccounts, ...c.tiktokAdAccounts];
    const issues: string[] = [];
    if (accounts.length === 0) issues.push(tr('No platform connected'));
    else if (accounts.some((a) => a.status !== 'connected')) issues.push(tr('A platform needs reconnecting'));
    const p = pending.get(c.id) ?? 0;
    if (p > 0) issues.push(tr('{n} AI insight(s) awaiting approval', { n: p }));
    const rc = recharge.get(c.id) ?? 0;
    if (me.role === 'ADMIN' && rc > 0) issues.push(tr('{n} recharge request(s) pending', { n: rc }));
    if (c.validUntil) {
      const days = Math.ceil((c.validUntil.getTime() - now) / 86400000);
      if (days < 0) issues.push(tr('Account validity expired'));
      else if (days <= 14) issues.push(tr('Account validity ends in {n} day(s)', { n: days }));
    }
    return {
      id: c.id,
      name: c.name,
      industry: c.industry ?? t('home.noIndustry'),
      connected: accounts.length > 0,
      campaigns: c._count.campaigns,
      spendLabel: formatMoney(spend.get(c.id) ?? 0, locale, c.displayCurrency),
      spendCents: spend.get(c.id) ?? 0,
      pending: p,
      recharge: me.role === 'ADMIN' ? rc : 0,
      issues,
    };
  });

  const totalSpendUsd = rows.reduce((a, r) => a + r.spendCents, 0);
  const needAttention = rows.filter((r) => r.issues.length > 0).length;
  const totalPending = rows.reduce((a, r) => a + r.pending, 0);
  const totalRecharge = rows.reduce((a, r) => a + r.recharge, 0);

  return (
    <div className="container">
      <DashboardNav />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.6rem' }}>{t('home.title')}</h1>
        {me.role === 'ADMIN' && totalRecharge > 0 && (
          <span className="badge badge-pending">{t('home.rechargePending', { n: totalRecharge })}</span>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Stat label={tr('Clients')} value={String(rows.length)} />
          <Stat label={tr('Spend this month (USD, all platforms)')} value={formatMoney(totalSpendUsd, locale, 'USD')} />
          <Stat label={tr('AI insights awaiting approval')} value={String(totalPending)} warn={totalPending > 0} />
          <Stat label={tr('Clients needing attention')} value={String(needAttention)} warn={needAttention > 0} />
        </div>
      )}

      {me.role === 'ADMIN' && <NewClientForm />}

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>{me.role === 'ADMIN' ? t('home.noClientsAdmin') : t('home.noClientsStaff')}</p>
      ) : (
        <ClientList rows={rows} isAdmin={me.role === 'ADMIN'} />
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="card" style={{ marginBottom: 0, borderColor: warn ? '#f59e0b' : undefined }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{value}</div>
    </div>
  );
}
