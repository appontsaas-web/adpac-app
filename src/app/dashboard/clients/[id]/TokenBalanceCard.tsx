'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState, useEffect, useCallback } from 'react';

interface TokenTx {
  id: string;
  type: string; // TOPUP | REVERSAL | ADJUSTMENT
  tokens: number;
  note: string | null;
  createdAt: string;
}

interface TokensResponse {
  balance: number;
  tokensPerDollar: number | null; // null for non-admins — the API omits it, it's pricing detail
  transactions: TokenTx[];
}

function fmtTokens(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Prepaid token balance, driven entirely by invoices being marked
// PAID/UNPAID (see PATCH /api/invoices/[id]) — this card just displays the
// resulting balance + ledger and, for admins, the conversion rate. Fetches
// its own data so it can be dropped into either the admin FinanceSection or
// the read-only InvoicesViewOnly without the parent needing to load it.
export default function TokenBalanceCard({ clientId, isAdmin }: { clientId: string; isAdmin?: boolean }) {
  const { tr } = useI18n();
  const [data, setData] = useState<TokensResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tokens`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to load token balance (${res.status})`);
        return;
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message ?? tr("Failed to load token balance — network error"));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEditRate() {
    setRateInput(String(data?.tokensPerDollar ?? 1));
    setEditingRate(true);
    setError(null);
  }

  async function saveRate() {
    const rate = Number(rateInput);
    if (!Number.isFinite(rate) || rate < 0) {
      setError(tr("Enter a valid rate of 0 or more."));
      return;
    }
    setSavingRate(true);
    setError(null);
    try {
      const res = await fetch('/api/token-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokensPerDollar: rate }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to save rate"));
        return;
      }
      setEditingRate(false);
      await load();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to save rate — network error"));
    } finally {
      setSavingRate(false);
    }
  }

  // Several ledger inputs are deliberately NOT retroactive when you edit
  // them elsewhere — the global rate above only prices invoices marked paid
  // afterward, and an AI-impact override only affects days not yet synced.
  // This is the explicit "catch it up" action: reprices every PAID
  // invoice's top-up at the current rate and re-locks the whole daily spend
  // history against whatever override rates are on file now. See
  // recomputeClientTokens in lib/tokens.ts.
  async function recompute() {
    setRecomputing(true);
    setRecomputeMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tokens/recompute`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to refresh (${res.status})`);
        return;
      }
      const result = await res.json();
      setRecomputeMsg(
        `Reconciled ${result.invoicesReconciled} invoice${result.invoicesReconciled === 1 ? '' : 's'}, relocked ${result.daysRelocked} day${result.daysRelocked === 1 ? '' : 's'} of spend.`
      );
      await load();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to refresh — network error"));
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
            {tr("Token balance")}
            {isAdmin && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.68rem', padding: '2px 7px' }}
                onClick={recompute}
                disabled={recomputing}
                title={tr("Reprice invoices at the current rate and re-lock daily spend against current AI-impact rates — use after editing the rate, an override, or an invoice")}
              >
                {recomputing ? tr("Refreshing…") : tr("↻ Refresh")}
              </button>
            )}
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent2)' }}>
            {loading && !data ? '…' : fmtTokens(data?.balance ?? 0)}
          </div>
          {recomputeMsg && <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>{recomputeMsg}</div>}
        </div>

        {/* The $-per-token rate is pricing/margin detail — admin-only. Staff
            see the balance and history above, not the rate that produced
            it (the API omits tokensPerDollar for them too, see
            /api/clients/[id]/tokens). */}
        {isAdmin && (
          <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            {editingRate ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>{tr("tokens / $")}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  style={{ margin: 0, width: 70 }}
                  autoFocus
                />
                <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={saveRate} disabled={savingRate}>
                  {savingRate ? '…' : tr("Save")}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                  onClick={() => setEditingRate(false)}
                  disabled={savingRate}
                >
                  {tr("Cancel")}
                </button>
              </div>
            ) : (
              <>
                {data && data.tokensPerDollar !== null
                  ? `${data.tokensPerDollar} token${data.tokensPerDollar === 1 ? '' : 's'} per $1 paid`
                  : ''}
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '3px 8px', marginLeft: 8 }}
                  onClick={startEditRate}
                >
                  {tr("Edit rate")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 8 }}>{error}</p>}

      {data && data.transactions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            onClick={() => setShowLedger(!showLedger)}
          >
            {showLedger ? tr("Hide") : tr("Show")} {tr("history (")}{data.transactions.length})
          </button>
          {showLedger && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '6px' }}>{tr("Date")}</th>
                    <th style={{ padding: '6px' }}>{tr("Type")}</th>
                    <th style={{ padding: '6px' }}>{tr("Note")}</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>{tr("Tokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((tx) => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                      <td style={{ padding: '6px', color: 'var(--text-dim)' }}>{new Date(tx.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: '6px' }}>{tx.type}</td>
                      <td style={{ padding: '6px', color: 'var(--text-dim)' }}>{tx.note ?? '—'}</td>
                      <td style={{ padding: '6px', textAlign: 'right', color: tx.tokens >= 0 ? 'var(--accent2)' : '#ef4444' }}>
                        {tx.tokens >= 0 ? '+' : ''}
                        {fmtTokens(tx.tokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
