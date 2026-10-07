'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

interface Report {
  merchantId: string;
  products: { total: number; approved: number; pending: number; disapproved: number; sampled: boolean };
  issues: { code: string; description: string; severity: string; count: number }[];
  performance: { clicks: number; impressions: number; ctr: number; conversions: number; conversionValue: number } | null;
  performanceError: string | null;
}

export default function MerchantCenterCard({ clientId }: { clientId: string }) {
  const { tr } = useI18n();
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let off = false;
    fetch(`/api/merchant-center?clientId=${clientId}&days=30`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (!off) setData(d);
      })
      .catch((e) => !off && setErr(e.message))
      .finally(() => !off && setLoading(false));
    return () => { off = true; };
  }, [clientId]);

  const Kpi = ({ l, v, warn }: { l: string; v: string; warn?: boolean }) => (
    <div className="card" style={{ marginBottom: 0, borderColor: warn ? '#ef4444' : undefined }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{l}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{v}</div>
    </div>
  );

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 10 }}>{tr('Merchant Center (shopping feed)')}</h2>
      {loading && <p style={{ color: 'var(--text-dim)' }}>{tr('Loading…')}</p>}
      {err && <p style={{ color: '#ef4444' }}>{err}</p>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
            <Kpi l={tr('Products')} v={data.products.total.toLocaleString('en-US') + (data.products.sampled ? '+' : '')} />
            <Kpi l={tr('Approved')} v={String(data.products.approved)} />
            <Kpi l={tr('Pending')} v={String(data.products.pending)} />
            <Kpi l={tr('Disapproved')} v={String(data.products.disapproved)} warn={data.products.disapproved > 0} />
          </div>
          {data.performance && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginTop: 10 }}>
              <Kpi l={tr('Clicks')} v={data.performance.clicks.toLocaleString('en-US')} />
              <Kpi l={tr('Impressions')} v={data.performance.impressions.toLocaleString('en-US')} />
              <Kpi l="CTR" v={`${(data.performance.ctr * 100).toFixed(1)}%`} />
              <Kpi l={tr('Conversions')} v={String(Math.round(data.performance.conversions * 10) / 10)} />
            </div>
          )}
          {data.performanceError && <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 8 }}>{tr('Performance data unavailable')}: {data.performanceError}</p>}
          {data.issues.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{tr('Top product issues')}</div>
              {data.issues.map((i) => (
                <div key={i.code + i.description} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', borderTop: '1px solid var(--card-border)', fontSize: '0.85rem' }}>
                  <span>{i.description}</span>
                  <span style={{ color: 'var(--text-dim)' }}>{i.count}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
