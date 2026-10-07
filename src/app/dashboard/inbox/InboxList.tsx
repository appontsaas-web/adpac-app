'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';
import { AGENTS, isAgentKey } from '@/lib/agents';

export interface InboxRow {
  id: string;
  kind: 'MESSAGE' | 'CALL';
  body: string;
  preferredTime: string | null;
  createdAt: string;
  handled: boolean;
  clientId: string;
  clientName: string;
  agent: string | null;
  email: string | null;
}

export default function InboxList({ rows }: { rows: InboxRow[] }) {
  const { tr, date } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(r: InboxRow) {
    setBusy(r.id);
    await fetch(`/api/agent-messages/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handled: !r.handled }),
    });
    setBusy(null);
    router.refresh();
  }

  const shown = rows.filter((r) => filter === 'all' || !r.handled);
  const openCount = rows.filter((r) => !r.handled).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={filter === 'open' ? 'btn' : 'btn btn-secondary'} onClick={() => setFilter('open')}>{tr('Open')} ({openCount})</button>
        <button className={filter === 'all' ? 'btn' : 'btn btn-secondary'} onClick={() => setFilter('all')}>{tr('All')} ({rows.length})</button>
      </div>
      {shown.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{tr('Nothing here. All caught up.')}</p>}
      {shown.map((r) => (
        <div key={r.id} className="card" style={{ opacity: r.handled ? 0.6 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <div>
              <Link href={`/dashboard/clients/${r.clientId}`} style={{ fontWeight: 700 }}>{r.clientName}</Link>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                {' '}· {isAgentKey(r.agent) ? AGENTS[r.agent].name : tr('No agent')} · {date(new Date(r.createdAt))}
              </span>
            </div>
            <span className={`badge ${r.kind === 'CALL' ? 'badge-approved' : 'badge-pending'}`}>{r.kind === 'CALL' ? tr('Call request') : tr('Message')}</span>
          </div>
          {r.kind === 'CALL' && r.preferredTime && <div style={{ fontSize: '0.9rem', marginBottom: 4 }}><strong>{tr('Preferred time')}:</strong> {r.preferredTime}</div>}
          {r.body && <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', marginBottom: 10 }}>{r.body}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            {r.email && <a className="btn btn-secondary" href={`mailto:${r.email}`}>{tr('Reply by email')}</a>}
            <button className="btn btn-secondary" disabled={busy === r.id} onClick={() => toggle(r)}>{r.handled ? tr('Reopen') : tr('Mark handled')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
