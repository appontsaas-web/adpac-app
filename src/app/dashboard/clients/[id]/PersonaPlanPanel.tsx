'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useEffect, useState } from 'react';

interface Persona {
  name: string;
  summary: string;
  demographicBasis: string;
  motivations: string[];
  painPoints: string[];
}

interface PersonaAdCopy {
  personaName: string;
  headlines: string[];
  descriptions: string[];
}

interface ProposedAction {
  campaignId: string;
  personaName: string;
  proposedHeadlines: string[];
  proposedDescriptions: string[];
  rationale: string;
}

interface Plan {
  id: string;
  periodType: string;
  periodLabel: string;
  status: string;
  personasJson: string;
  adCopyJson: string;
  planJson: string;
  clientFeedback: string | null;
  createdAt: string;
  sentToClientAt: string | null;
  respondedAt: string | null;
}

const statusLabel: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_CLIENT_APPROVAL: 'Sent — awaiting client',
  CLIENT_APPROVED: 'Approved by client',
  CLIENT_REJECTED: 'Client requested changes',
};

const statusBadge: Record<string, string> = {
  DRAFT: 'badge-draft',
  PENDING_CLIENT_APPROVAL: 'badge-pending',
  CLIENT_APPROVED: 'badge-live',
  CLIENT_REJECTED: 'badge-failed',
};

function defaultPeriodLabel(periodType: string) {
  const now = new Date();
  if (periodType === 'QUARTERLY') {
    const q = Math.floor(now.getUTCMonth() / 3) + 1;
    return `${now.getUTCFullYear()}-Q${q}`;
  }
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function PersonaPlanPanel({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodType, setPeriodType] = useState<'MONTHLY' | 'QUARTERLY'>('MONTHLY');
  const [periodLabel, setPeriodLabel] = useState(defaultPeriodLabel('MONTHLY'));

  async function loadPlans() {
    setLoading(true);
    try {
      const res = await fetch(`/api/marketing-plans?clientId=${clientId}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) setPlans(d.plans ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/marketing-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, periodType, periodLabel }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to generate plan"));
        return;
      }
      await loadPlans();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to generate plan — network error"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend(id: string) {
    if (!confirm('Send this plan to the client for approval? They’ll get an email with a sign-in link.')) return;
    setSendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/marketing-plans/${id}/send`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to send plan"));
        return;
      }
      await loadPlans();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to send plan — network error"));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>{tr("Persona building & audience study")}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 14 }}>
        {tr("Builds audience personas, ad copy, and a plan from the client's latest monthly input (submitted via their portal) plus real age/gender/location/device performance data from their connected accounts. The client reviews and approves it in their own portal before anything ships.")}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: '0.75rem' }}>{tr("Period")}</label>
          <select
            value={periodType}
            onChange={(e) => {
              const v = e.target.value as 'MONTHLY' | 'QUARTERLY';
              setPeriodType(v);
              setPeriodLabel(defaultPeriodLabel(v));
            }}
          >
            <option value="MONTHLY">{tr("Monthly")}</option>
            <option value="QUARTERLY">{tr("Quarterly")}</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.75rem' }}>{tr("Label")}</label>
          <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} style={{ width: 110 }} />
        </div>
        <button className="btn btn-secondary" onClick={handleGenerate} disabled={generating}>
          {generating ? tr("Generating…") : tr("Generate plan")}
        </button>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {loading ? (
        <p style={{ color: 'var(--text-dim)' }}>{tr("Loading…")}</p>
      ) : plans.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>
          {tr("No plans yet. Needs at least one monthly input submitted via the client's portal and some synced audience-demographic data.")}
        </p>
      ) : (
        plans.map((plan) => {
          const personas: Persona[] = JSON.parse(plan.personasJson);
          const adCopy: PersonaAdCopy[] = JSON.parse(plan.adCopyJson);
          const { objectives, narrative, proposedActions } = JSON.parse(plan.planJson) as {
            objectives: string;
            narrative: string;
            proposedActions: ProposedAction[];
          };
          return (
            <details key={plan.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '12px 0' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: '0.88rem' }}>
                  <span className={`badge ${statusBadge[plan.status] ?? 'badge-draft'}`}>{statusLabel[plan.status] ?? plan.status}</span>{' '}
                  <strong>{plan.periodType === 'QUARTERLY' ? tr("Quarterly") : tr("Monthly")} — {plan.periodLabel}</strong>
                </span>
                {plan.status === 'DRAFT' && (
                  <button
                    className="btn"
                    style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                    onClick={(e) => {
                      e.preventDefault();
                      handleSend(plan.id);
                    }}
                    disabled={sendingId === plan.id}
                  >
                    {sendingId === plan.id ? tr("Sending…") : tr("Send to client")}
                  </button>
                )}
              </summary>

              <div style={{ marginTop: 12, fontSize: '0.85rem' }}>
                <p style={{ marginBottom: 10 }}>
                  <strong>{tr("Objectives:")}</strong> {objectives}
                </p>
                <p style={{ color: 'var(--text-dim)', marginBottom: 14 }}>{narrative}</p>

                {plan.clientFeedback && (
                  <p style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}>
                    <strong>{tr("Client feedback:")}</strong> {plan.clientFeedback}
                  </p>
                )}

                {personas.map((p) => {
                  const copy = adCopy.find((c) => c.personaName === p.name);
                  return (
                    <div key={p.name} style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 6 }}>{p.summary}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: 6 }}>
                        <em>{p.demographicBasis}</em>
                      </div>
                      <div style={{ fontSize: '0.78rem', marginBottom: 4 }}>
                        <strong>{tr("Motivations:")}</strong> {p.motivations.join(' · ')}
                      </div>
                      <div style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                        <strong>{tr("Pain points:")}</strong> {p.painPoints.join(' · ')}
                      </div>
                      {copy && (
                        <div style={{ fontSize: '0.78rem' }}>
                          <div>
                            <strong>{tr("Headlines:")}</strong> {copy.headlines.join(' · ')}
                          </div>
                          <div>
                            <strong>{tr("Descriptions:")}</strong> {copy.descriptions.join(' · ')}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {proposedActions.length > 0 && (
                  <div style={{ fontSize: '0.8rem' }}>
                    <strong>{tr("Proposed campaign changes (once client approves):")}</strong>
                    <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                      {proposedActions.map((a, i) => (
                        <li key={i} style={{ marginBottom: 6 }}>
                          {tr("Rewrite ad copy for")}{' '}<strong>{a.campaignId}</strong> {tr("toward persona")}{' '}<strong>{a.personaName}</strong> —{' '}
                          {a.rationale}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          );
        })
      )}
    </div>
  );
}
