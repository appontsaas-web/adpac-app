'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { METRIC_CATALOG, METRIC_PLATFORMS, type MetricPlatform } from '@/lib/metricCatalog';

const PLATFORM_LABELS: Record<MetricPlatform, string> = {
  google: 'Google Ads',
  meta: 'Meta Ads',
  snapchat: 'Snapchat Ads',
};

export interface Position {
  id: string;
  name: string;
  canManageCampaigns: boolean;
  canManageGoogleAds: boolean;
  canManageTargeting: boolean;
  canViewInvoices: boolean;
  canViewReporting: boolean;
  canManageTagManager: boolean;
  canManageBusinessProfile: boolean;
  canManageMeta: boolean;
  canManageSnapchat: boolean;
}

const emptyForm = {
  name: '',
  canManageCampaigns: false,
  canManageGoogleAds: false,
  canManageTargeting: false,
  canViewInvoices: false,
  canViewReporting: false,
  canManageTagManager: false,
  canManageBusinessProfile: false,
  canManageMeta: false,
  canManageSnapchat: false,
};

// Admin-only. Positions are reusable capability bundles — assign one to a
// STAFF user (in the table below) and it controls what they can actually do.
// Campaigns/Google Ads/targeting require EDIT access to the client too (see
// ClientAssignment). Viewing invoices only requires some access (VIEW or
// EDIT) plus this toggle. Creating/editing/deleting/marking paid an invoice
// is never covered by any position — always admin-only.
export default function PositionsManager({ positions }: { positions: Position[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which position's "Configure metrics" panel is expanded — independent of
  // editingId (a name/capability edit and a metric-visibility toggle are two
  // different things, no reason to force both open at once).
  const [metricsOpenId, setMetricsOpenId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to create position');
        return;
      }
      setForm(emptyForm);
      setCreating(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create position — network error');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(p: Position) {
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      canManageCampaigns: p.canManageCampaigns,
      canManageGoogleAds: p.canManageGoogleAds,
      canManageTargeting: p.canManageTargeting,
      canViewInvoices: p.canViewInvoices,
      canViewReporting: p.canViewReporting,
      canManageTagManager: p.canManageTagManager,
      canManageBusinessProfile: p.canManageBusinessProfile,
      canManageMeta: p.canManageMeta,
      canManageSnapchat: p.canManageSnapchat,
    });
    setError(null);
  }

  async function handleSaveEdit(id: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to save position');
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save position — network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete the "${name}" position? Anyone holding it will lose those capabilities.`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to delete position');
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete position — network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Positions</h2>
        <button className="btn btn-secondary" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancel' : '+ New position'}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        Reusable capability bundles. Assign one to a staff member below — it controls what they can do on clients
        where they have Edit access. Finance is always admin-only, no matter what.
      </p>

      {creating && (
        <form onSubmit={handleCreate} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--card-border)' }}>
          <label>Position name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Campaign Manager" required />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={form.canManageCampaigns}
              onChange={(e) => setForm({ ...form, canManageCampaigns: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage campaigns (see the campaigns list, create drafts, approve & push live, discard — without this, campaigns are hidden entirely)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={form.canManageGoogleAds}
              onChange={(e) => setForm({ ...form, canManageGoogleAds: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage Google Ads connection (connect/disconnect)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canManageTargeting}
              onChange={(e) => setForm({ ...form, canManageTargeting: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage targeting & recommendations (ad language/locations, apply Google's AI suggestions)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canViewInvoices}
              onChange={(e) => setForm({ ...form, canViewInvoices: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            View, pay & download invoices (never create/edit/delete/mark paid — always admin-only)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canViewReporting}
              onChange={(e) => setForm({ ...form, canViewReporting: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            View performance reporting (dashboard, metrics, audience breakdowns — view only, separate from campaigns)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canManageTagManager}
              onChange={(e) => setForm({ ...form, canManageTagManager: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage Tag Manager (connect containers, request & approve tag deployments — writes to the client's live site)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canManageBusinessProfile}
              onChange={(e) => setForm({ ...form, canManageBusinessProfile: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage Business Profile (connect Google Business Profile, sync branches, approve review replies & insights)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canManageMeta}
              onChange={(e) => setForm({ ...form, canManageMeta: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage Meta Ads (connect Facebook/Instagram ad account, approve AI-proposed budget/pause changes)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.canManageSnapchat}
              onChange={(e) => setForm({ ...form, canManageSnapchat: e.target.checked })}
              style={{ width: 'auto', margin: 0 }}
            />
            Manage Snapchat Ads (connect Snapchat ad account, manage campaigns)
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create position'}
          </button>
        </form>
      )}

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      {positions.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>No positions yet. Staff without a position have no edit capabilities anywhere.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
              <th style={{ padding: '8px 6px' }}>Name</th>
              <th style={{ padding: '8px 6px' }}>Campaigns</th>
              <th style={{ padding: '8px 6px' }}>Google Ads</th>
              <th style={{ padding: '8px 6px' }}>Targeting</th>
              <th style={{ padding: '8px 6px' }}>Invoices</th>
              <th style={{ padding: '8px 6px' }}>Reporting</th>
              <th style={{ padding: '8px 6px' }}>Tag Manager</th>
              <th style={{ padding: '8px 6px' }}>Business Profile</th>
              <th style={{ padding: '8px 6px' }}>Meta Ads</th>
              <th style={{ padding: '8px 6px' }}>Snapchat Ads</th>
              <th style={{ padding: '8px 6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) =>
              editingId === p.id ? (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={{ margin: 0 }} />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageCampaigns}
                      onChange={(e) => setEditForm({ ...editForm, canManageCampaigns: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageGoogleAds}
                      onChange={(e) => setEditForm({ ...editForm, canManageGoogleAds: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageTargeting}
                      onChange={(e) => setEditForm({ ...editForm, canManageTargeting: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canViewInvoices}
                      onChange={(e) => setEditForm({ ...editForm, canViewInvoices: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canViewReporting}
                      onChange={(e) => setEditForm({ ...editForm, canViewReporting: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageTagManager}
                      onChange={(e) => setEditForm({ ...editForm, canManageTagManager: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageBusinessProfile}
                      onChange={(e) => setEditForm({ ...editForm, canManageBusinessProfile: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageMeta}
                      onChange={(e) => setEditForm({ ...editForm, canManageMeta: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <input
                      type="checkbox"
                      checked={editForm.canManageSnapchat}
                      onChange={(e) => setEditForm({ ...editForm, canManageSnapchat: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn" style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6 }} onClick={() => handleSaveEdit(p.id)} disabled={saving}>
                      Save
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px' }} onClick={() => setEditingId(null)} disabled={saving}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={{ borderBottom: metricsOpenId === p.id ? 'none' : '1px solid var(--card-border)' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 600 }}>{p.name}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageCampaigns ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageGoogleAds ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageTargeting ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canViewInvoices ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canViewReporting ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageTagManager ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageBusinessProfile ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageMeta ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{p.canManageSnapchat ? '✓' : '—'}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6 }}
                      onClick={() => setMetricsOpenId(metricsOpenId === p.id ? null : p.id)}
                      title="Choose which dashboard metrics this position can see, per platform"
                    >
                      {metricsOpenId === p.id ? 'Hide metrics' : 'Metrics'}
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: 6 }} onClick={() => openEdit(p)}>
                      Edit
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 10px' }} onClick={() => handleDelete(p.id, p.name)} disabled={saving}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
            {metricsOpenId &&
              (() => {
                const pos = positions.find((p) => p.id === metricsOpenId);
                if (!pos) return null;
                return (
                  <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td colSpan={11} style={{ padding: '10px 6px 16px', background: 'var(--bg-alt)' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Metrics visible to "{pos.name}"</div>
                      <MetricVisibilityPanel positionId={metricsOpenId} />
                    </td>
                  </tr>
                );
              })()}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Per-position, per-platform metric checklist — unchecked means hidden from
// that position's dashboard KPI cards (see /api/metric-visibility, read by
// ReportingDashboard/MetaReportingDashboard/SnapReportingDashboard). Each
// checkbox fires its own POST immediately (fire-and-forget, optimistic UI)
// rather than batching into a "Save" button — there's no risk of a partial
// save leaving capabilities in a bad state the way there could be with the
// position's own Save button, since every toggle here is independent.
function MetricVisibilityPanel({ positionId }: { positionId: string }) {
  const [hidden, setHidden] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHidden(null);
    fetch(`/api/positions/${positionId}/metric-visibility`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then(setHidden)
      .catch(() => setError('Failed to load metric visibility'));
  }, [positionId]);

  async function toggle(platform: MetricPlatform, metricKey: string, nowHidden: boolean) {
    // Optimistic — flip the local state immediately, revert on failure.
    setHidden((prev) => {
      if (!prev) return prev;
      const list = prev[platform] ?? [];
      return {
        ...prev,
        [platform]: nowHidden ? [...list, metricKey] : list.filter((k) => k !== metricKey),
      };
    });
    try {
      const res = await fetch(`/api/positions/${positionId}/metric-visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, metricKey, hidden: nowHidden }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setError('Failed to save a metric toggle — reload and try again');
      // Revert the optimistic flip.
      setHidden((prev) => {
        if (!prev) return prev;
        const list = prev[platform] ?? [];
        return {
          ...prev,
          [platform]: nowHidden ? list.filter((k) => k !== metricKey) : [...list, metricKey],
        };
      });
    }
  }

  if (error) return <p style={{ color: '#ef4444', fontSize: '0.78rem', margin: 0 }}>{error}</p>;
  if (!hidden) return <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', margin: 0 }}>Loading…</p>;

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', margin: '0 0 10px' }}>
        Uncheck a metric to hide it from this position's dashboard KPI cards. Everything is visible by default.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {METRIC_PLATFORMS.map((platform) => (
          <div key={platform}>
            <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 6 }}>{PLATFORM_LABELS[platform]}</div>
            {METRIC_CATALOG[platform].map((m) => {
              const isHidden = (hidden[platform] ?? []).includes(m.key);
              return (
                <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={(e) => toggle(platform, m.key, !e.target.checked)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  {m.label}
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
