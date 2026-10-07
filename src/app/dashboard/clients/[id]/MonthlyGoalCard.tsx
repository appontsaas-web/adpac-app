'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState, useEffect, useCallback } from 'react';

interface Goal {
  metricType: string | null;
  targetValue: number | null;
  note: string | null;
  setByUser: { name: string | null; email: string } | null;
  updatedAt: string;
}

const METRIC_OPTIONS = [
  { value: '', label: 'No metric target — note only' },
  { value: 'SPEND', label: 'Spend ($)' },
  { value: 'CONVERSIONS', label: 'Conversions (count)' },
  { value: 'CPA', label: 'CPA — cost per conversion ($)' },
  { value: 'ROAS', label: 'ROAS (ratio, e.g. 4 for 4x)' },
  { value: 'LEADS', label: 'Leads (count)' },
];

function currentMonthLabel(): string {
  return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Lets any staff member with reporting access state what this client's goal
// is for the CURRENT calendar month — read by the AI insight engines
// (lib/aiInsights.ts / lib/metaInsights.ts / lib/businessInsights.ts) so
// optimization recommendations target the stated goal instead of just
// generic pacing/anomaly signals. See ClientMonthlyGoal's schema comment for
// why this is monthly and overwritten rather than versioned.
export default function MonthlyGoalCard({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [metricType, setMetricType] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/monthly-goal`);
      if (res.ok) {
        const d = await res.json();
        setGoal(d.goal);
      }
    } catch {
      // silently leave goal null — this card is informational, not critical path
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit() {
    setMetricType(goal?.metricType ?? '');
    setTargetValue(goal?.targetValue?.toString() ?? '');
    setNote(goal?.note ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!metricType && !note.trim()) {
      setError(tr("Set either a metric target or a note."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/monthly-goal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metricType: metricType || null,
          targetValue: metricType ? targetValue : null,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to save goal"));
        return;
      }
      setEditing(false);
      await load();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to save goal — network error"));
    } finally {
      setSaving(false);
    }
  }

  const metricLabel = METRIC_OPTIONS.find((m) => m.value === goal?.metricType)?.label;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: editing ? 12 : 4 }}>
        <h2 style={{ fontSize: '1.05rem' }}>{tr("Goal for")}{' '}{currentMonthLabel()}</h2>
        {!editing && (
          <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={openEdit}>
            {goal ? tr("Edit goal") : tr("Set goal")}
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{tr("Loading…")}</p>
      ) : editing ? (
        <div>
          <label style={{ fontSize: '0.8rem' }}>{tr("Metric target")}</label>
          <select value={metricType} onChange={(e) => setMetricType(e.target.value)} style={{ marginBottom: 8 }}>
            {METRIC_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {metricType && (
            <input
              type="number"
              step="any"
              placeholder={tr("Target value")}
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              style={{ marginBottom: 8 }}
            />
          )}
          <label style={{ fontSize: '0.8rem' }}>{tr("Note (optional context, e.g. \"Focus on lead volume this month\")")}</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ marginBottom: 8 }} />
          {error && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginBottom: 8 }}>{error}</p>}
          <button className="btn" style={{ fontSize: '0.8rem', padding: '6px 14px', marginRight: 6 }} onClick={handleSave} disabled={saving}>
            {saving ? tr("Saving…") : tr("Save goal")}
          </button>
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 14px' }} onClick={() => setEditing(false)} disabled={saving}>
            {tr("Cancel")}
          </button>
        </div>
      ) : goal ? (
        <div>
          {metricLabel && goal.targetValue !== null && (
            <p style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>
              {tr("Target:")}{' '}{metricLabel} — {goal.targetValue.toLocaleString()}
            </p>
          )}
          {goal.note && <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: 4 }}>{goal.note}</p>}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            {tr("Set by")}{' '}{goal.setByUser?.name ?? goal.setByUser?.email ?? tr("a team member")} {tr("· used to steer this month's AI optimization recommendations")}
          </p>
        </div>
      ) : (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          {tr("No goal set for this month yet. Setting one helps the AI optimization engine target the same thing you are.")}
        </p>
      )}
    </div>
  );
}
