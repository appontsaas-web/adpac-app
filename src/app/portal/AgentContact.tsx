'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// "Message your agent" / "Book a call" — creates an AgentMessage and emails the team.
export default function AgentContact({ agentName }: { agentName: string | null }) {
  const { tr } = useI18n();
  const [mode, setMode] = useState<'MESSAGE' | 'CALL' | null>(null);
  const [body, setBody] = useState('');
  const [when, setWhen] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch('/api/portal/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: mode, body, preferredTime: when }),
      });
      if (!res.ok) throw new Error();
      setState('sent');
      setBody('');
      setWhen('');
      setMode(null);
    } catch {
      setState('error');
    }
  }

  const who = agentName ?? tr('your AdPac team');
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong>{tr('Need something?')}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => { setMode('MESSAGE'); setState('idle'); }}>{tr('Message')} {who}</button>
          <button className="btn btn-secondary" onClick={() => { setMode('CALL'); setState('idle'); }}>{tr('Book a call')}</button>
        </div>
      </div>
      {state === 'sent' && <p style={{ color: '#22c55e', fontSize: '0.88rem', marginTop: 10 }}>{tr('Sent — we will get back to you shortly.')}</p>}
      {state === 'error' && <p style={{ color: '#ef4444', fontSize: '0.88rem', marginTop: 10 }}>{tr('Could not send. Please try again.')}</p>}
      {mode && (
        <form onSubmit={send} style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {mode === 'CALL' && <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder={tr('Preferred day and time')} required />}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required={mode === 'MESSAGE'} placeholder={mode === 'CALL' ? tr('What would you like to discuss? (optional)') : tr('Write your message…')} />
          <button className="btn" type="submit" disabled={state === 'sending'}>{state === 'sending' ? tr('Sending…') : tr('Send')}</button>
        </form>
      )}
    </div>
  );
}
