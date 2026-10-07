'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

interface Row { key: string; clicks: number; impressions: number; ctr: number; position: number }
interface Report {
  siteUrl: string; since: string; until: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  queries: Row[]; pages: Row[]; countries: Row[]; devices: Row[];
}

function Table({ title, rows, keyLabel }: { title: string; rows: Row[]; keyLabel: string }) {
  const { tr } = useI18n();
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'start', color: 'var(--text-dim)' }}>
              <th style={{ textAlign: 'start', padding: '4px 6px' }}>{keyLabel}</th>
              <th style={{ padding: '4px 6px' }}>{tr('Clicks')}</th>
              <th style={{ padding: '4px 6px' }}>{tr('Impressions')}</th>
              <th style={{ padding: '4px 6px' }}>CTR</th>
              <th style={{ padding: '4px 6px' }}>{tr('Avg. position')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--card-border)' }}>
                <td style={{ padding: '4px 6px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>{r.clicks.toLocaleString('en-US')}</td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>{r.impressions.toLocaleString('en-US')}</td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>{(r.ctr * 100).toFixed(1)}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>{r.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SearchConsoleCard({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let off = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/search-console?clientId=${clientId}&days=${days}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (!off) setData(d);
      })
      .catch((e) => !off && setErr(e.message))
      .finally(() => !off && setLoading(false));
    return () => { off = true; };
  }, [clientId, days]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr('Search Console (organic search)')}</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto', margin: 0 }}>
          {[7, 28, 90].map((d) => <option key={d} value={d}>{tr('Last')} {d} {tr('days')}</option>)}
        </select>
      </div>
      {loading && <p style={{ color: 'var(--text-dim)' }}>{tr('Loading…')}</p>}
      {err && <p style={{ color: '#ef4444' }}>{err}</p>}
      {data && !loading && (
        <>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 10 }}>{data.siteUrl} · {data.since} → {data.until}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
            {[
              [tr('Clicks'), data.totals.clicks.toLocaleString('en-US')],
              [tr('Impressions'), data.totals.impressions.toLocaleString('en-US')],
              ['CTR', `${(data.totals.ctr * 100).toFixed(1)}%`],
              [tr('Avg. position'), data.totals.position.toFixed(1)],
            ].map(([l, v]) => (
              <div key={l} className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{l}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          <Table title={tr('Top queries')} rows={data.queries} keyLabel={tr('Query')} />
          <Table title={tr('Top pages')} rows={data.pages} keyLabel={tr('Page')} />
          <Table title={tr('Countries')} rows={data.countries} keyLabel={tr('Country')} />
          <Table title={tr('Devices')} rows={data.devices} keyLabel={tr('Device')} />
        </>
      )}
    </div>
  );
}
