'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    website: '',
    industry: '',
    monthlyBudget: '',
    primaryGoal: 'Generate leads',
    adLanguage: 'English',
    targetLocations: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `Failed to create client (${res.status})`);
        return;
      }
      setOpen(false);
      setForm({
        name: '',
        website: '',
        industry: '',
        monthlyBudget: '',
        primaryGoal: 'Generate leads',
        adLanguage: 'English',
        targetLocations: '',
      });
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create client — network error');
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} style={{ marginBottom: 20 }}>
        + Add client
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <label>Business name*</label>
      <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label>Website</label>
      <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      <label>Industry</label>
      <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
      <label>Monthly budget (USD)</label>
      <input
        type="number"
        min="0"
        value={form.monthlyBudget}
        onChange={(e) => setForm({ ...form, monthlyBudget: e.target.value })}
      />
      <label>Primary goal</label>
      <select value={form.primaryGoal} onChange={(e) => setForm({ ...form, primaryGoal: e.target.value })}>
        <option>Generate leads</option>
        <option>Drive sales / revenue</option>
        <option>Brand awareness</option>
        <option>Website traffic</option>
      </select>
      <label>Ad language</label>
      <input
        value={form.adLanguage}
        onChange={(e) => setForm({ ...form, adLanguage: e.target.value })}
        placeholder="English"
      />
      <label>Target locations</label>
      <input
        value={form.targetLocations}
        onChange={(e) => setForm({ ...form, targetLocations: e.target.value })}
        placeholder="e.g. Lebanon, UAE, Saudi Arabia"
      />
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save client'}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
