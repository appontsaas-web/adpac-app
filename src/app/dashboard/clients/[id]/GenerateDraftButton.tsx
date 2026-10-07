'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';

export default function GenerateDraftButton({
  clientId,
  googleAdsAccountId,
}: {
  clientId: string;
  googleAdsAccountId: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/campaigns/create-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, googleAdsAccountId }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? t('cards.generateFailed'));
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button className="btn" onClick={handleClick} disabled={loading}>
        {loading ? t('cards.generating') : t('cards.generateDraft')}
      </button>
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
