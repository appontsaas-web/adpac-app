import { redirect } from 'next/navigation';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import { getClientTokenBalance } from '@/lib/tokens';
import { getLocale, getTr } from '@/lib/i18n/server';
import { formatMoney, formatDate } from '@/lib/i18n/format';
import LanguageToggle from '@/lib/i18n/LanguageToggle';

export const dynamic = 'force-dynamic';

// Customer-facing billing: invoices (with Pay online while unpaid + PDF) and token balance.
export default async function PortalBillingPage() {
  const tr = getTr();
  const locale = getLocale();
  const client = await getCurrentPortalClient();
  if (!client) redirect('/portal');

  const [info, invoices, tokens] = await Promise.all([
    db.client.findUnique({ where: { id: client.id }, select: { isFreeAnalysis: true, displayCurrency: true } }),
    db.invoice.findMany({ where: { clientId: client.id }, orderBy: { issuedAt: 'desc' }, take: 50 }),
    getClientTokenBalance(client.id),
  ]);
  if (info?.isFreeAnalysis) redirect('/portal/analysis');
  const money = (c: number) => formatMoney(c, locale, info?.displayCurrency);

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 48, paddingBottom: 60 }}>
      <a href="/portal" style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{tr('← Back')}</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 16px' }}>
        <h1 style={{ fontSize: '1.4rem' }}>{tr('Billing')}</h1>
        <LanguageToggle />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{tr('Token balance')}</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{tokens.toLocaleString('en-US')}</div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.05rem', marginBottom: 10 }}>{tr('Invoices')}</h2>
        {invoices.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{tr('No invoices yet.')}</p>}
        {invoices.map((inv) => (
          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--card-border)' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{inv.invoiceNumber} · {money(inv.amountCents)}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                {formatDate(inv.issuedAt, locale)}{inv.description ? ` · ${inv.description}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`badge ${inv.status === 'PAID' ? 'badge-approved' : 'badge-pending'}`}>{inv.status === 'PAID' ? tr('Paid') : tr('Unpaid')}</span>
              {inv.status === 'UNPAID' && inv.paymentLink && (
                <a className="btn" href={inv.paymentLink} target="_blank" rel="noopener noreferrer">{tr('Pay online ↗')}</a>
              )}
              <a className="btn btn-secondary" href={`/api/portal/invoices/${inv.id}/pdf`}>PDF</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
