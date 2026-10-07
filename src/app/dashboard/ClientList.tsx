'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/LocaleProvider';
import { AGENTS, isAgentKey } from '@/lib/agents';

export interface ClientRow {
  id: string;
  name: string;
  industry: string;
  connected: boolean;
  campaigns: number;
  spendLabel: string;
  spendCents: number;
  pending: number;
  recharge: number;
  issues: string[];
  agent: string | null;
  prospectLabel: string | null;
}

// Client list with search, an "Needs attention" filter and sorting. Rows are
// precomputed on the server (counts + this-month spend + attention reasons),
// so filtering here is instant and needs no extra requests.
export default function ClientList({ rows, isAdmin }: { rows: ClientRow[]; isAdmin: boolean }) {
  const { tr, t } = useI18n();
  const [q, setQ] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [sort, setSort] = useState<'newest' | 'spend' | 'attention'>('newest');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows.filter((r) => (!needle || r.name.toLowerCase().includes(needle) || r.industry.toLowerCase().includes(needle)) && (!onlyAttention || r.issues.length > 0));
    if (sort === 'spend') list = [...list].sort((a, b) => b.spendCents - a.spendCents);
    if (sort === 'attention') list = [...list].sort((a, b) => b.issues.length - a.issues.length);
    return list;
  }, [rows, q, onlyAttention, sort]);

  const attentionCount = rows.filter((r) => r.issues.length > 0).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Search clients…')}
          style={{ flex: '1 1 220px', margin: 0 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ width: 'auto', margin: 0 }}>
          <option value="newest">{tr('Newest first')}</option>
          <option value="spend">{tr('Highest spend')}</option>
          <option value="attention">{tr('Most issues')}</option>
        </select>
        <button
          className={onlyAttention ? 'btn' : 'btn btn-secondary'}
          onClick={() => setOnlyAttention((v) => !v)}
          disabled={attentionCount === 0 && !onlyAttention}
        >
          {tr('Needs attention')} ({attentionCount})
        </button>
      </div>

      {shown.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{tr('No clients match.')}</p>}

      {shown.map((c) => (
        <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                {c.industry} · {c.connected ? tr('Connected') : t('home.notConnected')} · {t('home.campaignCount', { n: c.campaigns })} ·{' '}
                {tr('This month')}: <strong style={{ color: 'var(--text)' }}>{c.spendLabel}</strong>
              </div>
              {(c.prospectLabel || isAgentKey(c.agent)) && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {c.prospectLabel && <span className="badge badge-approved">{c.prospectLabel}</span>}
                  {isAgentKey(c.agent) && <span className="badge badge-approved">{tr('Agent')}: {AGENTS[c.agent].name}</span>}
                </div>
              )}
              {c.issues.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {c.issues.map((i) => (
                    <span key={i} className="badge badge-pending">
                      {i}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className="badge badge-approved">{t('home.view')}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
