'use client';

export default function PortalLogoutButton() {
  async function handleLogout() {
    await fetch('/api/portal/logout', { method: 'POST' });
    window.location.href = '/portal';
  }
  return (
    <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={handleLogout}>
      Sign out
    </button>
  );
}
