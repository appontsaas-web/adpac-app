'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface MetaInsightRow {
  id: string;
  metaCampaignId: string | null;
  actionType: string;
  payloadJson: string;
  status: string;
  createdAt: string | Date;
  errorMessage: string | null;
}

const badgeClass: Record<string, string> = {
  PENDING_APPROVAL: 'badge-pending',
  EXECUTED: 'badge-live',
  FAILED: 'badge-failed',
  REJECTED: 'badge-failed',
};

const typeLabel: Record<string, string> = {
  META_ADJUST_BUDGET: 'Adjust budget',
  META_PAUSE_CAMPAIGN: 'Pause campaign',
  META_ANOMALY_ALERT: 'Anomaly alert',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// The Meta counterpart to AIInsightsPanel/BusinessInsightsPanel — same run/
// approve/dismiss shape, budget-adjust and pause proposals for Meta
// campaigns instead of Google Ads ones. Approving META_ADJUST_BUDGET or
// META_PAUSE_CAMPAIGN is the one place this actually calls the Meta API
// (see /api/meta-insights/[id]/approve); approving META_ANOMALY_ALERT just
// acknowledges it.
export default function MetaInsightsPanel({
  clientId,
  campaignNames,
  insights,
}: {
  clientId: string;
  campaignNames: Record<string, string>;
  insights: MetaInsightRow[];
}) {
  const { tr } = useI18n();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setRunMessage(null);
    try {
      const res = await fetch('/api/meta-insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to run AI review"));
        return;
      }
      setRunMessage(
        d.created > 0
          ? `Found ${d.created} new insight${d.created === 1 ? '' : 's'}.`
          : 'No new insights — nothing stood out this time.'
      );
      if (d.errors?.length) setError(d.errors.join('; '));
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to run AI review — network error"));
    } finally {
      setRunning(false);
    }
  }

  async function handleApprove(id: string, actionType: string) {
    const confirmText =
      actionType === 'META_PAUSE_CAMPAIGN'
        ? 'Pause this campaign on Meta? It will stop spending immediately.'
        : actionType === 'META_ADJUST_BUDGET'
          ? "Apply this budget change on Meta?"
          : 'Acknowledge this alert?';
    if (!confirm(confirmText)) return;
    setProcessingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/meta-insights/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to approve insight"));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to approve insight — network error"));
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDismiss(id: string) {
    setProcessingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/meta-insights/${id}/dismiss`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to dismiss insight"));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to dismiss insight — network error"));
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr("AI review — Meta campaigns")}</h2>
        <button className="btn btn-secondary" onClick={handleRun} disabled={running}>
          {running ? tr("Reviewing…") : tr("Run AI review")}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        {tr("Flags Meta campaigns worth a budget change, a pause, or a heads-up — nothing changes on Meta until you approve one below.")}
      </p>

      {runMessage && <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginBottom: 10 }}>{runMessage}</p>}
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {insights.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>{tr("No insights yet. Click \"Run AI review\" to check.")}</p>
      ) : (
        insights.map((ins) => {
          const payload = JSON.parse(ins.payloadJson);
          return (
            <div key={ins.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span className={`badge ${badgeClass[ins.status] ?? 'badge-draft'}`}>{ins.status}</span>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>{typeLabel[ins.actionType] ?? ins.actionType}</span>{' '}
                  {ins.metaCampaignId && <strong>{campaignNames[ins.metaCampaignId] ?? ins.metaCampaignId}</strong>}
                </div>
                {ins.status === 'PENDING_APPROVAL' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleApprove(ins.id, ins.actionType)}
                      disabled={processingId === ins.id}
                    >
                      {processingId === ins.id
                        ? tr("Working…")
                        : ins.actionType === 'META_ANOMALY_ALERT'
                          ? tr("Acknowledge")
                          : tr("Approve")}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleDismiss(ins.id)}
                      disabled={processingId === ins.id}
                    >
                      {tr("Dismiss")}
                    </button>
                  </div>
                )}
              </div>
              <p style={{ fontSize: '0.88rem', marginTop: 6, marginBottom: 4 }}>{payload.summary}</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 8 }}>{payload.rationale}</p>
              {ins.actionType === 'META_ADJUST_BUDGET' && payload.proposedDailyBudgetCents != null && (
                <p style={{ fontSize: '0.85rem', background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px' }}>
                  <strong>{tr("Proposed daily budget:")}</strong> {formatCents(payload.proposedDailyBudgetCents)}
                </p>
              )}
              {ins.errorMessage && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{ins.errorMessage}</p>}
            </div>
          );
        })
      )}
    </div>
  );
}
