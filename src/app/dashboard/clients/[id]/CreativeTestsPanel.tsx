'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CampaignOption {
  id: string;
  name: string;
}

interface AvailableAd {
  adId: string;
  adGroupId?: string; // Google
  adSetId?: string; // Meta
  headline?: string; // Google
  name?: string; // Meta
  status: string;
}

interface VariantStat {
  adId: string;
  label: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  conversionRate: number;
}

interface TestRow {
  id: string;
  platform: 'GOOGLE_ADS' | 'META';
  campaignId: string | null;
  metaCampaignId: string | null;
  name: string;
  status: string;
  startedAt: string;
  variants: { id: string; adId: string; label: string; isWinner: boolean; isPaused: boolean }[];
  stats: VariantStat[];
  evaluation: { hasWinner: boolean; reason: string; metric?: string } | null;
  actionLogs: { id: string; payloadJson: string; status: string }[];
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// Creative A/B testing — pick 2+ ads already running in the same ad group
// (Google) or ad set (Meta), track their real performance from data already
// being synced, and get a human-approved recommendation to pause the loser
// once there's a statistically significant winner (see lib/creativeTests.ts
// — deterministic z-test, not an AI call). Approving actually pauses the
// losing ad(s) on Google Ads/Meta; see /api/creative-tests/winners/[id]/approve.
export default function CreativeTestsPanel({
  clientId,
  googleCampaigns,
  metaCampaigns,
}: {
  clientId: string;
  googleCampaigns: CampaignOption[];
  metaCampaigns: CampaignOption[];
}) {
  const { tr } = useI18n();
  const router = useRouter();
  const [tests, setTests] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // New-test form state
  const [platform, setPlatform] = useState<'GOOGLE_ADS' | 'META'>(googleCampaigns.length ? 'GOOGLE_ADS' : 'META');
  const [campaignId, setCampaignId] = useState('');
  const [name, setName] = useState('');
  const [ads, setAds] = useState<AvailableAd[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [selectedAdIds, setSelectedAdIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  async function loadTests() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/creative-tests?clientId=${clientId}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to load creative tests"));
        return;
      }
      setTests(d.tests ?? []);
    } catch (err: any) {
      setError(err.message ?? tr("Failed to load creative tests — network error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!campaignId) {
      setAds([]);
      setSelectedAdIds([]);
      return;
    }
    setLoadingAds(true);
    setSelectedAdIds([]);
    const params =
      platform === 'GOOGLE_ADS' ? `platform=GOOGLE_ADS&campaignId=${campaignId}` : `platform=META&metaCampaignId=${campaignId}`;
    fetch(`/api/creative-tests/available-ads?${params}`)
      .then((r) => r.json())
      .then((d) => setAds(d.ads ?? []))
      .catch(() => setAds([]))
      .finally(() => setLoadingAds(false));
  }, [platform, campaignId]);

  function toggleAd(adId: string) {
    setSelectedAdIds((prev) => (prev.includes(adId) ? prev.filter((id) => id !== adId) : [...prev, adId]));
  }

  // Only ads sharing the same ad group / ad set can be picked together, so
  // once 1+ is selected the picker narrows to that group automatically.
  const selectedGroupId =
    selectedAdIds.length > 0
      ? ads.find((a) => a.adId === selectedAdIds[0])?.adGroupId ?? ads.find((a) => a.adId === selectedAdIds[0])?.adSetId
      : null;
  const pickableAds = selectedGroupId ? ads.filter((a) => (a.adGroupId ?? a.adSetId) === selectedGroupId) : ads;

  async function handleCreate() {
    if (!campaignId || !name || selectedAdIds.length < 2) {
      setError(tr("Pick a campaign, a name, and at least 2 ads in the same ad group/ad set"));
      return;
    }
    const groupId = ads.find((a) => a.adId === selectedAdIds[0])?.adGroupId ?? ads.find((a) => a.adId === selectedAdIds[0])?.adSetId;
    if (!groupId) {
      setError(tr("Couldn't determine the ad group/ad set for the selected ads"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const variants = selectedAdIds.map((adId, i) => {
        const ad = ads.find((a) => a.adId === adId)!;
        return { adId, adGroupId: ad.adGroupId, label: String.fromCharCode(65 + i) };
      });
      const res = await fetch('/api/creative-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          platform,
          campaignId: platform === 'GOOGLE_ADS' ? campaignId : undefined,
          metaCampaignId: platform === 'META' ? campaignId : undefined,
          groupId,
          name,
          variants,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to create test"));
        return;
      }
      setShowForm(false);
      setName('');
      setCampaignId('');
      setSelectedAdIds([]);
      loadTests();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to create test — network error"));
    } finally {
      setCreating(false);
    }
  }

  async function handleApproveWinner(actionLogId: string) {
    if (!confirm('Pause the losing variant(s)? This changes what is actually running on the ad account.')) return;
    setProcessingId(actionLogId);
    setError(null);
    try {
      const res = await fetch(`/api/creative-tests/winners/${actionLogId}/approve`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to approve winner"));
        return;
      }
      loadTests();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to approve winner — network error"));
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDismissWinner(actionLogId: string) {
    setProcessingId(actionLogId);
    setError(null);
    try {
      const res = await fetch(`/api/creative-tests/winners/${actionLogId}/dismiss`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? tr("Failed to dismiss"));
        return;
      }
      loadTests();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to dismiss — network error"));
    } finally {
      setProcessingId(null);
    }
  }

  const campaignOptions = platform === 'GOOGLE_ADS' ? googleCampaigns : metaCampaigns;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr("Creative A/B tests")}</h2>
        <button className="btn btn-secondary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? tr("Cancel") : tr("+ New test")}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        {tr("Compare 2+ existing ads in the same ad group/ad set. Once one is a statistically significant winner, you'll get a recommendation here to pause the loser — nothing is paused automatically.")}
      </p>

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {showForm && (
        <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {googleCampaigns.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <input
                  type="radio"
                  checked={platform === 'GOOGLE_ADS'}
                  onChange={() => {
                    setPlatform('GOOGLE_ADS');
                    setCampaignId('');
                  }}
                  style={{ width: 'auto' }}
                />
                {tr("Google Ads")}
              </label>
            )}
            {metaCampaigns.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <input
                  type="radio"
                  checked={platform === 'META'}
                  onChange={() => {
                    setPlatform('META');
                    setCampaignId('');
                  }}
                  style={{ width: 'auto' }}
                />
                {tr("Meta")}
              </label>
            )}
          </div>

          <input
            type="text"
            placeholder={tr("Test name (e.g. Headline test — Sept)")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="">{tr("Select a campaign…")}</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {loadingAds && <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{tr("Loading ads…")}</p>}
          {!loadingAds && campaignId && pickableAds.length === 0 && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{tr("No synced ads found for this campaign yet.")}</p>
          )}
          {!loadingAds && pickableAds.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 6 }}>
                {tr("Pick 2+ ads from the same ad group/ad set:")}
              </p>
              {pickableAds.map((ad) => (
                <label key={ad.adId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', padding: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={selectedAdIds.includes(ad.adId)}
                    onChange={() => toggleAd(ad.adId)}
                    style={{ width: 'auto' }}
                  />
                  <span>{ad.headline ?? ad.name ?? ad.adId}</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>({ad.status})</span>
                </label>
              ))}
            </div>
          )}

          <button className="btn" onClick={handleCreate} disabled={creating || selectedAdIds.length < 2}>
            {creating ? tr("Starting…") : tr("Start test")}
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-dim)' }}>{tr("Loading…")}</p>
      ) : tests.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>{tr("No creative tests yet.")}</p>
      ) : (
        tests.map((test) => {
          const pendingWinner = test.actionLogs[0];
          const payload = pendingWinner ? JSON.parse(pendingWinner.payloadJson) : null;
          return (
            <div key={test.id} style={{ borderBottom: '1px solid var(--card-border)', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span className={`badge ${test.status === 'COMPLETED' ? 'badge-live' : test.status === 'ARCHIVED' ? 'badge-failed' : 'badge-pending'}`}>
                    {test.status}
                  </span>{' '}
                  <strong>{test.name}</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>({test.platform === 'GOOGLE_ADS' ? tr("Google Ads") : tr("Meta")})</span>
                </div>
              </div>

              <table style={{ width: '100%', fontSize: '0.82rem', marginTop: 8, marginBottom: 6 }}>
                <thead>
                  <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                    <th>{tr("Variant")}</th>
                    <th>{tr("Impr.")}</th>
                    <th>{tr("Clicks")}</th>
                    <th>{tr("CTR")}</th>
                    <th>{tr("Conversions")}</th>
                    <th>{tr("Conv. rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {test.stats.map((s) => {
                    const variant = test.variants.find((v) => v.adId === s.adId);
                    return (
                      <tr key={s.adId}>
                        <td>
                          {s.label}
                          {variant?.isWinner && ' 🏆'}
                          {variant?.isPaused && ' (paused)'}
                        </td>
                        <td>{s.impressions.toLocaleString()}</td>
                        <td>{s.clicks.toLocaleString()}</td>
                        <td>{pct(s.ctr)}</td>
                        <td>{s.conversions.toFixed(1)}</td>
                        <td>{pct(s.conversionRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {test.evaluation && !pendingWinner && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{test.evaluation.reason}</p>
              )}

              {pendingWinner && payload && (
                <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}>
                  <p style={{ fontSize: '0.85rem', marginBottom: 4 }}>{payload.summary}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 8 }}>{payload.rationale}</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleApproveWinner(pendingWinner.id)}
                      disabled={processingId === pendingWinner.id}
                    >
                      {processingId === pendingWinner.id ? tr("Working…") : tr("Approve — pause loser")}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleDismissWinner(pendingWinner.id)}
                      disabled={processingId === pendingWinner.id}
                    >
                      {tr("Dismiss")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
