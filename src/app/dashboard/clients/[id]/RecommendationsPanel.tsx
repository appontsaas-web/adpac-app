'use client';

import { useState, useEffect } from 'react';

interface Recommendation {
  resourceName: string;
  type: string;
  summary: string;
}

// Recommendation types that Google's ApplyRecommendation endpoint cannot
// action from a bare resourceName — they describe what's missing (new ad
// creative, specific budget/bid amounts, etc.) but don't hand you a
// ready-to-apply value, so there's no generic "one click apply" for them.
// Attempting to apply these returns a 400 INVALID_ARGUMENT from Google.
// Rather than a dead/broken button, we disable Apply and point to the
// Google Ads UI, where these require actual creative or numeric input.
const REQUIRES_MANUAL_INPUT = new Set([
  'IMPROVE_PERFORMANCE_MAX_AD_STRENGTH',
  'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH',
  'CAMPAIGN_BUDGET',
  'MOVE_UNUSED_BUDGET',
  'TARGET_CPA_OPT_IN',
  'TARGET_ROAS_OPT_IN',
  'RAISE_TARGET_CPA',
  'LOWER_TARGET_ROAS',
]);

export default function RecommendationsPanel({
  clientId,
  googleAdsAccountId,
}: {
  clientId: string;
  googleAdsAccountId: string;
}) {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/recommendations?googleAdsAccountId=${googleAdsAccountId}`);
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to load recommendations');
      return;
    }
    const data = await res.json();
    setRecs(data.recommendations);
  }

  async function applyRec(rec: Recommendation) {
    setApplyingId(rec.resourceName);
    setError(null);
    try {
      const res = await fetch('/api/recommendations/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          googleAdsAccountId,
          resourceName: rec.resourceName,
          summary: rec.summary,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Apply failed (${res.status})`);
        return;
      }
      setRecs((prev) => prev?.filter((r) => r.resourceName !== rec.resourceName) ?? null);
    } catch (err: any) {
      setError(err.message ?? 'Apply failed — network error');
    } finally {
      setApplyingId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Google's optimization recommendations</h2>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        These come directly from Google's own recommendation engine for this account. Applying one is a real,
        immediate change — review before clicking.
      </p>
      {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
      {recs && recs.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No open recommendations right now.</p>}
      {recs?.map((rec) => {
        const manualOnly = REQUIRES_MANUAL_INPUT.has(rec.type);
        return (
          <div
            key={rec.resourceName}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--card-border)',
              padding: '10px 0',
              gap: 12,
            }}
          >
            <span style={{ fontSize: '0.9rem', textTransform: 'capitalize' }}>{rec.summary}</span>
            {manualOnly ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textAlign: 'right' }}>
                Needs manual input — apply in Google Ads
              </span>
            ) : (
              <button className="btn" onClick={() => applyRec(rec)} disabled={applyingId === rec.resourceName}>
                {applyingId === rec.resourceName ? 'Applying…' : 'Apply'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
