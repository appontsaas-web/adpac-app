'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StaffUser {
  id: string;
  email: string;
  name: string | null;
}

interface Assignment {
  userId: string;
  permission: string; // VIEW | EDIT
}

// Admin-only. Lets you grant/revoke per-client access for STAFF accounts.
// Finance is intentionally never covered here — it's always admin-only,
// no matter what permission a staff member has on this client.
export default function AccessManager({
  clientId,
  staff,
  assignments,
}: {
  clientId: string;
  staff: StaffUser[];
  assignments: Assignment[];
}) {
  const { tr } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignmentByUser = new Map(assignments.map((a) => [a.userId, a.permission]));

  async function setPermission(userId: string, permission: string) {
    setBusyId(userId);
    setError(null);
    try {
      if (permission === 'NONE') {
        const res = await fetch(`/api/clients/${clientId}/assignments`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? tr("Failed to update access"));
          return;
        }
      } else {
        const res = await fetch(`/api/clients/${clientId}/assignments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, permission }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? tr("Failed to update access"));
          return;
        }
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? tr("Failed to update access — network error"));
    } finally {
      setBusyId(null);
    }
  }

  if (staff.length === 0) {
    return (
      <div className="card">
        <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>{tr("Access")}</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          {tr("No staff accounts yet. Add team members from the")}{' '}
          <a href="/dashboard/team" style={{ color: 'var(--accent2)' }}>
            {tr("Team")}
          </a>{' '}
          {tr("page, then grant them access here.")}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>{tr("Access")}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
        {tr("This is just whether they can see this client at all, and at View or Edit level. What they can actually do (campaigns, Google Ads, targeting, invoices) depends on their Position, set on the Team page.")}
      </p>
      {error && <p style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: 10 }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <tbody>
          {staff.map((u) => {
            const current = assignmentByUser.get(u.id) ?? 'NONE';
            return (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                <td style={{ padding: '8px 6px' }}>
                  <div>{u.name || u.email}</div>
                  {u.name && <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{u.email}</div>}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                  <select
                    value={current}
                    onChange={(e) => setPermission(u.id, e.target.value)}
                    disabled={busyId === u.id}
                    style={{ margin: 0, width: 'auto' }}
                  >
                    <option value="NONE">{tr("No access")}</option>
                    <option value="VIEW">{tr("View")}</option>
                    <option value="EDIT">{tr("Edit")}</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
