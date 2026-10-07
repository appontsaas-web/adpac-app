import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/access';
import DashboardNav from './DashboardNav';
import NewClientForm from './NewClientForm';
import { getT } from '@/lib/i18n/server';

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  const t = getT();

  const clients = await db.client.findMany({
    where: me.role === 'ADMIN' ? undefined : { assignments: { some: { userId: me.id } } },
    orderBy: { createdAt: 'desc' },
    include: {
      googleAdsAccounts: true,
      campaigns: true,
      // Used for the admin-only "pending recharge" badge below — cheap
      // since it's just UNPAID recharge-request invoices, usually few.
      // Harmless to fetch for STAFF too; just never rendered for them.
      invoices: { where: { status: 'UNPAID', source: 'RECHARGE_REQUEST' }, select: { id: true } },
    },
  });
  const totalPendingRequests = clients.reduce((s, c) => s + c.invoices.length, 0);

  return (
    <div className="container">
      <DashboardNav />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.6rem' }}>{t('home.title')}</h1>
        {me.role === 'ADMIN' && totalPendingRequests > 0 && (
          <span className="badge badge-pending">
            {t('home.rechargePending', { n: totalPendingRequests })}
          </span>
        )}
      </div>

      {me.role === 'ADMIN' && <NewClientForm />}

      {clients.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>
          {me.role === 'ADMIN' ? t('home.noClientsAdmin') : t('home.noClientsStaff')}
        </p>
      )}

      {clients.map((c) => (
        <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                {c.industry ?? t('home.noIndustry')} ·{' '}
                {c.googleAdsAccounts.length > 0 ? t('home.gadsConnected') : t('home.notConnected')} ·{' '}
                {t('home.campaignCount', { n: c.campaigns.length })}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {me.role === 'ADMIN' && c.invoices.length > 0 && (
                <span className="badge badge-pending">{t('home.rechargePendingShort', { n: c.invoices.length })}</span>
              )}
              <span className="badge badge-approved">{t('home.view')}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
