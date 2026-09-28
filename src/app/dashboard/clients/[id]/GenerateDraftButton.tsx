'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GenerateDraftButton({
  clientId,
  googleAdsAccountId,
}: {
  clientId: string;
  googleAdsAccountId: string;
}) {
  const router = useRouter();
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
      setError(data.error ?? 'Failed to generate draft');
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button className="btn" onClick={handleClick} disabled={loading}>
        {loading ? 'Generating…' : '✦ Generate AI campaign draft'}
      </button>
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
