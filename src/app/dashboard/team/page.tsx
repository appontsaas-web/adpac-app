import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/access';
import { db } from '@/lib/db';
import DashboardNav from '../DashboardNav';
import TeamTable from './TeamTable';
import PositionsManager from './PositionsManager';

export default async function TeamPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'ADMIN') redirect('/dashboard');

  const [users, positions] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, positionId: true, createdAt: true },
    }),
    db.position.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);

  return (
    <div className="container">
      <DashboardNav />
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>Team</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        Admins have full access to everything, including Finance. Staff only see clients you assign them (from
        that client's page), and a Position controls what they can actually do there.
      </p>
      <PositionsManager positions={positions} />
      <TeamTable users={users} positions={positions} currentUserId={me.id} />
    </div>
  );
}
