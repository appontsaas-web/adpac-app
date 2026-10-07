'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState } from 'react';

export default function PortalLoginForm() {
  const { tr } = useI18n();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/portal/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      setMessage(d.message ?? tr("If that email is registered, a sign-in link is on its way."));
    } catch {
      setMessage(tr("Something went wrong — please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 120 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>{tr("AdPac Client Portal")}</h1>
      <form onSubmit={handleSubmit} className="card">
        <label>{tr("Email")}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={tr("you@yourcompany.com")}
          required
        />
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%', marginTop: 12 }}>
          {loading ? tr("Sending…") : tr("Email me a sign-in link")}
        </button>
        {message && <p style={{ fontSize: '0.85rem', color: 'var(--accent2, #22d3c9)', marginTop: 10 }}>{message}</p>}
      </form>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
        {tr("No password needed — we'll email you a secure link to sign in.")}
      </p>
    </div>
  );
}
