'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function NewClientForm() {
  const router = useRouter();
  const { t } = useI18n();
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
        setError(d.error ?? `${t('newClient.failed')} (${res.status})`);
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
      setError(err.message ?? t('newClient.networkFailed'));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} style={{ marginBottom: 20 }}>
        {t('newClient.add')}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <label>{t('newClient.businessName')}</label>
      <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label>{t('newClient.website')}</label>
      <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      <label>{t('newClient.industry')}</label>
      <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
      <label>{t('newClient.monthlyBudget')}</label>
      <input
        type="number"
        min="0"
        value={form.monthlyBudget}
        onChange={(e) => setForm({ ...form, monthlyBudget: e.target.value })}
      />
      <label>{t('newClient.primaryGoal')}</label>
      <select value={form.primaryGoal} onChange={(e) => setForm({ ...form, primaryGoal: e.target.value })}>
        <option value="Generate leads">{t('newClient.goalLeads')}</option>
        <option value="Drive sales / revenue">{t('newClient.goalSales')}</option>
        <option value="Brand awareness">{t('newClient.goalAwareness')}</option>
        <option value="Website traffic">{t('newClient.goalTraffic')}</option>
      </select>
      <label>{t('newClient.adLanguage')}</label>
      <input
        value={form.adLanguage}
        onChange={(e) => setForm({ ...form, adLanguage: e.target.value })}
        placeholder="English"
      />
      <label>{t('newClient.targetLocations')}</label>
      <input
        value={form.targetLocations}
        onChange={(e) => setForm({ ...form, targetLocations: e.target.value })}
        placeholder={t('newClient.targetPlaceholder')}
      />
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? t('newClient.saving') : t('newClient.save')}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
