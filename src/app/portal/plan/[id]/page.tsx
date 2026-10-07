import { getTr } from '@/lib/i18n/server';
import { redirect } from 'next/navigation';
import { getCurrentPortalClient } from '@/lib/clientPortalAuth';
import { db } from '@/lib/db';
import PortalPlanActions from './PortalPlanActions';

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

export default async function PortalPlanPage({ params }: { params: { id: string } }) {
  const tr = getTr();
  const client = await getCurrentPortalClient();
  if (!client) redirect('/portal');

  const plan = await db.marketingPlan.findUnique({ where: { id: params.id } });
  if (!plan || plan.clientId !== client.id) redirect('/portal');

  const personas: Persona[] = JSON.parse(plan.personasJson);
  const adCopy: PersonaAdCopy[] = JSON.parse(plan.adCopyJson);
  const { objectives, narrative, proposedActions } = JSON.parse(plan.planJson) as {
    objectives: string;
    narrative: string;
    proposedActions: ProposedAction[];
  };

  const campaigns = await db.campaign.findMany({
    where: { id: { in: proposedActions.map((a) => a.campaignId) } },
    select: { id: true, name: true },
  });
  const campaignNames = Object.fromEntries(campaigns.map((c) => [c.id, c.name]));

  return (
    <div className="container" style={{ maxWidth: 720, paddingTop: 60, paddingBottom: 60 }}>
      <a href="/portal" style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
        {tr("← Back")}
      </a>
      <h1 style={{ fontSize: '1.4rem', margin: '10px 0 4px' }}>
        {plan.periodType === 'QUARTERLY' ? tr("Quarterly") : tr("Monthly")} {tr("plan —")}{' '}{plan.periodLabel}
      </h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 20 }}>
        {tr("Audience personas, ad copy, and recommended next steps, built from what you told us and your real campaign performance.")}
      </p>

      <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent, #6d5efc)' }}>
        <PortalPlanActions planId={plan.id} status={plan.status} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.05rem', marginBottom: 6 }}>{tr("Objectives")}</h2>
        <p style={{ fontSize: '0.9rem', marginBottom: 14 }}>{objectives}</p>
        <h2 style={{ fontSize: '1.05rem', marginBottom: 6 }}>{tr("Plan")}</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>{narrative}</p>
      </div>

      {personas.map((p) => {
        const copy = adCopy.find((c) => c.personaName === p.name);
        return (
          <details key={p.name} className="card" style={{ marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem' }}>{p.name}</span>
              <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: 2 }}>{p.summary}</span>
            </summary>
            <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: '0.88rem', marginBottom: 8 }}>{p.summary}</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 10 }}>
              <em>{p.demographicBasis}</em>
            </p>
            <p style={{ fontSize: '0.85rem', marginBottom: 4 }}>
              <strong>{tr("Motivations:")}</strong> {p.motivations.join(' · ')}
            </p>
            <p style={{ fontSize: '0.85rem', marginBottom: 10 }}>
              <strong>{tr("Pain points:")}</strong> {p.painPoints.join(' · ')}
            </p>
            {copy && (
              <div style={{ fontSize: '0.85rem', background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>{tr("Sample headlines:")}</strong> {copy.headlines.slice(0, 5).join(' · ')}
                </div>
                <div>
                  <strong>{tr("Sample descriptions:")}</strong> {copy.descriptions.join(' · ')}
                </div>
              </div>
            )}
            </div>
          </details>
        );
      })}

      {proposedActions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: '1.05rem', marginBottom: 10 }}>{tr("Recommended next steps")}</h2>
          <ul style={{ paddingLeft: 18, fontSize: '0.88rem' }}>
            {proposedActions.map((a, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                {tr("Update ad copy on")}{' '}<strong>{campaignNames[a.campaignId] ?? a.campaignId}</strong> {tr("toward the")}{' '}
                <strong>{a.personaName}</strong> {tr("persona —")}{' '}{a.rationale}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            {tr("Approving below doesn't change anything on your ad accounts immediately — it lets our team review and apply these changes.")}
          </p>
        </div>
      )}

    </div>
  );
}
