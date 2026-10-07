import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/access';
import DashboardNav from '../DashboardNav';
import ChangePasswordForm from './ChangePasswordForm';
import { getT } from '@/lib/i18n/server';

export default async function AccountPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  const t = getT();

  return (
    <div className="container">
      <DashboardNav />
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>{t('account.title')}</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        {t('account.signedInAs', { name: me.name || me.email, email: me.email, role: me.role })}
        {me.position && ` · ${me.position.name}`}
      </p>
      <ChangePasswordForm />
    </div>
  );
}
