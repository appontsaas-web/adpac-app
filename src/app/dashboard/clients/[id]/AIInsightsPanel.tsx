'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Insight {
  id: string;
  campaignId: string | null;
  actionType: string;
  payloadJson: string;
  status: string;
  createdAt: string | Date;
  executedAt: string | Date | null;
  errorMessage: string | null;
}

interface Outcome {
  daysSinceExecuted: number;
  hasData: boolean;
  avgDailyCostCents: number;
  avgDailyConversions: number;
  ctr: number;
}

const badgeClass: Record<string, string> = {
  PENDING_APPROVAL: 'badge-pending',
  EXECUTED: 'badge-live',
  FAILED: 'badge-failed',
  REJECTED: 'badge-failed',
};

const typeLabel: Record<string, string> = {
  ADJUST_BUDGET: 'Budget change',
  PAUSE_CAMPAIGN: 'Pause campaign',
  REWRITE_AD_COPY: 'Ad copy rewrite',
  ANOMALY_ALERT: 'Anomaly alert',
  ADD_NEGATIVE_KEYWORDS: 'Add negative keywords',
  REALLOCATE_BUDGET: 'Reallocate budget',
  ADJUST_BID_MODIFIER: 'Bid adjustment',
  FUNNEL_OPTIMIZATION: 'Funnel optimization',
};

function pct(n: number | null) {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact before/after bar for one metric — width is proportional to value
// (capped so an extreme spike/drop doesn't blow out the layout), so you can
// see the shift in the underlying data at a glance rather than reading two
// numbers and doing the comparison in your head.
function TrendBar({
  label,
  prior,
  current,
  format,
  priorLabel = 'prior 14d',
  currentLabel = 'last 7d',
}: {
  label: string;
  prior: number;
  current: number;
  format: (n: number) => string;
  priorLabel?: string;
  currentLabel?: string;
}) {
  const max = Math.max(prior, current, 0.0001);
  const priorPct = Math.min(100, (prior / max) * 100);
  const currentPct = Math.min(100, (current / max) * 100);
  const pctChange = prior > 0 ? ((current - prior) / prior) * 100 : current > 0 ? 100 : 0;
  const changeColor = pctChange > 0 ? 'var(--accent2)' : pctChange < 0 ? '#ef4444' : 'var(--text-dim)';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: changeColor }}>
          {pctChange > 0 ? '+' : ''}
          {pctChange.toFixed(0)}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', width: 78, flexShrink: 0 }}>{priorLabel}</span>
        <div style={{ flex: 1, background: 'var(--bg-alt)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${priorPct}%`, background: 'var(--text-dim)', height: '100%' }} />
        </div>
        <span style={{ fontSize: '0.7rem', width: 64, textAlign: 'right', flexShrink: 0 }}>{format(prior)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', width: 78, flexShrink: 0 }}>{currentLabel}</span>
        <div style={{ flex: 1, background: 'var(--bg-alt)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${currentPct}%`, background: 'var(--accent-grad, #6d5efc)', height: '100%' }} />
        </div>
        <span style={{ fontSize: '0.7rem', width: 64, textAlign: 'right', flexShrink: 0 }}>{format(current)}</span>
      </div>
    </div>
  );
}

// Runs the AI performance review (deterministic pacing/anomaly signals +
// Claude synthesis, see lib/aiInsights.ts) and lists what it's proposed.
// Approving is the one place this actually touches Google Ads — everything
// before that is just analysis and a written recommendation.
export default function AIInsightsPanel({
  clientId,
  campaignNames,
  insights,
  outcomes,
}: {
  clientId: string;
  campaignNames: Record<string, string>;
  insights: Insight[];
  outcomes: Record<string, Outcome>;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [runningFunnel, setRunningFunnel] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setRunMessage(null);
    try {
      const res = await fetch('/api/ai-insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Failed to run AI review');
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
      setError(err.message ?? 'Failed to run AI review — network error');
    } finally {
      setRunning(false);
    }
  }

  async function handleRunFunnel() {
    setRunningFunnel(true);
    setError(null);
    setRunMessage(null);
    try {
      const res = await fetch('/api/funnel-insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Failed to run funnel review');
        return;
      }
      setRunMessage(
        d.created > 0
          ? 'Found a funnel finding worth a look.'
          : 'No funnel finding — either nothing stood out, GA4 isn’t connected, or there isn’t enough click volume yet.'
      );
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to run funnel review — network error');
    } finally {
      setRunningFunnel(false);
    }
  }

  async function handleApprove(id: string) {
    if (!confirm('Approve this insight? It will make a real change on Google Ads immediately.')) return;
    setProcessingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/ai-insights/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to approve insight');
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to approve insight — network error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDismiss(id: string) {
    setProcessingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/ai-insights/${id}/dismiss`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to dismiss insight');
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to dismiss insight — network error');
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>AI performance review</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleRun} disabled={running}>
            {running ? 'Reviewing…' : 'Run AI review'}
          </button>
          <button className="btn btn-secondary" onClick={handleRunFunnel} disabled={runningFunnel}>
            {runningFunnel ? 'Reviewing…' : 'Run funnel review'}
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Compares the last 7 days against the prior 14 for every live campaign, factors in budget pacing,
        wasted search-term spend, site-wide GA4 signals (when connected), and what's already been approved
        or rejected before — nothing happens on Google Ads until you approve one below.
      </p>

      {runMessage && <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginBottom: 10 }}>{runMessage}</p>}
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {insights.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>No insights yet. Click "Run AI review" to check.</p>
      ) : (
        insights.map((ins) => {
          const payload = JSON.parse(ins.payloadJson);
          return (
            <div key={ins.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span className={`badge ${badgeClass[ins.status] ?? 'badge-draft'}`}>{ins.status}</span>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>{typeLabel[ins.actionType] ?? ins.actionType}</span>{' '}
                  {ins.campaignId && <strong>{campaignNames[ins.campaignId] ?? ins.campaignId}</strong>}
                </div>
                {ins.status === 'PENDING_APPROVAL' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleApprove(ins.id)}
                      disabled={processingId === ins.id}
                    >
                      {processingId === ins.id
                        ? 'Working…'
                        : payload.type === 'ANOMALY_ALERT' || payload.type === 'FUNNEL_OPTIMIZATION'
                        ? 'Acknowledge'
                        : 'Approve'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleDismiss(ins.id)}
                      disabled={processingId === ins.id}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
              <p style={{ fontSize: '0.88rem', marginTop: 6, marginBottom: 4 }}>{payload.summary}</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 8 }}>
                {payload.rationale}
              </p>
              {payload.signalSnapshot && (
                <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, maxWidth: 340 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    Data this was based on
                  </div>
                  <TrendBar
                    label="Avg. daily spend"
                    prior={payload.signalSnapshot.prior14dAvgDailyCostCents}
                    current={payload.signalSnapshot.last7dAvgDailyCostCents}
                    format={(n) => money(n)}
                  />
                  <TrendBar
                    label="Avg. daily conversions"
                    prior={payload.signalSnapshot.prior14dAvgDailyConversions}
                    current={payload.signalSnapshot.last7dAvgDailyConversions}
                    format={(n) => n.toFixed(2)}
                  />
                  <TrendBar
                    label="CTR"
                    prior={payload.signalSnapshot.prior14dCtr * 100}
                    current={payload.signalSnapshot.last7dCtr * 100}
                    format={(n) => `${n.toFixed(2)}%`}
                  />
                </div>
              )}
              {ins.status === 'EXECUTED' && (() => {
                const outcome = outcomes[ins.id];
                if (!outcome) return null;
                if (!outcome.hasData) {
                  return (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 8 }}>
                      Monitoring — no performance data has synced in yet since this was approved. Click "Sync
                      now" on Performance in a day or two to start seeing results here.
                    </p>
                  );
                }
                return (
                  <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, maxWidth: 340 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      Outcome — {outcome.daysSinceExecuted} day{outcome.daysSinceExecuted === 1 ? '' : 's'} since approved
                    </div>
                    <TrendBar
                      label="Avg. daily spend"
                      prior={payload.signalSnapshot?.last7dAvgDailyCostCents ?? 0}
                      current={outcome.avgDailyCostCents}
                      format={(n) => money(n)}
                      priorLabel="before"
                      currentLabel="since"
                    />
                    <TrendBar
                      label="Avg. daily conversions"
                      prior={payload.signalSnapshot?.last7dAvgDailyConversions ?? 0}
                      current={outcome.avgDailyConversions}
                      format={(n) => n.toFixed(2)}
                      priorLabel="before"
                      currentLabel="since"
                    />
                    <TrendBar
                      label="CTR"
                      prior={(payload.signalSnapshot?.last7dCtr ?? 0) * 100}
                      current={outcome.ctr * 100}
                      format={(n) => `${n.toFixed(2)}%`}
                      priorLabel="before"
                      currentLabel="since"
                    />
                  </div>
                );
              })()}
              {payload.type === 'ADJUST_BUDGET' && payload.proposedDailyBudgetCents && (
                <p style={{ fontSize: '0.8rem', marginTop: 4 }}>
                  Proposed daily budget: <strong>{money(payload.proposedDailyBudgetCents)}</strong>
                </p>
              )}
              {payload.type === 'REWRITE_AD_COPY' && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  <div>
                    <strong style={{ color: 'var(--text)' }}>New headlines:</strong> {payload.proposedHeadlines?.join(' · ')}
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text)' }}>New descriptions:</strong> {payload.proposedDescriptions?.join(' · ')}
                  </div>
                </div>
              )}
              {payload.type === 'REALLOCATE_BUDGET' && payload.reallocateAmountCents && (
                <p style={{ fontSize: '0.8rem', marginTop: 4 }}>
                  Move <strong>{money(payload.reallocateAmountCents)}/day</strong> from{' '}
                  <strong>{campaignNames[payload.reallocateFromCampaignId] ?? payload.reallocateFromCampaignId}</strong> to{' '}
                  <strong>{campaignNames[payload.campaignId] ?? payload.campaignId}</strong>
                </p>
              )}
              {payload.type === 'ADJUST_BID_MODIFIER' && payload.proposedBidModifier !== undefined && (
                <p style={{ fontSize: '0.8rem', marginTop: 4 }}>
                  {payload.bidModifierCriterionType === 'DEVICE' ? 'Device' : 'Hour'}{' '}
                  <strong>{payload.bidModifierValue}</strong>: bid multiplier{' '}
                  <strong>{payload.proposedBidModifier === 0 ? 'opt out (0x)' : `${payload.proposedBidModifier}x`}</strong>
                </p>
              )}
              {payload.type === 'FUNNEL_OPTIMIZATION' && payload.stageRates && (
                <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, maxWidth: 380 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    Funnel — last 30 days
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-dim)' }}>Clicks → Sessions</span>
                    <span>
                      {payload.stageRates.clicks.toLocaleString()} → {payload.stageRates.sessions.toLocaleString()} (
                      {pct(payload.stageRates.clickToSessionRate)})
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-dim)' }}>Sessions → Engaged</span>
                    <span>
                      {payload.stageRates.sessions.toLocaleString()} → {payload.stageRates.engagedSessions.toLocaleString()} (
                      {pct(payload.stageRates.sessionToEngagedRate)})
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-dim)' }}>Engaged → Conversions</span>
                    <span>
                      {payload.stageRates.engagedSessions.toLocaleString()} → {payload.stageRates.conversions.toLocaleString()} (
                      {pct(payload.stageRates.engagedToConversionRate)})
                    </span>
                  </div>
                  {payload.recommendation && (
                    <p style={{ fontSize: '0.8rem', margin: 0 }}>
                      <strong style={{ color: 'var(--text)' }}>Recommendation:</strong> {payload.recommendation}
                    </p>
                  )}
                </div>
              )}
              {payload.type === 'ADD_NEGATIVE_KEYWORDS' && payload.proposedNegativeKeywords?.length > 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  <strong style={{ color: 'var(--text)' }}>Negative keywords to add:</strong>{' '}
                  {payload.proposedNegativeKeywords.join(' · ')}
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
