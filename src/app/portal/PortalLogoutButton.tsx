'use client';

import { useI18n } from '@/lib/i18n/LocaleProvider';
export default function PortalLogoutButton() {
  const { tr } = useI18n();
  async function handleLogout() {
    await fetch('/api/portal/logout', { method: 'POST' });
    window.location.href = '/portal';
  }
  return (
    <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={handleLogout}>
      {tr("Sign out")}
    </button>
  );
}
