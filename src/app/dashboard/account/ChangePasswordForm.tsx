'use client';

import { useState } from 'react';

// Self-service password change for the signed-in user (admin or staff).
// Requires the current password — unlike the admin "Reset password" action
// on the Team page, which sets a new password for someone else without
// knowing their old one.
export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to change password');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? 'Failed to change password — network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Change password</h2>
      <form onSubmit={handleSubmit}>
        <label>Current password</label>
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <label>New password (8+ characters)</label>
        <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <label>Confirm new password</label>
        <input
          type="password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
        {done && <p style={{ color: 'var(--accent2)', fontSize: '0.82rem', marginTop: 8 }}>Password changed.</p>}
        <button className="btn" type="submit" disabled={saving} style={{ marginTop: 12 }}>
          {saving ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  );
}
