'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from './LocaleProvider';

// Switches EN <-> AR. Writes the cookie via the API (and the signed-in user's
// DB row, if any), then refreshes server components so <html dir> flips.
export default function LanguageToggle({ endpoint = '/api/locale' }: { endpoint?: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = locale === 'ar' ? 'en' : 'ar';

  async function switchTo() {
    setBusy(true);
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={switchTo}
      disabled={busy}
      aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      style={{
        background: 'transparent',
        border: '1px solid var(--card-border)',
        color: 'var(--text-dim)',
        borderRadius: 8,
        padding: '4px 10px',
        fontSize: '0.8rem',
        cursor: busy ? 'wait' : 'pointer',
      }}
    >
      {locale === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}
