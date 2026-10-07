'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TokenBalanceCard from './TokenBalanceCard';

interface Invoice {
  id: string;
  invoiceNumber: string;
  amountCents: number;
  description: string | null;
  status: string;
  issuedAt: string | Date;
  paidAt: string | Date | null;
  paymentLink: string | null;
}


const badgeClass: Record<string, string> = {
  UNPAID: 'badge-pending',
  PAID: 'badge-live',
};

// Non-admin read-only view: see invoices and download PDFs, plus one write
// action — asking for a token recharge (see POST /api/invoices/recharge-request).
// That creates a normal UNPAID invoice tagged as a recharge request; admin
// reviews and marks it paid the usual way. Everything else about invoices
// (create/edit/delete/mark paid directly) is always admin-only.
export default function InvoicesViewOnly({ clientId, invoices }: { clientId: string; invoices: Invoice[] }) {
  const { tr, moneyUsd: money, t } = useI18n();
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState(false);

  async function handleRequestRecharge(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents <= 0) {
      setError(tr("Enter a valid amount greater than 0."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/invoices/recharge-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, amountCents, note: note || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to submit recharge request"));
        return;
      }
      setAmount('');
      setNote('');
      setRequesting(false);
      setJustRequested(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to submit recharge request — network error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <TokenBalanceCard clientId={clientId} />
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: '1.1rem' }}>{tr("Invoices")}</h2>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setRequesting(!requesting);
              setJustRequested(false);
            }}
          >
            {requesting ? tr("Cancel") : tr("+ Request recharge")}
          </button>
        </div>

        {justRequested && (
          <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginBottom: 10 }}>
            {tr("Request sent — an admin will review it and create the invoice.")}
          </p>
        )}

        {requesting && (
          <form
            onSubmit={handleRequestRecharge}
            style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--card-border)' }}
          >
            <label>{tr("Amount you'd like to add (USD)")}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500.00"
              autoFocus
            />
            <label>{tr("Note (optional)")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("e.g. topping up for next month")} />
            <button className="btn" type="submit" disabled={saving}>
              {saving ? tr("Sending…") : tr("Send request")}
            </button>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: 6 }}>
              {tr("This creates an unpaid invoice for admin to review — nothing is charged automatically.")}
            </p>
          </form>
        )}

        {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

        {invoices.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No invoices yet.")}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 6px' }}>{tr("Invoice")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Date")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Description")}</th>
                  <th style={{ padding: '8px 6px' }}>{tr("Status")}</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Amount")}</th>
                  <th style={{ padding: '8px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: '8px 6px' }}>
                      <code>{inv.invoiceNumber}</code>
                    </td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {new Date(inv.issuedAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-dim)' }}>{inv.description ?? '—'}</td>
                    <td style={{ padding: '8px 6px' }}>
                      <span className={`badge ${badgeClass[inv.status] ?? 'badge-draft'}`}>{inv.status}</span>
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right' }}>{money(inv.amountCents)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a
                        href={`/api/invoices/${inv.id}/pdf`}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6, display: 'inline-block' }}
                      >
                        {tr("Download PDF")}
                      </a>
                      {inv.status === 'UNPAID' && inv.paymentLink && (
                        <a
                          href={inv.paymentLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '5px 10px', display: 'inline-block' }}
                        >
                          {tr("Pay online ↗")}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
