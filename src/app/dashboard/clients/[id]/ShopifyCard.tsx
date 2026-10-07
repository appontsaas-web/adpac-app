'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

interface Report {
  shop: string; currency: string; since: string; until: string;
  orders: number; revenue: number; refunds: number; aov: number;
  topProducts: { title: string; quantity: number; revenue: number }[];
  daily: { date: string; revenue: number; orders: number }[];
  truncated: boolean;
}

export default function ShopifyCard({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let off = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/shopify?clientId=${clientId}&days=${days}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (!off) setData(d);
      })
      .catch((e) => !off && setErr(e.message))
      .finally(() => !off && setLoading(false));
    return () => { off = true; };
  }, [clientId, days]);

  const fmt = (n: number) => (data ? new Intl.NumberFormat('en-US', { style: 'currency', currency: data.currency }).format(n) : String(n));
  const max = data ? Math.max(...data.daily.map((d) => d.revenue), 1) : 1;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr('Shopify store')}</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto', margin: 0 }}>
          {[7, 30, 60].map((d) => <option key={d} value={d}>{tr('Last')} {d} {tr('days')}</option>)}
        </select>
      </div>
      {loading && <p style={{ color: 'var(--text-dim)' }}>{tr('Loading…')}</p>}
      {err && <p style={{ color: '#ef4444' }}>{err}</p>}
      {data && !loading && (
        <>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 10 }}>{data.shop} · {data.since} → {data.until} · {data.currency}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
            {[
              [tr('Revenue'), fmt(data.revenue)],
              [tr('Orders'), data.orders.toLocaleString('en-US')],
              [tr('Avg. order value'), fmt(data.aov)],
              [tr('Refunds'), fmt(data.refunds)],
            ].map(([l, v]) => (
              <div key={l} className="card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{l}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          {data.daily.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 70, marginTop: 14 }}>
              {data.daily.map((d) => (
                <div key={d.date} title={`${d.date}: ${fmt(d.revenue)}`} style={{ flex: 1, background: 'var(--accent, #6d5efc)', borderRadius: 2, height: `${Math.max((d.revenue / max) * 100, 3)}%` }} />
              ))}
            </div>
          )}
          {data.topProducts.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{tr('Top products')}</div>
              {data.topProducts.map((p) => (
                <div key={p.title} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', borderTop: '1px solid var(--card-border)', fontSize: '0.85rem' }}>
                  <span>{p.title}</span>
                  <span style={{ color: 'var(--text-dim)' }}>{p.quantity} · {fmt(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
          {data.truncated && <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 8 }}>{tr('Very large store: figures cover the most recent 3,000 orders only.')}</p>}
        </>
      )}
    </div>
  );
}
