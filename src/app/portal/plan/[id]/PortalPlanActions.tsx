'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PortalPlanActions({ planId, status }: { planId: string; status: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (status === 'CLIENT_APPROVED') {
    return <p style={{ color: 'var(--accent2, #22d3c9)', fontSize: '0.9rem' }}>✓ You approved this plan.</p>;
  }
  if (status === 'CLIENT_REJECTED') {
    return <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>You requested changes to this plan — our team will follow up.</p>;
  }
  if (status !== 'PENDING_CLIENT_APPROVAL') {
    return null;
  }

  async function handleApprove() {
    if (!confirm('Approve this plan? Our team will be able to apply the recommended changes to your campaigns.')) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/plans/${planId}/approve`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Failed to approve');
        return;
      }
      router.push('/portal');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Network error');
    } finally {
      setWorking(false);
    }
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) {
      setError('Please describe what you’d like changed');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/plans/${planId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Failed to submit feedback');
        return;
      }
      router.push('/portal');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Network error');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card">
      {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 10 }}>{error}</p>}
      {!showFeedback ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={handleApprove} disabled={working}>
            {working ? 'Working…' : 'Approve plan'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowFeedback(true)} disabled={working}>
            Request changes
          </button>
        </div>
      ) : (
        <div>
          <label>What would you like changed?</label>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="btn" onClick={handleRequestChanges} disabled={working}>
              {working ? 'Submitting…' : 'Submit feedback'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowFeedback(false)} disabled={working}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
