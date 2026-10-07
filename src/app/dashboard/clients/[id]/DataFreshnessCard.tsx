'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export interface FreshnessRow {
  platform: 'google' | 'meta' | 'snapchat' | 'tiktok';
  label: string;
  accountIds: string[];
  dataThrough: string | null; // ISO date of the newest metric row
  status: string; // connected | revoked | error
}

const SYNC: Record<FreshnessRow['platform'], (id: string) => string> = {
  google: (id) => `/api/metrics/sync?googleAdsAccountId=${id}&days=30`,
  meta: (id) => `/api/meta/sync?accountId=${id}&days=30`,
  snapchat: (id) => `/api/snapchat/sync?accountId=${id}&days=30`,
  tiktok: (id) => `/api/tiktok/sync?accountId=${id}&days=30`,
};

// "Data through" per connected platform + a re-sync button, so staff can see
// at a glance whether the numbers are fresh and refresh them on demand.
export default function DataFreshnessCard({ rows }: { rows: FreshnessRow[] }) {
  const { tr, date } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (rows.length === 0) return null;

  async function resync(r: FreshnessRow) {
    setBusy(r.platform);
    setMsg(null);
    try {
      for (const id of r.accountIds) {
        const res = await fetch(SYNC[r.platform](id), { method: 'POST' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setMsg(`${r.label}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{tr('Data freshness')}</div>
      {rows.map((r) => {
        const stale = !r.dataThrough || r.dataThrough.slice(0, 10) < new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
        return (
          <div key={r.platform} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', flexWrap: 'wrap' }}>
            <div>
              <strong>{r.label}</strong>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                {' '}· {r.dataThrough ? `${tr('data through')} ${date(r.dataThrough)}` : tr('no data yet')}
              </span>
              {r.status !== 'connected' && <span className="badge badge-pending" style={{ marginInlineStart: 8 }}>{tr('Needs reconnecting')}</span>}
              {stale && r.status === 'connected' && <span className="badge badge-pending" style={{ marginInlineStart: 8 }}>{tr('Stale')}</span>}
            </div>
            <button className="btn btn-secondary" disabled={busy !== null} onClick={() => resync(r)}>
              {busy === r.platform ? tr('Syncing…') : tr('Re-sync')}
            </button>
          </div>
        );
      })}
      {msg && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
