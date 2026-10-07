import Link from 'next/link';
import { getCurrentUser } from '@/lib/access';
import SignOutButton from './SignOutButton';
import LanguageToggle from '@/lib/i18n/LanguageToggle';
import { getT } from '@/lib/i18n/server';

export default async function DashboardNav() {
  const me = await getCurrentUser();
  const t = getT();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        paddingBottom: 12,
        borderBottom: '1px solid var(--card-border)',
      }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link href="/dashboard" style={{ fontWeight: 700, textDecoration: 'none' }}>
          AdPac
        </Link>
        <Link href="/dashboard" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textDecoration: 'none' }}>
          {t('common.clients')}
        </Link>
        {me?.role === 'ADMIN' && (
          <Link href="/dashboard/team" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textDecoration: 'none' }}>
            {t('common.team')}
          </Link>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {me && (
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            {me.name || me.email} · {me.role}
          </span>
        )}
        {me && (
          <Link href="/dashboard/account" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textDecoration: 'none' }}>
            {t('common.account')}
          </Link>
        )}
        <LanguageToggle />
        <SignOutButton />
      </div>
    </div>
  );
}
