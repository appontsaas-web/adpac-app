'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

interface Report {
  headline: string;
  healthScore: number;
  summary: string;
  findings: { title: string; severity: 'high' | 'medium' | 'low' | 'good'; detail: string }[];
  actionPlan: { priority: number; action: string; why: string; expectedImpact: string }[];
  ifWeManagedIt: { approach: string; first30Days: string[]; expectedOutcome: string };
}

const SEV: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6', good: '#22c55e' };

// View-only report. Deterrents (not a guarantee — no website can truly
// prevent a phone photo or OS screenshot): no print (CSS hides it), copy /
// cut / save / print shortcuts and right-click blocked, text selection and
// drag disabled, tiled watermark with the viewer's email, content blanks
// when the tab loses focus or a screenshot-style key is pressed, and the
// server stops sending the report at expiry.
export default function ProtectedReport({ data, expiresAt, watermark }: { data: { report: Report; meta: any }; expiresAt: string; watermark: string }) {
  const { tr, money } = useI18n();
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(false);
  const end = new Date(expiresAt).getTime();
  const left = Math.max(0, end - now);

  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const block = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c', 'x', 'a', 'u'].includes(k)) e.preventDefault();
      if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(k))) {
        setHidden(true);
        try { navigator.clipboard?.writeText(''); } catch {}
        setTimeout(() => setHidden(false), 2500);
      }
    };
    const vis = () => setHidden(document.visibilityState !== 'visible');
    const blur = () => setHidden(true);
    const focus = () => setHidden(false);
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    document.addEventListener('dragstart', block);
    document.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(tick);
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
      document.removeEventListener('dragstart', block);
      document.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, []);

  useEffect(() => {
    if (left === 0) window.location.reload(); // server now serves the "expired" state
  }, [left]);

  const r = data.report;
  const t = data.meta?.totals;
  const hrs = Math.floor(left / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  const wm = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='160'><text x='10' y='90' transform='rotate(-25 160 80)' fill='rgba(128,128,128,0.18)' font-size='16' font-family='Arial'>${watermark.replace(/[<>&'"]/g, '')} · AdPac</text></svg>`
  );

  return (
    <>
      <style>{`
        @media print { .fa-wrap { display: none !important; } body::after { content: 'Printing is disabled for this report.'; display:block; padding:40px; } }
        .fa-wrap, .fa-wrap * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
        .fa-wrap img { pointer-events: none; }
      `}</style>
      <div className="fa-wrap" style={{ position: 'relative' }}>
        <div className="card" style={{ marginBottom: 14, borderColor: '#f59e0b' }}>
          <strong>{tr('Available for')} {hrs}h {mins}m</strong>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}> — {tr('view-only; this report cannot be downloaded and disappears after 48 hours.')}</span>
        </div>

        <div style={{ filter: hidden ? 'blur(18px)' : 'none', transition: 'filter .1s' }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{data.meta?.platform} · {tr('last 30 days')}</div>
                <h2 style={{ fontSize: '1.25rem', margin: '4px 0 8px' }}>{r.headline}</h2>
              </div>
              <div style={{ textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{r.healthScore}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{tr('Account health')}</div>
              </div>
            </div>
            <p style={{ fontSize: '0.95rem', lineHeight: 1.6 }}>{r.summary}</p>
            {t && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginTop: 12 }}>
                <Kpi label={tr('Spend')} value={money(Math.round(t.spendUsd * 100))} />
                <Kpi label={tr('Clicks')} value={t.clicks.toLocaleString('en-US')} />
                <Kpi label="CTR" value={`${t.ctrPct}%`} />
                <Kpi label={tr('Conversions')} value={String(t.conversions)} />
                <Kpi label="ROAS" value={String(t.roas)} />
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 10 }}>{tr('What we found')}</h3>
            {r.findings.map((f, i) => (
              <div key={i} style={{ borderInlineStart: `3px solid ${SEV[f.severity]}`, paddingInlineStart: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>{f.title}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>{f.detail}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 10 }}>{tr('Your action plan')}</h3>
            {[...r.actionPlan].sort((a, b) => a.priority - b.priority).map((a, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700 }}>{i + 1}. {a.action}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>{tr('Why')}: {a.why}</div>
                <div style={{ fontSize: '0.9rem' }}>{tr('Expected impact (estimate)')}: {a.expectedImpact}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent, #6d5efc)' }}>
            <h3 style={{ marginBottom: 8 }}>{tr('If AdPac managed this account')}</h3>
            <p style={{ fontSize: '0.95rem', marginBottom: 8 }}>{r.ifWeManagedIt.approach}</p>
            <ul style={{ paddingInlineStart: 18, marginBottom: 8 }}>
              {r.ifWeManagedIt.first30Days.map((s, i) => (
                <li key={i} style={{ fontSize: '0.9rem', marginBottom: 4 }}>{s}</li>
              ))}
            </ul>
            <p style={{ fontSize: '0.9rem' }}><strong>{tr('Expected outcome (estimate)')}:</strong> {r.ifWeManagedIt.expectedOutcome}</p>
            <a className="btn" style={{ marginTop: 10, display: 'inline-block' }} href="https://adpac.to/#pricing">{tr('Meet your AdPac agent')}</a>
          </div>
        </div>

        <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `url("data:image/svg+xml,${wm}")` }} />
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}
