'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Kicks off report generation on first load (account is connected, no report
// yet), then refreshes the page into the report. Retry button on failure.
export default function GenerateAnalysis({ failed, lastError }: { failed: boolean; lastError: string | null }) {
  const { tr } = useI18n();
  const router = useRouter();
  const started = useRef(false);
  const [err, setErr] = useState<string | null>(failed ? lastError ?? 'Something went wrong.' : null);
  const [running, setRunning] = useState(!failed);

  const [resetting, setResetting] = useState(false);

  async function switchAccount() {
    setResetting(true);
    setErr(null);
    try {
      const res = await fetch('/api/portal/analysis/reset', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Could not disconnect');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
      setResetting(false);
    }
  }

  async function run() {
    setRunning(true);
    setErr(null);
    try {
      const res = await fetch('/api/portal/analysis/generate', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error ?? 'Analysis failed');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!failed && !started.current) {
      started.current = true;
      run();
    }
  }, []);

  return (
    <div className="card">
      {running ? (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 6 }}>{tr('Analysing your account…')}</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            {tr('We are pulling your last 30 days of data and preparing your action plan. This usually takes under a minute.')}
          </p>
        </>
      ) : (
        <>
          <p style={{ color: '#ef4444', marginBottom: 10 }}>{err}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={run} disabled={resetting}>{tr('Try again')}</button>
            <button className="btn btn-secondary" onClick={switchAccount} disabled={resetting}>
              {resetting ? tr('Disconnecting…') : tr('Connect a different account')}
            </button>
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 10 }}>
            {tr('Wrong or empty account? Disconnect it and connect another one, on any platform.')}
          </p>
        </>
      )}
    </div>
  );
}
