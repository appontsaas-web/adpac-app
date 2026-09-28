'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CampaignDraft {
  imported?: boolean; // true if this row was pulled in from an existing Google Ads campaign, not AI-drafted
  campaignType?: string;
  targetLanguage?: string;
  targetLocations?: string[];
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  rationale: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  dailyBudgetCents: number;
  aiBriefJson: string;
  googleCampaignId: string | null;
  hiddenFromList?: boolean;
}

const badgeClass: Record<string, string> = {
  DRAFT: 'badge-draft',
  PENDING_APPROVAL: 'badge-pending',
  APPROVED: 'badge-approved',
  LIVE: 'badge-live',
  PAUSED: 'badge-draft',
  REJECTED: 'badge-failed',
};

export default function CampaignCard({
  campaign,
  readOnly,
  isAdmin,
}: {
  campaign: Campaign;
  readOnly?: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft: CampaignDraft = JSON.parse(campaign.aiBriefJson);

  const editable = !readOnly && (campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') && !campaign.googleCampaignId;
  const [locationsInput, setLocationsInput] = useState((draft.targetLocations ?? []).join(', '));
  const [savingLocations, setSavingLocations] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [locationsSaved, setLocationsSaved] = useState(false);
  const [togglingHidden, setTogglingHidden] = useState(false);

  // Purely a local display toggle — never touches Google Ads, works
  // regardless of status, so it's available whether or not the user has
  // edit access to anything else on the card.
  async function handleToggleHidden() {
    setTogglingHidden(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenFromList: !campaign.hiddenFromList }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to update');
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update — network error');
    } finally {
      setTogglingHidden(false);
    }
  }

  async function handleSaveLocations() {
    const targetLocations = locationsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setSavingLocations(true);
    setLocationsError(null);
    setLocationsSaved(false);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLocations }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLocationsError(data.error ?? `Save failed (${res.status})`);
        return;
      }
      setLocationsSaved(true);
      router.refresh();
    } catch (err: any) {
      setLocationsError(err.message ?? 'Save failed — network error');
    } finally {
      setSavingLocations(false);
    }
  }

  async function handleApprove() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaign.id}/approve`, { method: 'POST' });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Approval failed');
      return;
    }
    router.refresh();
  }

  async function handleDiscard() {
    if (!confirm(`Discard the draft "${campaign.name}"? This can't be undone.`)) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaign.id}`, { method: 'DELETE' });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Discard failed');
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ borderBottom: '1px solid var(--card-border)', padding: '14px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span className={`badge ${badgeClass[campaign.status] ?? 'badge-draft'}`}>{campaign.status}</span>{' '}
          <strong>{campaign.name}</strong>{' '}
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            ${(campaign.dailyBudgetCents / 100).toFixed(2)}/day
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide' : 'Details'}
          </button>
          {!readOnly && (campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') && (
            <button className="btn" onClick={handleApprove} disabled={loading}>
              {loading ? 'Pushing to Google Ads…' : 'Approve & push live (paused)'}
            </button>
          )}
          {/* Discard only makes sense before anything's been created on Google's side —
              once googleCampaignId is set, "discarding" should mean pausing/removing it
              on Google Ads instead, which is a separate action from deleting our record. */}
          {!readOnly && (campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') && !campaign.googleCampaignId && (
            <button className="btn btn-secondary" onClick={handleDiscard} disabled={loading}>
              Discard draft
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-secondary" onClick={handleToggleHidden} disabled={togglingHidden}>
              {togglingHidden ? 'Working…' : campaign.hiddenFromList ? 'Unhide' : 'Hide from list'}
            </button>
          )}
        </div>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}

      {expanded && (
        <div style={{ marginTop: 14, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
          <p style={{ marginBottom: 4 }}>
            <strong style={{ color: 'var(--text)' }}>Campaign type:</strong> {draft.campaignType ?? 'Search'}
          </p>
          <p style={{ marginBottom: 4 }}>
            <strong style={{ color: 'var(--text)' }}>Ad language:</strong> {draft.targetLanguage ?? 'Not recorded (generated before this was tracked)'}
          </p>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--text)' }}>Target locations:</strong>{' '}
            {editable ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <input
                  value={locationsInput}
                  onChange={(e) => setLocationsInput(e.target.value)}
                  placeholder="e.g. Lebanon, United Arab Emirates"
                  style={{ margin: 0, flex: 1 }}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleSaveLocations}
                  disabled={savingLocations}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {savingLocations ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <span>{draft.targetLocations?.length ? draft.targetLocations.join(', ') : 'Not recorded'}</span>
            )}
            {locationsSaved && (
              <p style={{ color: 'var(--accent2)', fontSize: '0.8rem', marginTop: 4 }}>
                Saved — will be applied as real geo-targeting when approved.
              </p>
            )}
            {locationsError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 4 }}>{locationsError}</p>}
          </div>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--text)' }}>Rationale:</strong> {draft.rationale}
          </p>
          <p style={{ marginBottom: 4 }}>
            <strong style={{ color: 'var(--text)' }}>Keywords:</strong> {draft.keywords.join(', ')}
          </p>
          <p style={{ marginBottom: 4 }}>
            <strong style={{ color: 'var(--text)' }}>Headlines:</strong> {draft.headlines.join(' · ')}
          </p>
          <p>
            <strong style={{ color: 'var(--text)' }}>Descriptions:</strong> {draft.descriptions.join(' · ')}
          </p>
          {campaign.googleCampaignId && (
            <p style={{ marginTop: 8 }}>
              Google campaign ID: <code>{campaign.googleCampaignId}</code>
              {draft.imported
                ? ' — imported from an existing Google Ads campaign; manage its on/off status directly in Google Ads.'
                : " — created PAUSED, turn it on from Google Ads or the API once you've reviewed it."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
