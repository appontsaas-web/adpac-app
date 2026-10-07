'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Position {
  id: string;
  name: string;
}

interface TeamUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  positionId: string | null;
  createdAt: string | Date;
}

export default function TeamTable({
  users,
  positions,
  currentUserId,
}: {
  users: TeamUser[];
  positions: Position[];
  currentUserId: string;
}) {
  const { tr } = useI18n();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('STAFF');
  const [positionId, setPositionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password, role, positionId: positionId || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to create user"));
        return;
      }
      setEmail('');
      setName('');
      setPassword('');
      setRole('STAFF');
      setPositionId('');
      setAdding(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to create user — network error"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePositionChange(userId: string, newPositionId: string) {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId: newPositionId || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to update position"));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to update position — network error"));
    } finally {
      setBusyId(null);
    }
  }

  function openReset(id: string) {
    setResettingId(id);
    setNewPassword('');
    setResetError(null);
    setResetDone(null);
  }

  async function handleResetPassword(id: string) {
    if (newPassword.length < 8) {
      setResetError('Password must be at least 8 characters');
      return;
    }
    setBusyId(id);
    setResetError(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setResetError(d.error ?? 'Failed to reset password');
        return;
      }
      setResetDone(id);
      setNewPassword('');
    } catch (err: any) {
      setResetError(err.message ?? 'Failed to reset password — network error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string, label: string) {
    if (!confirm(`Remove ${label} from the team? They'll lose access to everything immediately.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? tr("Failed to remove user"));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to remove user — network error"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: '1.1rem' }}>{tr("Team")}</h2>
        <button className="btn btn-secondary" onClick={() => setAdding(!adding)}>
          {adding ? tr("Cancel") : tr("+ Add team member")}
        </button>
      </div>

      {adding && (
        <form onSubmit={handleAdd} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--card-border)' }}>
          <label>{tr("Name")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Jane Doe")} />
          <label>{tr("Email")}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr("jane@adpac.to")} />
          <label>{tr("Temporary password (8+ characters)")}</label>
          <input
            type="text"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tr("They should change this after first login")}
          />
          <label>{tr("Role")}</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="STAFF">{tr("Staff — only sees clients you assign them")}</option>
            <option value="ADMIN">{tr("Admin — full access to everything, including Finance")}</option>
          </select>
          {role === 'STAFF' && (
            <>
              <label>{tr("Position (optional — controls what they can do; assign clients from each client's page)")}</label>
              <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                <option value="">{tr("No position (view-only, even with Edit client access)")}</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <button className="btn" type="submit" disabled={saving}>
            {saving ? tr("Creating…") : tr("Create account")}
          </button>
        </form>
      )}

      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left', color: 'var(--text-dim)' }}>
            <th style={{ padding: '8px 6px' }}>{tr("Name")}</th>
            <th style={{ padding: '8px 6px' }}>{tr("Email")}</th>
            <th style={{ padding: '8px 6px' }}>{tr("Role")}</th>
            <th style={{ padding: '8px 6px' }}>{tr("Position")}</th>
            <th style={{ padding: '8px 6px' }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Fragment key={u.id}>
              <tr style={{ borderBottom: resettingId === u.id ? 'none' : '1px solid var(--card-border)' }}>
                <td style={{ padding: '8px 6px' }}>{u.name || '—'}{u.id === currentUserId && ' (you)'}</td>
                <td style={{ padding: '8px 6px', color: 'var(--text-dim)' }}>{u.email}</td>
                <td style={{ padding: '8px 6px' }}>
                  <span className={`badge ${u.role === 'ADMIN' ? 'badge-approved' : 'badge-draft'}`}>{u.role}</span>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {u.role === 'ADMIN' ? (
                    <span style={{ color: 'var(--text-dim)' }}>{tr("— (full access)")}</span>
                  ) : (
                    <select
                      value={u.positionId ?? ''}
                      onChange={(e) => handlePositionChange(u.id, e.target.value)}
                      disabled={busyId === u.id}
                      style={{ margin: 0, width: 'auto' }}
                    >
                      <option value="">{tr("No position")}</option>
                      {positions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '5px 10px', marginRight: u.id !== currentUserId ? 6 : 0 }}
                    onClick={() => (resettingId === u.id ? setResettingId(null) : openReset(u.id))}
                  >
                    {resettingId === u.id ? tr("Cancel") : tr("Reset password")}
                  </button>
                  {u.id !== currentUserId && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                      onClick={() => handleRemove(u.id, u.name || u.email)}
                      disabled={busyId === u.id}
                    >
                      {busyId === u.id ? '…' : tr("Remove")}
                    </button>
                  )}
                </td>
              </tr>
              {resettingId === u.id && (
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td colSpan={5} style={{ padding: '0 6px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder={tr("New password (8+ characters)")}
                        style={{ margin: 0, maxWidth: 260 }}
                      />
                      <button
                        className="btn"
                        style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                        onClick={() => handleResetPassword(u.id)}
                        disabled={busyId === u.id}
                      >
                        {busyId === u.id ? tr("Saving…") : tr("Save new password")}
                      </button>
                      {resetDone === u.id && (
                        <span style={{ color: 'var(--accent2)', fontSize: '0.8rem' }}>{tr("Password updated.")}</span>
                      )}
                    </div>
                    {resetError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 6 }}>{resetError}</p>}
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: 6 }}>
                      {tr("Sets their password directly — they should change it themselves after logging in (Account page).")}
                    </p>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
