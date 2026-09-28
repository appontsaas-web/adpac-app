import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/access';
import DashboardNav from '../DashboardNav';
import ChangePasswordForm from './ChangePasswordForm';

export default async function AccountPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  return (
    <div className="container">
      <DashboardNav />
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>Account</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        Signed in as {me.name || me.email} ({me.email}) · {me.role}
        {me.position && ` · ${me.position.name}`}
      </p>
      <ChangePasswordForm />
    </div>
  );
}
