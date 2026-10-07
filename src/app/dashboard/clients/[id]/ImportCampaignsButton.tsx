'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/LocaleProvider';

// Pulls in campaigns that already exist on the client's Google Ads account
// but weren't created through AdPac (e.g. set up directly in the Google Ads
// UI before or outside of AdPac). Without this, metrics sync has no local
// record to match performance data against, so reporting shows nothing for
// campaigns that are actually running. Also reconciles status/budget/name
// for campaigns AdPac already tracks — catches things like a campaign being
// paused directly in Google Ads, which AdPac otherwise wouldn't notice.
export default function ImportCampaignsButton({
  clientId,
  googleAdsAccountId,
}: {
  clientId: string;
  googleAdsAccountId: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, googleAdsAccountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t('cards.importFailed'));
        return;
      }
      setMessage(t('cards.importDone', { imported: data.imported, updated: data.updated, total: data.total }));
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? t('cards.importFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={handleClick} disabled={loading}>
        {loading ? t('cards.importing') : t('cards.importExisting')}
      </button>
      {message && <p style={{ color: 'var(--accent2)', fontSize: '0.8rem', marginTop: 6 }}>{message}</p>}
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
