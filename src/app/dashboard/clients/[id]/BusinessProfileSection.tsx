'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BusinessLocationRow {
  id: string;
  title: string;
  address: string | null;
  primaryPhone: string | null;
  openStatus: string;
  last7d: {
    searchImpressions: number;
    mapsImpressions: number;
    callClicks: number;
    websiteClicks: number;
    directionRequests: number;
  };
}

export interface BusinessReviewRow {
  id: string;
  locationTitle: string;
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  createTime: string | Date;
  replyState: string;
  replyComment: string | null;
}

const openStatusLabel: Record<string, string> = {
  OPEN: 'Open',
  CLOSED_TEMPORARILY: 'Temporarily closed',
  CLOSED_PERMANENTLY: 'Permanently closed',
  UNSPECIFIED: 'Unknown',
};

const replyStateBadge: Record<string, string> = {
  NONE: 'badge-draft',
  PENDING_APPROVAL: 'badge-pending',
  POSTED: 'badge-live',
  REJECTED: 'badge-failed',
  FAILED: 'badge-failed',
};

function Stars({ rating }: { rating: number }) {
  return <span style={{ color: '#f5b301', letterSpacing: 1 }}>{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>;
}

// Pulls locations (branches), their last-30-days performance, and their
// reviews from the connected Business Profile account — same "Sync now"
// pattern as /api/metrics/sync for Google Ads. Read-only display; drafting
// and posting review replies happens in BusinessInsightsPanel below.
export default function BusinessProfileSection({
  clientId,
  accountId,
  locations,
  reviews,
}: {
  clientId: string;
  accountId: string;
  locations: BusinessLocationRow[];
  reviews: BusinessReviewRow[];
}) {
  const { tr } = useI18n();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/google-business/sync?accountId=${accountId}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? tr("Sync failed"));
        return;
      }
      setMessage(
        `Synced ${data.locationsSynced} branch(es), ${data.metricsSynced} metric row(s), ${data.reviewsSynced} review(s).`
      );
      if (data.errors?.length) setError(data.errors.join('; '));
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Sync failed — network error"));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: '1.1rem' }}>{tr("Branches")}</h2>
          <button className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? tr("Syncing…") : tr("Sync now")}
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
          {tr("Locations, their last-30-day search/maps visibility, and customer actions (calls, website clicks, direction requests) — pulled live from Google Business Profile.")}
        </p>

        {message && <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginBottom: 10 }}>{message}</p>}
        {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

        {locations.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>
            {tr("No branches yet. Click \"Sync now\" to pull them in (requires the client to have added your Google account as a Manager/Owner on their Business Profile).")}
          </p>
        ) : (
          locations.map((loc) => (
            <div key={loc.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{loc.title}</strong>{' '}
                  <span className={`badge ${loc.openStatus === 'OPEN' ? 'badge-live' : 'badge-draft'}`}>
                    {openStatusLabel[loc.openStatus] ?? loc.openStatus}
                  </span>
                </div>
              </div>
              {(loc.address || loc.primaryPhone) && (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '4px 0' }}>
                  {loc.address}
                  {loc.address && loc.primaryPhone && ' · '}
                  {loc.primaryPhone}
                </p>
              )}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 6 }}>
                <span>{tr("Search impressions:")}{' '}<strong style={{ color: 'var(--text)' }}>{loc.last7d.searchImpressions.toLocaleString()}</strong></span>
                <span>{tr("Maps impressions:")}{' '}<strong style={{ color: 'var(--text)' }}>{loc.last7d.mapsImpressions.toLocaleString()}</strong></span>
                <span>{tr("Calls:")}{' '}<strong style={{ color: 'var(--text)' }}>{loc.last7d.callClicks.toLocaleString()}</strong></span>
                <span>{tr("Website clicks:")}{' '}<strong style={{ color: 'var(--text)' }}>{loc.last7d.websiteClicks.toLocaleString()}</strong></span>
                <span>{tr("Direction requests:")}{' '}<strong style={{ color: 'var(--text)' }}>{loc.last7d.directionRequests.toLocaleString()}</strong></span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>{tr("Reviews")}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
          {tr("Every synced review across all branches, most recent first. Drafting and approving replies happens in the AI review panel below.")}
        </p>

        {reviews.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>{tr("No reviews synced yet.")}</p>
        ) : (
          reviews.map((r) => (
            <div key={r.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <Stars rating={r.starRating} />{' '}
                  <strong>{r.reviewerName ?? tr("Anonymous")}</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>· {r.locationTitle}</span>
                </div>
                <span className={`badge ${replyStateBadge[r.replyState] ?? 'badge-draft'}`}>
                  {r.replyState === 'NONE' ? tr("No reply") : r.replyState.replaceAll('_', ' ')}
                </span>
              </div>
              {r.comment && <p style={{ fontSize: '0.85rem', margin: '6px 0' }}>{r.comment}</p>}
              {r.replyComment && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', background: 'var(--bg-alt)', borderRadius: 6, padding: '6px 8px', marginTop: 4 }}>
                  <strong style={{ color: 'var(--text)' }}>{tr("Reply:")}</strong> {r.replyComment}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
