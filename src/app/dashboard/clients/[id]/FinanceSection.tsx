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
  status: string; // UNPAID | PAID
  issuedAt: string | Date;
  paidAt: string | Date | null;
  paymentMethod: string | null;
  paymentLink: string | null;
  source?: string; // MANUAL | RECHARGE_REQUEST
  requestedByUserId?: string | null;
}


function todayISODate() {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 10);
}

function toISODate(d: string | Date | null) {
  if (!d) return todayISODate();
  const date = new Date(d);
  const tz = date.getTimezoneOffset();
  return new Date(date.getTime() - tz * 60000).toISOString().slice(0, 10);
}

const badgeClass: Record<string, string> = {
  UNPAID: 'badge-pending',
  PAID: 'badge-live',
};

// Phase 1 finance: fully manual. No payment processor is wired up — AdPac
// staff create an invoice here, hand it to the client through whatever
// channel they actually pay with (bank transfer, cash, etc.), and mark it
// paid once confirmed. This is the client-facing payment history record.
//
// Edits and deletes are allowed on paid invoices too (single-operator tool,
// mistakes happen) — there's no separate "locked" state.
export default function FinanceSection({
  clientId,
  invoices,
  requesterNames = {},
}: {
  clientId: string;
  invoices: Invoice[];
  requesterNames?: Record<string, string>;
}) {
  const { tr, moneyUsd: money, t } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentLink, setPaymentLink] = useState('');
  const [issuedAtInput, setIssuedAtInput] = useState(todayISODate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Only one inline row-form open at a time.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [openRowMode, setOpenRowMode] = useState<'markPaid' | 'edit' | null>(null);

  const [paidAtInput, setPaidAtInput] = useState('');
  const [paymentMethodInput, setPaymentMethodInput] = useState('');

  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPaymentLink, setEditPaymentLink] = useState('');
  const [editIssuedAt, setEditIssuedAt] = useState('');

  const totalPaidCents = invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountCents, 0);
  const outstandingCents = invoices.filter((i) => i.status === 'UNPAID').reduce((s, i) => s + i.amountCents, 0);
  const pendingRequests = invoices.filter((i) => i.status === 'UNPAID' && i.source === 'RECHARGE_REQUEST');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents <= 0) {
      setError(tr("Enter a valid amount greater than 0."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          amountCents,
          description,
          invoiceNumber: invoiceNumber || undefined,
          paymentLink: paymentLink || undefined,
          issuedAt: issuedAtInput || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to create invoice"));
        return;
      }
      setAmount('');
      setDescription('');
      setInvoiceNumber('');
      setPaymentLink('');
      setIssuedAtInput(todayISODate());
      setCreating(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to create invoice — network error"));
    } finally {
      setSaving(false);
    }
  }

  function openMarkPaid(inv: Invoice) {
    setOpenRowId(inv.id);
    setOpenRowMode('markPaid');
    setPaidAtInput(toISODate(inv.paidAt));
    setPaymentMethodInput(inv.paymentMethod ?? '');
    setError(null);
  }

  function openEdit(inv: Invoice) {
    setOpenRowId(inv.id);
    setOpenRowMode('edit');
    setEditInvoiceNumber(inv.invoiceNumber);
    setEditAmount((inv.amountCents / 100).toString());
    setEditDescription(inv.description ?? '');
    setEditPaymentLink(inv.paymentLink ?? '');
    setEditIssuedAt(toISODate(inv.issuedAt));
    setPaidAtInput(toISODate(inv.paidAt));
    setPaymentMethodInput(inv.paymentMethod ?? '');
    setError(null);
  }

  function closeRow() {
    setOpenRowId(null);
    setOpenRowMode(null);
  }

  async function handleConfirmMarkPaid(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'PAID',
          paidAt: paidAtInput || undefined,
          paymentMethod: paymentMethodInput || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to mark as paid"));
        return;
      }
      closeRow();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to mark as paid — network error"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnmarkPaid(id: string) {
    if (!confirm('Revert this invoice back to unpaid?')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'UNPAID' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to revert to unpaid"));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to revert to unpaid — network error"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmEdit(inv: Invoice) {
    const amountCents = Math.round(Number(editAmount) * 100);
    if (!amountCents || amountCents <= 0) {
      setError(tr("Enter a valid amount greater than 0."));
      return;
    }
    setBusyId(inv.id);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        invoiceNumber: editInvoiceNumber,
        amountCents,
        description: editDescription,
        paymentLink: editPaymentLink,
        issuedAt: editIssuedAt || undefined,
      };
      if (inv.status === 'PAID') {
        body.status = 'PAID';
        body.paidAt = paidAtInput || undefined;
        body.paymentMethod = paymentMethodInput || undefined;
      }
      const res = await fetch(`/api/invoices/${inv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to save changes"));
        return;
      }
      closeRow();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to save changes — network error"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, invoiceNumber: string, status: string) {
    const msg =
      status === 'PAID'
        ? `Delete PAID invoice ${invoiceNumber}? This removes it from the payment history and can't be undone.`
        : `Delete unpaid invoice ${invoiceNumber}? This can't be undone.`;
    if (!confirm(msg)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to delete invoice"));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to delete invoice — network error"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <TokenBalanceCard clientId={clientId} isAdmin />
      <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr("Finance")}</h2>
        <button className="btn btn-secondary" onClick={() => setCreating(!creating)}>
          {creating ? tr("Cancel") : tr("+ New invoice")}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: '0.85rem' }}>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>{tr("Total paid:")}{' '}</span>
          <strong>{money(totalPaidCents)}</strong>
        </div>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>{tr("Outstanding:")}{' '}</span>
          <strong style={{ color: outstandingCents > 0 ? '#f5a623' : 'inherit' }}>{money(outstandingCents)}</strong>
        </div>
        {pendingRequests.length > 0 && (
          <div>
            <span className="badge badge-pending">
              {pendingRequests.length} {tr("recharge request")}{pendingRequests.length === 1 ? '' : 's'} {tr("pending")}
            </span>
          </div>
        )}
      </div>

      {creating && (
        <form onSubmit={handleCreate} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--card-border)' }}>
          <label>{tr("Invoice number (optional — auto-generated if left blank)")}</label>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder={tr("e.g. INV-2026-014")}
          />
          <label>{tr("Amount (USD)")}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500.00"
          />
          <label>{tr("Issue date")}</label>
          <input
            type="date"
            value={issuedAtInput}
            onChange={(e) => setIssuedAtInput(e.target.value)}
          />
          <label>{tr("Description")}</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tr("e.g. August 2026 ad spend + management fee")}
          />
          <label>{tr("Payment link (optional — e.g. a Stripe Payment Link you created)")}</label>
          <input
            type="url"
            value={paymentLink}
            onChange={(e) => setPaymentLink(e.target.value)}
            placeholder={tr("https://buy.stripe.com/...")}
          />
          <button className="btn" type="submit" disabled={saving}>
            {saving ? tr("Creating…") : tr("Create invoice (unpaid)")}
          </button>
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
                <th style={{ padding: '8px 6px' }}>{tr("Description")}</th>
                <th style={{ padding: '8px 6px' }}>{tr("Status")}</th>
                <th style={{ padding: '8px 6px' }}>{tr("Issued")}</th>
                <th style={{ padding: '8px 6px' }}>{tr("Paid")}</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>{tr("Amount")}</th>
                <th style={{ padding: '8px 6px' }}></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const rowOpen = openRowId === inv.id;
                return (
                  <>
                    <tr key={inv.id} style={{ borderBottom: rowOpen ? 'none' : '1px solid var(--card-border)' }}>
                      <td style={{ padding: '8px 6px' }}>
                        <code>{inv.invoiceNumber}</code>
                        {inv.source === 'RECHARGE_REQUEST' && (
                          <span
                            className="badge badge-pending"
                            style={{ marginLeft: 6, fontSize: '0.65rem', verticalAlign: 'middle' }}
                            title={
                              inv.requestedByUserId && requesterNames[inv.requestedByUserId]
                                ? `Requested by ${requesterNames[inv.requestedByUserId]}`
                                : 'Requested by staff'
                            }
                          >
                            {tr("requested")}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-dim)' }}>{inv.description ?? '—'}</td>
                      <td style={{ padding: '8px 6px' }}>
                        <span className={`badge ${badgeClass[inv.status] ?? 'badge-draft'}`}>{inv.status}</span>
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-dim)' }}>
                        {new Date(inv.issuedAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-dim)' }}>
                        {inv.paidAt ? (
                          <>
                            {new Date(inv.paidAt).toLocaleDateString()}
                            {inv.paymentMethod && <div style={{ fontSize: '0.75rem' }}>{tr("via")}{' '}{inv.paymentMethod}</div>}
                          </>
                        ) : (
                          '—'
                        )}
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
                            style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6, display: 'inline-block' }}
                          >
                            {tr("Pay online ↗")}
                          </a>
                        )}
                        {!rowOpen && (
                          <>
                            {inv.status === 'UNPAID' && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6 }}
                                onClick={() => openMarkPaid(inv)}
                                disabled={busyId === inv.id}
                              >
                                {tr("Mark paid")}
                              </button>
                            )}
                            {inv.status === 'PAID' && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6 }}
                                onClick={() => handleUnmarkPaid(inv.id)}
                                disabled={busyId === inv.id}
                              >
                                {tr("Unmark paid")}
                              </button>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6 }}
                              onClick={() => openEdit(inv)}
                              disabled={busyId === inv.id}
                            >
                              {tr("Edit")}
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                              onClick={() => handleDelete(inv.id, inv.invoiceNumber, inv.status)}
                              disabled={busyId === inv.id}
                            >
                              {tr("Delete")}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {rowOpen && openRowMode === 'markPaid' && (
                      <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td colSpan={7} style={{ padding: '4px 6px 12px' }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Date of payment")}</label>
                              <input
                                type="date"
                                value={paidAtInput}
                                onChange={(e) => setPaidAtInput(e.target.value)}
                                style={{ margin: 0 }}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Payment method")}</label>
                              <input
                                value={paymentMethodInput}
                                onChange={(e) => setPaymentMethodInput(e.target.value)}
                                placeholder={tr("e.g. Bank transfer, Cash, Wire")}
                                style={{ margin: 0 }}
                              />
                            </div>
                            <button
                              className="btn"
                              style={{ fontSize: '0.75rem', padding: '7px 12px' }}
                              onClick={() => handleConfirmMarkPaid(inv.id)}
                              disabled={busyId === inv.id}
                            >
                              {busyId === inv.id ? tr("Saving…") : tr("Confirm paid")}
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '7px 12px' }}
                              onClick={closeRow}
                              disabled={busyId === inv.id}
                            >
                              {tr("Cancel")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {rowOpen && openRowMode === 'edit' && (
                      <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td colSpan={7} style={{ padding: '4px 6px 12px' }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Invoice number")}</label>
                              <input
                                value={editInvoiceNumber}
                                onChange={(e) => setEditInvoiceNumber(e.target.value)}
                                style={{ margin: 0 }}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Amount (USD)")}</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editAmount}
                                onChange={(e) => setEditAmount(e.target.value)}
                                style={{ margin: 0, width: 110 }}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Issue date")}</label>
                              <input
                                type="date"
                                value={editIssuedAt}
                                onChange={(e) => setEditIssuedAt(e.target.value)}
                                style={{ margin: 0 }}
                              />
                            </div>
                            <div style={{ flex: '1 1 200px' }}>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Description")}</label>
                              <input
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                style={{ margin: 0, width: '100%' }}
                              />
                            </div>
                            <div style={{ flex: '1 1 220px' }}>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Payment link")}</label>
                              <input
                                type="url"
                                value={editPaymentLink}
                                onChange={(e) => setEditPaymentLink(e.target.value)}
                                placeholder={tr("https://buy.stripe.com/...")}
                                style={{ margin: 0, width: '100%' }}
                              />
                            </div>
                            {inv.status === 'PAID' && (
                              <>
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Date of payment")}</label>
                                  <input
                                    type="date"
                                    value={paidAtInput}
                                    onChange={(e) => setPaidAtInput(e.target.value)}
                                    style={{ margin: 0 }}
                                  />
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>{tr("Payment method")}</label>
                                  <input
                                    value={paymentMethodInput}
                                    onChange={(e) => setPaymentMethodInput(e.target.value)}
                                    placeholder={tr("e.g. Bank transfer, Cash, Wire")}
                                    style={{ margin: 0 }}
                                  />
                                </div>
                              </>
                            )}
                            <button
                              className="btn"
                              style={{ fontSize: '0.75rem', padding: '7px 12px' }}
                              onClick={() => handleConfirmEdit(inv)}
                              disabled={busyId === inv.id}
                            >
                              {busyId === inv.id ? tr("Saving…") : tr("Save changes")}
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '7px 12px' }}
                              onClick={closeRow}
                              disabled={busyId === inv.id}
                            >
                              {tr("Cancel")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
