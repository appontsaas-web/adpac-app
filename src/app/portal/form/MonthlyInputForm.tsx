'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ExistingInput {
  goalText: string;
  targetAudienceText: string;
  budgetNotes: string | null;
  competitorNotes: string | null;
  additionalNotes: string | null;
}

export default function MonthlyInputForm({ existing }: { existing: ExistingInput | null }) {
  const { tr } = useI18n();
  const router = useRouter();
  const [goalText, setGoalText] = useState(existing?.goalText ?? '');
  const [targetAudienceText, setTargetAudienceText] = useState(existing?.targetAudienceText ?? '');
  const [budgetNotes, setBudgetNotes] = useState(existing?.budgetNotes ?? '');
  const [competitorNotes, setCompetitorNotes] = useState(existing?.competitorNotes ?? '');
  const [additionalNotes, setAdditionalNotes] = useState(existing?.additionalNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/monthly-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalText, targetAudienceText, budgetNotes, competitorNotes, additionalNotes }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to submit"));
        return;
      }
      router.push('/portal');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Network error — please try again"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <label>{tr("What are you trying to achieve this month? *")}</label>
      <textarea
        value={goalText}
        onChange={(e) => setGoalText(e.target.value)}
        required
        rows={3}
        placeholder={tr("e.g. We want to push demo signups from mid-market companies before our Q4 renewal push")}
      />
      <label>{tr("Who are you trying to reach? *")}</label>
      <textarea
        value={targetAudienceText}
        onChange={(e) => setTargetAudienceText(e.target.value)}
        required
        rows={3}
        placeholder={tr("e.g. IT managers at 100-500 person companies, mostly US/Canada, who are frustrated with their current vendor")}
      />
      <label>{tr("Anything about budget we should know? (optional)")}</label>
      <textarea value={budgetNotes} onChange={(e) => setBudgetNotes(e.target.value)} rows={2} />
      <label>{tr("Competitors or positioning notes? (optional)")}</label>
      <textarea value={competitorNotes} onChange={(e) => setCompetitorNotes(e.target.value)} rows={2} />
      <label>{tr("Anything else? (optional)")}</label>
      <textarea value={additionalNotes} onChange={(e) => setAdditionalNotes(e.target.value)} rows={2} />

      {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
      <button className="btn" type="submit" disabled={saving} style={{ width: '100%', marginTop: 12 }}>
        {saving ? tr("Submitting…") : tr("Submit")}
      </button>
    </form>
  );
}
