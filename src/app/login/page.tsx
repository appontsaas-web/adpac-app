'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LanguageToggle from '@/lib/i18n/LanguageToggle';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError(t('auth.invalid'));
    } else {
      router.push('/dashboard');
    }
  }

  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <LanguageToggle />
      </div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>{t('auth.signInTitle')}</h1>
      <form onSubmit={handleSubmit} className="card">
        <label>{t('auth.email')}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>{t('auth.password')}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
          {loading ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
        {t('auth.noAccount')}
      </p>
    </div>
  );
}
