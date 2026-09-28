'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
        setError(data.error ?? 'Import failed');
        return;
      }
      setMessage(
        `Imported ${data.imported} new campaign(s), updated ${data.updated} existing one(s) (${data.total} found on Google Ads).`
      );
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Import failed — network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={handleClick} disabled={loading}>
        {loading ? 'Importing…' : 'Import existing campaigns'}
      </button>
      {message && <p style={{ color: 'var(--accent2)', fontSize: '0.8rem', marginTop: 6 }}>{message}</p>}
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
